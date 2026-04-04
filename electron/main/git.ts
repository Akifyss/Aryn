import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { GitChangeItem, GitChangeKind, GitChangeScope, GitFileDiffResult, GitRepositoryState } from '../../src/features/git/types'
import { getSupportedWorkspaceEditorKind } from '../../src/features/workspace/lib/file-types'

const execFileAsync = promisify(execFile)

type GitCommandOptions = {
  allowFailure?: boolean
  cwd: string
  encoding?: BufferEncoding
}

type ParsedBranchStatus = {
  ahead: number
  behind: number
  branch: string | null
}

function toPosixPath(filePath: string) {
  return filePath.replace(/[\\/]+/g, '/')
}

function toWorkspaceRelativePath(repositoryRootPath: string, filePath: string) {
  return toPosixPath(path.relative(repositoryRootPath, filePath))
}

function isGitMissingError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  return /git/i.test(error.message) && /not recognized|ENOENT/i.test(error.message)
}

async function runGit(
  args: string[],
  options: GitCommandOptions,
) {
  const encoding = options.encoding ?? 'utf8'
  const commandArgs = ['-c', 'core.quotepath=false', ...args]

  try {
    const result = await execFileAsync('git', commandArgs, {
      cwd: options.cwd,
      encoding,
      windowsHide: true,
    })

    return result.stdout
  } catch (error) {
    if (options.allowFailure) {
      return null
    }

    if (isGitMissingError(error)) {
      throw new Error('Git is not available on this machine.')
    }

    const stderr = typeof (error as { stderr?: unknown }).stderr === 'string'
      ? (error as { stderr: string }).stderr.trim()
      : ''
    const stdout = typeof (error as { stdout?: unknown }).stdout === 'string'
      ? (error as { stdout: string }).stdout.trim()
      : ''
    const message = stderr || stdout || (error instanceof Error ? error.message : 'Git command failed.')
    throw new Error(message)
  }
}

async function resolveRepositoryRoot(workspacePath: string) {
  const stdout = await runGit(['rev-parse', '--show-toplevel'], {
    allowFailure: true,
    cwd: workspacePath,
  })

  if (!stdout) {
    return null
  }

  return stdout.trim() || null
}

async function repositoryHasCommits(repositoryRootPath: string) {
  const stdout = await runGit(['rev-parse', '--verify', 'HEAD'], {
    allowFailure: true,
    cwd: repositoryRootPath,
  })

  return Boolean(stdout?.trim())
}

function parseBranchStatus(line: string): ParsedBranchStatus {
  if (!line.startsWith('## ')) {
    return {
      ahead: 0,
      behind: 0,
      branch: null,
    }
  }

  const summary = line.slice(3).trim()
  const [branchPart, trackingPart] = summary.split('...')
  const normalizedBranch = branchPart?.startsWith('No commits yet on ')
    ? branchPart.slice('No commits yet on '.length)
    : branchPart
  const branch = normalizedBranch === 'HEAD (no branch)' ? null : normalizedBranch
  const aheadMatch = trackingPart?.match(/ahead (\d+)/)
  const behindMatch = trackingPart?.match(/behind (\d+)/)

  return {
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
    branch: branch ?? null,
  }
}

function mapStatusCodeToKind(code: string, scope: GitChangeScope): GitChangeKind | null {
  if (code === '?') {
    return 'untracked'
  }

  if (code === 'U') {
    return 'conflicted'
  }

  switch (code) {
    case 'A':
      return 'added'
    case 'C':
      return 'copied'
    case 'D':
      return 'deleted'
    case 'M':
      return 'modified'
    case 'R':
      return 'renamed'
    case 'T':
      return 'type-changed'
    case '!':
      return scope === 'unstaged' ? 'deleted' : null
    default:
      return null
  }
}

function parseRenamePath(rawPath: string) {
  const arrowIndex = rawPath.indexOf(' -> ')

  if (arrowIndex === -1) {
    return {
      currentPath: rawPath,
      originalPath: null,
    }
  }

  return {
    currentPath: rawPath.slice(arrowIndex + 4),
    originalPath: rawPath.slice(0, arrowIndex),
  }
}

function parseStatusLines(repositoryRootPath: string, statusOutput: string) {
  const lines = statusOutput
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter(Boolean)

  const branchStatus = lines[0]?.startsWith('## ')
    ? parseBranchStatus(lines[0])
    : {
      ahead: 0,
      behind: 0,
      branch: null,
    }
  const stagedChanges: GitChangeItem[] = []
  const unstagedChanges: GitChangeItem[] = []

  for (const line of lines) {
    if (line.startsWith('## ')) {
      continue
    }

    if (line.length < 4) {
      continue
    }

    const status = line.slice(0, 2)
    const rawPath = line.slice(3)
    const { currentPath, originalPath } = parseRenamePath(rawPath)
    const absolutePath = path.resolve(repositoryRootPath, currentPath)
    const absoluteOriginalPath = originalPath
      ? path.resolve(repositoryRootPath, originalPath)
      : null
    const relativePath = toWorkspaceRelativePath(repositoryRootPath, absolutePath)
    const originalAbsolutePath = absoluteOriginalPath

    if (status === '??') {
      unstagedChanges.push({
        kind: 'untracked',
        originalPath: null,
        path: absolutePath,
        relativePath,
        scope: 'unstaged',
        statusCode: '?',
      })
      continue
    }

    if (status === '!!') {
      continue
    }

    const stagedKind = mapStatusCodeToKind(status[0], 'staged')
    const unstagedKind = mapStatusCodeToKind(status[1], 'unstaged')

    if (stagedKind) {
      stagedChanges.push({
        kind: stagedKind,
        originalPath: originalAbsolutePath,
        path: absolutePath,
        relativePath,
        scope: 'staged',
        statusCode: status[0],
      })
    }

    if (unstagedKind) {
      unstagedChanges.push({
        kind: unstagedKind,
        originalPath: originalAbsolutePath,
        path: absolutePath,
        relativePath,
        scope: 'unstaged',
        statusCode: status[1],
      })
    }
  }

  const sortByPath = (left: GitChangeItem, right: GitChangeItem) => left.relativePath.localeCompare(right.relativePath)
  stagedChanges.sort(sortByPath)
  unstagedChanges.sort(sortByPath)

  return {
    ...branchStatus,
    stagedChanges,
    unstagedChanges,
  }
}

async function readFileIfPresent(filePath: string) {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

async function readGitRevisionFile(
  repositoryRootPath: string,
  revision: string,
  relativePath: string,
) {
  const stdout = await runGit(['show', `${revision}:${relativePath}`], {
    allowFailure: true,
    cwd: repositoryRootPath,
  })

  return stdout
}

async function readGitIndexFile(repositoryRootPath: string, relativePath: string) {
  const stdout = await runGit(['show', `:${relativePath}`], {
    allowFailure: true,
    cwd: repositoryRootPath,
  })

  return stdout
}

export async function getGitRepositoryState(workspacePath: string): Promise<GitRepositoryState> {
  const repositoryRootPath = await resolveRepositoryRoot(workspacePath)

  if (!repositoryRootPath) {
    return {
      ahead: 0,
      behind: 0,
      branch: null,
      hasCommits: false,
      hasChanges: false,
      isRepository: false,
      repositoryRootPath: null,
      stagedChanges: [],
      unstagedChanges: [],
      workspacePath,
    }
  }

  const statusOutput = await runGit(['status', '--porcelain=v1', '--branch', '--untracked-files=all'], {
    cwd: repositoryRootPath,
  })

  if (statusOutput === null) {
    throw new Error('Unable to read Git status.')
  }

  const parsedStatus = parseStatusLines(repositoryRootPath, statusOutput)
  const hasCommits = await repositoryHasCommits(repositoryRootPath)

  return {
    ahead: parsedStatus.ahead,
    behind: parsedStatus.behind,
    branch: parsedStatus.branch,
    hasCommits,
    hasChanges: parsedStatus.stagedChanges.length > 0 || parsedStatus.unstagedChanges.length > 0,
    isRepository: true,
    repositoryRootPath,
    stagedChanges: parsedStatus.stagedChanges,
    unstagedChanges: parsedStatus.unstagedChanges,
    workspacePath,
  }
}

export async function initializeGitRepository(workspacePath: string) {
  await runGit(['init'], {
    cwd: workspacePath,
  })

  return getGitRepositoryState(workspacePath)
}

export async function stageGitPaths(workspacePath: string, filePaths: string[]) {
  const repositoryRootPath = await resolveRepositoryRoot(workspacePath)

  if (!repositoryRootPath) {
    throw new Error('Initialize Git in this workspace first.')
  }

  const relativePaths = filePaths.map((filePath) => toWorkspaceRelativePath(repositoryRootPath, filePath))
  await runGit(['add', '--', ...relativePaths], {
    cwd: repositoryRootPath,
  })

  return getGitRepositoryState(workspacePath)
}

export async function unstageGitPaths(workspacePath: string, filePaths: string[]) {
  const repositoryRootPath = await resolveRepositoryRoot(workspacePath)

  if (!repositoryRootPath) {
    throw new Error('Initialize Git in this workspace first.')
  }

  const relativePaths = filePaths.map((filePath) => toWorkspaceRelativePath(repositoryRootPath, filePath))
  await runGit(['restore', '--staged', '--', ...relativePaths], {
    cwd: repositoryRootPath,
  })

  return getGitRepositoryState(workspacePath)
}

export async function discardGitChange(workspacePath: string, change: GitChangeItem) {
  const repositoryRootPath = await resolveRepositoryRoot(workspacePath)

  if (!repositoryRootPath) {
    throw new Error('Initialize Git in this workspace first.')
  }

  const relativePath = toWorkspaceRelativePath(repositoryRootPath, change.path)

  if (change.kind === 'untracked') {
    await rm(change.path, { force: true })
    return getGitRepositoryState(workspacePath)
  }

  await runGit(['restore', '--', relativePath], {
    cwd: repositoryRootPath,
  })

  return getGitRepositoryState(workspacePath)
}

export async function commitGitChanges(workspacePath: string, message: string) {
  const repositoryRootPath = await resolveRepositoryRoot(workspacePath)

  if (!repositoryRootPath) {
    throw new Error('Initialize Git in this workspace first.')
  }

  const trimmedMessage = message.trim()

  if (!trimmedMessage) {
    throw new Error('Commit message is required.')
  }

  const repositoryState = await getGitRepositoryState(workspacePath)

  if (repositoryState.stagedChanges.length === 0) {
    if (repositoryState.unstagedChanges.length === 0) {
      throw new Error('There are no changes to commit.')
    }

    await runGit(['add', '-A', '--', '.'], {
      cwd: repositoryRootPath,
    })
  }

  await runGit(['commit', '-m', trimmedMessage], {
    cwd: repositoryRootPath,
  })

  return getGitRepositoryState(workspacePath)
}

export async function getGitFileDiff(
  workspacePath: string,
  targetPath: string,
  scope: GitChangeScope,
): Promise<GitFileDiffResult> {
  const repositoryState = await getGitRepositoryState(workspacePath)

  if (!repositoryState.isRepository || !repositoryState.repositoryRootPath) {
    throw new Error('Initialize Git in this workspace first.')
  }

  const changes = scope === 'staged' ? repositoryState.stagedChanges : repositoryState.unstagedChanges
  const change = changes.find((item) => path.resolve(item.path) === path.resolve(targetPath))

  if (!change) {
    throw new Error('That Git change is no longer available.')
  }

  const relativePath = toWorkspaceRelativePath(repositoryState.repositoryRootPath, change.path)
  const editorKind = getSupportedWorkspaceEditorKind(change.path) ?? 'code'

  if (scope === 'staged') {
    const originalContent = change.kind === 'added'
      ? null
      : await readGitRevisionFile(repositoryState.repositoryRootPath, 'HEAD', relativePath)
    const modifiedContent = change.kind === 'deleted'
      ? null
      : await readGitIndexFile(repositoryState.repositoryRootPath, relativePath)

    return {
      change,
      editorKind,
      modifiedContent: modifiedContent ?? '',
      modifiedExists: modifiedContent !== null,
      modifiedLabel: 'Index',
      originalContent: originalContent ?? '',
      originalExists: originalContent !== null,
      originalLabel: 'HEAD',
      repositoryRootPath: repositoryState.repositoryRootPath,
    }
  }

  const originalContent = change.kind === 'untracked'
    ? null
    : await readGitIndexFile(repositoryState.repositoryRootPath, relativePath)
  const modifiedContent = change.kind === 'deleted'
    ? null
    : await readFileIfPresent(change.path)

  return {
    change,
    editorKind,
    modifiedContent: modifiedContent ?? '',
    modifiedExists: modifiedContent !== null,
    modifiedLabel: 'Working tree',
    originalContent: originalContent ?? '',
    originalExists: originalContent !== null,
    originalLabel: 'Index',
    repositoryRootPath: repositoryState.repositoryRootPath,
  }
}
