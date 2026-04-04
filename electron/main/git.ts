import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  GitChangeItem,
  GitChangeKind,
  GitChangeScope,
  GitFileDiffResult,
  GitRecentPullItem,
  GitRepositoryState,
} from '../../src/features/git/types'
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

type EnsureUpstreamMode = 'pull' | 'push' | 'sync'

type EnsureUpstreamResult = 'ready' | 'pushed'

const recentPullsByRepository = new Map<string, GitRecentPullItem[]>()

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

function mapNameStatusCodeToKind(code: string): GitRecentPullItem['kind'] | null {
  switch (code[0]) {
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
    default:
      return null
  }
}

function parseStatusLines(repositoryRootPath: string, statusOutput: string) {
  const entries = statusOutput
    .split('\0')
    .map((entry) => entry.replace(/\r?\n/g, ''))
    .filter(Boolean)

  const branchStatus = entries[0]?.startsWith('## ')
    ? parseBranchStatus(entries[0])
    : {
      ahead: 0,
      behind: 0,
      branch: null,
    }
  const stagedChanges: GitChangeItem[] = []
  const unstagedChanges: GitChangeItem[] = []

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]

    if (entry.startsWith('## ')) {
      continue
    }

    if (entry.length < 4) {
      continue
    }

    const status = entry.slice(0, 2)
    const currentPath = entry.slice(3)
    const hasOriginalPath = status.includes('R') || status.includes('C')
    const originalPath = hasOriginalPath ? entries[index + 1] ?? null : null

    if (hasOriginalPath) {
      index += 1
    }

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

async function getUnpushedCommitCount(repositoryRootPath: string) {
  const stdout = await runGit(['rev-list', '--count', '@{upstream}..HEAD'], {
    allowFailure: true,
    cwd: repositoryRootPath,
  })

  const parsedCount = Number(stdout?.trim() ?? '0')
  return Number.isFinite(parsedCount) ? parsedCount : 0
}

async function getTrackingBranch(repositoryRootPath: string) {
  const stdout = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], {
    allowFailure: true,
    cwd: repositoryRootPath,
  })

  const trackingBranch = stdout?.trim() ?? ''
  return trackingBranch || null
}

async function getCurrentBranch(repositoryRootPath: string) {
  const stdout = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: repositoryRootPath,
  })

  const branchName = (stdout ?? '').trim()

  if (!branchName || branchName === 'HEAD') {
    throw new Error('Detached HEAD is not supported for Git sync actions.')
  }

  return branchName
}

async function getRemotes(repositoryRootPath: string) {
  const stdout = await runGit(['remote'], {
    allowFailure: true,
    cwd: repositoryRootPath,
  })

  return (stdout ?? '')
    .split(/\r?\n/g)
    .map((remote) => remote.trim())
    .filter(Boolean)
}

async function remoteHasBranch(repositoryRootPath: string, remoteName: string, branchName: string) {
  const stdout = await runGit(['ls-remote', '--heads', remoteName, branchName], {
    allowFailure: true,
    cwd: repositoryRootPath,
  })

  return Boolean(stdout?.trim())
}

async function ensureUpstreamBranch(repositoryRootPath: string, mode: EnsureUpstreamMode): Promise<EnsureUpstreamResult> {
  if (await getTrackingBranch(repositoryRootPath)) {
    return 'ready'
  }

  const remotes = await getRemotes(repositoryRootPath)

  if (remotes.length === 0) {
    throw new Error('No remote is configured for this repository.')
  }

  if (remotes.length > 1) {
    throw new Error('No upstream branch is set. Configure the tracking branch manually for this repository first.')
  }

  const remoteName = remotes[0]
  const branchName = await getCurrentBranch(repositoryRootPath)

  if (await remoteHasBranch(repositoryRootPath, remoteName, branchName)) {
    await runGit(['branch', '--set-upstream-to', `${remoteName}/${branchName}`, branchName], {
      cwd: repositoryRootPath,
    })
    return 'ready'
  }

  if (mode === 'pull') {
    throw new Error(`No upstream branch is set, and ${remoteName}/${branchName} does not exist yet. Push this branch first.`)
  }

  await runGit(['push', '-u', remoteName, branchName], {
    cwd: repositoryRootPath,
  })

  return 'pushed'
}

function parseNameStatusOutput(repositoryRootPath: string, diffOutput: string) {
  const entries = diffOutput
    .split('\0')
    .map((entry) => entry.replace(/\r?\n/g, ''))
    .filter(Boolean)
  const changes: GitRecentPullItem[] = []

  for (let index = 0; index < entries.length; index += 1) {
    const statusCode = entries[index]

    if (!statusCode) {
      continue
    }

    const kind = mapNameStatusCodeToKind(statusCode)

    if (!kind) {
      continue
    }

    if (statusCode.startsWith('R') || statusCode.startsWith('C')) {
      const originalPath = entries[index + 1]
      const currentPath = entries[index + 2]

      if (!originalPath || !currentPath) {
        continue
      }

      changes.push({
        kind,
        originalPath: path.resolve(repositoryRootPath, originalPath),
        path: path.resolve(repositoryRootPath, currentPath),
        relativePath: toWorkspaceRelativePath(repositoryRootPath, path.resolve(repositoryRootPath, currentPath)),
        statusCode,
      })
      index += 2
      continue
    }

    const currentPath = entries[index + 1]

    if (!currentPath) {
      continue
    }

    changes.push({
      kind,
      originalPath: null,
      path: path.resolve(repositoryRootPath, currentPath),
      relativePath: toWorkspaceRelativePath(repositoryRootPath, path.resolve(repositoryRootPath, currentPath)),
      statusCode,
    })
    index += 1
  }

  changes.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  return changes
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
      recentlyPulledChanges: [],
      repositoryRootPath: null,
      stagedChanges: [],
      unpushedCommits: 0,
      unstagedChanges: [],
      workspacePath,
    }
  }

  const statusOutput = await runGit(['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all'], {
    cwd: repositoryRootPath,
  })

  if (statusOutput === null) {
    throw new Error('Unable to read Git status.')
  }

  const parsedStatus = parseStatusLines(repositoryRootPath, statusOutput)
  const hasCommits = await repositoryHasCommits(repositoryRootPath)
  const unpushedCommits = hasCommits
    ? await getUnpushedCommitCount(repositoryRootPath)
    : 0

  return {
    ahead: parsedStatus.ahead,
    behind: parsedStatus.behind,
    branch: parsedStatus.branch,
    hasCommits,
    hasChanges: parsedStatus.stagedChanges.length > 0 || parsedStatus.unstagedChanges.length > 0,
    isRepository: true,
    recentlyPulledChanges: recentPullsByRepository.get(repositoryRootPath) ?? [],
    repositoryRootPath,
    stagedChanges: parsedStatus.stagedChanges,
    unpushedCommits,
    unstagedChanges: parsedStatus.unstagedChanges,
    workspacePath,
  }
}

export async function initializeGitRepository(workspacePath: string) {
  await runGit(['init'], {
    cwd: workspacePath,
  })

  recentPullsByRepository.delete(workspacePath)
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

export async function discardAllGitChanges(workspacePath: string) {
  const repositoryState = await getGitRepositoryState(workspacePath)

  if (!repositoryState.isRepository || !repositoryState.repositoryRootPath) {
    throw new Error('Initialize Git in this workspace first.')
  }

  const trackedPaths = repositoryState.unstagedChanges
    .filter((change) => change.kind !== 'untracked')
    .map((change) => toWorkspaceRelativePath(repositoryState.repositoryRootPath!, change.path))
  const untrackedPaths = repositoryState.unstagedChanges
    .filter((change) => change.kind === 'untracked')
    .map((change) => change.path)

  if (trackedPaths.length > 0) {
    await runGit(['restore', '--worktree', '--', ...trackedPaths], {
      cwd: repositoryState.repositoryRootPath,
    })
  }

  await Promise.all(untrackedPaths.map(async (filePath) => {
    await rm(filePath, { force: true, recursive: true })
  }))

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

export async function pullGitChanges(workspacePath: string) {
  const repositoryRootPath = await resolveRepositoryRoot(workspacePath)

  if (!repositoryRootPath) {
    throw new Error('Initialize Git in this workspace first.')
  }

  await ensureUpstreamBranch(repositoryRootPath, 'pull')

  const beforeHead = (await runGit(['rev-parse', 'HEAD'], {
    allowFailure: true,
    cwd: repositoryRootPath,
  }))?.trim() ?? null

  await runGit(['pull', '--no-rebase'], {
    cwd: repositoryRootPath,
  })

  const afterHead = (await runGit(['rev-parse', 'HEAD'], {
    allowFailure: true,
    cwd: repositoryRootPath,
  }))?.trim() ?? null

  if (beforeHead && afterHead && beforeHead !== afterHead) {
    const diffOutput = await runGit(['diff', '--name-status', '-z', `${beforeHead}..${afterHead}`], {
      cwd: repositoryRootPath,
    })
    recentPullsByRepository.set(repositoryRootPath, parseNameStatusOutput(repositoryRootPath, diffOutput ?? ''))
  } else {
    recentPullsByRepository.set(repositoryRootPath, [])
  }

  return getGitRepositoryState(workspacePath)
}

export async function pushGitChanges(workspacePath: string) {
  const repositoryRootPath = await resolveRepositoryRoot(workspacePath)

  if (!repositoryRootPath) {
    throw new Error('Initialize Git in this workspace first.')
  }

  const upstreamState = await ensureUpstreamBranch(repositoryRootPath, 'push')

  if (upstreamState === 'pushed') {
    return getGitRepositoryState(workspacePath)
  }

  await runGit(['push'], {
    cwd: repositoryRootPath,
  })

  return getGitRepositoryState(workspacePath)
}

export async function commitAndSyncGitChanges(workspacePath: string, message: string) {
  const repositoryState = await getGitRepositoryState(workspacePath)

  if (!repositoryState.isRepository) {
    throw new Error('Initialize Git in this workspace first.')
  }

  let nextState = repositoryState

  if (repositoryState.hasChanges) {
    nextState = await commitGitChanges(workspacePath, message)
  }

  if (!nextState.repositoryRootPath) {
    throw new Error('Initialize Git in this workspace first.')
  }

  const upstreamState = await ensureUpstreamBranch(nextState.repositoryRootPath, 'sync')

  if (upstreamState === 'pushed') {
    return getGitRepositoryState(workspacePath)
  }

  nextState = await pullGitChanges(workspacePath)
  nextState = await pushGitChanges(workspacePath)

  return nextState
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
