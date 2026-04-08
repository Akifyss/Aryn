import { access, readFile, readdir, mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { getSupportedWorkspaceEditorKind, type SupportedWorkspaceEditorKind } from '../../src/features/workspace/lib/file-types'

export type WorkspaceNode = {
  name: string
  path: string
  kind: 'directory' | 'file'
  isOpenable?: boolean
  children?: WorkspaceNode[]
}

export type WorkspaceChangeEvent = {
  rootPath: string
  path: string
  type: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir'
}

const IGNORED_NAMES = new Set([
  '.git',
  '.pi',
  '.tmp-icon-theme-cache',
  'dist',
  'dist-electron',
  'node_modules',
  'temp-icon-theme-cache',
])
const CREATABLE_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.mdx',
  '.txt',
  '.text',
])

let workspaceWatcher: FSWatcher | null = null

function shouldIgnore(entryName: string) {
  return IGNORED_NAMES.has(entryName)
}

function normalizeWorkspacePath(watchedPath: string) {
  return watchedPath.replace(/[\\/]+/g, '/')
}

export function shouldIgnoreWorkspacePath(watchedPath: string) {
  const normalizedPath = normalizeWorkspacePath(watchedPath)
  const segments = normalizedPath.split('/').filter(Boolean)

  if (segments.some(shouldIgnore)) {
    return true
  }

  return normalizedPath.endsWith('/.git/index.lock')
}

function isIgnorableWorkspaceWatcherError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  if (!/EPERM/i.test(error.message)) {
    return false
  }

  return shouldIgnoreWorkspacePath(error.message)
}

function isCreatableFile(entryName: string) {
  return CREATABLE_EXTENSIONS.has(path.extname(entryName).toLowerCase())
}

function isInsideWorkspace(rootPath: string, targetPath: string) {
  return targetPath === rootPath || targetPath.startsWith(rootPath + path.sep)
}

function isSamePathOrDescendant(targetPath: string, parentPath: string) {
  return targetPath === parentPath || targetPath.startsWith(parentPath + path.sep)
}

function sortNodes(left: WorkspaceNode, right: WorkspaceNode) {
  if (left.kind !== right.kind) {
    return left.kind === 'directory' ? -1 : 1
  }

  return left.name.localeCompare(right.name)
}

export async function loadWorkspaceTree(rootPath: string): Promise<WorkspaceNode[]> {
  async function walk(currentPath: string): Promise<WorkspaceNode[]> {
    const entries = await readdir(currentPath, { withFileTypes: true })
    const nodes: Array<WorkspaceNode | null> = await Promise.all(entries
      .filter((entry) => !shouldIgnore(entry.name))
      .map(async (entry) => {
        const entryPath = path.join(currentPath, entry.name)

        if (entry.isDirectory()) {
          const children = await walk(entryPath)

          return {
            name: entry.name,
            path: entryPath,
            kind: 'directory' as const,
            children,
          }
        }

        return {
          name: entry.name,
          path: entryPath,
          kind: 'file' as const,
        }
      }))

    return nodes.filter((node): node is WorkspaceNode => node !== null).sort(sortNodes)
  }

  return walk(rootPath)
}

export async function loadWorkspaceFile(filePath: string) {
  return readFile(filePath, 'utf8')
}

export async function saveWorkspaceFile(filePath: string, content: string) {
  await writeFile(filePath, content, 'utf8')
}

function isProbablyUtf8Text(buffer: Buffer) {
  if (buffer.length === 0) {
    return true
  }

  if (buffer.includes(0)) {
    return false
  }

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return false
  }

  let suspiciousControlCount = 0

  for (const byte of buffer) {
    const isAllowedControl = byte === 9 || byte === 10 || byte === 13
    if (!isAllowedControl && byte < 32) {
      suspiciousControlCount += 1
    }
  }

  return suspiciousControlCount / buffer.length < 0.02
}

export async function resolveWorkspaceEditorKind(filePath: string): Promise<SupportedWorkspaceEditorKind | null> {
  const knownKind = getSupportedWorkspaceEditorKind(filePath)

  if (knownKind) {
    return knownKind
  }

  try {
    const sample = await readFile(filePath)
    return isProbablyUtf8Text(sample.subarray(0, 8192)) ? 'code' : null
  } catch {
    return null
  }
}

export async function workspacePathExists(workspacePath: string) {
  try {
    const info = await stat(workspacePath)
    return info.isDirectory()
  } catch {
    return false
  }
}

export async function workspaceFileExists(rootPath: string, filePath: string) {
  const resolvedRootPath = path.resolve(rootPath)
  const resolvedFilePath = path.resolve(filePath)

  if (!isInsideWorkspace(resolvedRootPath, resolvedFilePath)) {
    return false
  }

  try {
    const info = await stat(resolvedFilePath)
    return info.isFile()
  } catch {
    return false
  }
}

export async function createWorkspaceFile(rootPath: string, relativeFilePath: string) {
  const normalizedRelativePath = relativeFilePath.trim().replace(/^[\\/]+/, '')

  if (!normalizedRelativePath) {
    throw new Error('File name is required.')
  }

  const resolvedRootPath = path.resolve(rootPath)
  const resolvedFilePath = path.resolve(resolvedRootPath, normalizedRelativePath)

  if (!isInsideWorkspace(resolvedRootPath, resolvedFilePath)) {
    throw new Error('File path must stay inside the current workspace.')
  }

  if (!isCreatableFile(resolvedFilePath)) {
    throw new Error('Only Markdown and text files can be created.')
  }

  try {
    await access(resolvedFilePath)
    throw new Error('That file already exists.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  await mkdir(path.dirname(resolvedFilePath), { recursive: true })
  await writeFile(resolvedFilePath, '', 'utf8')

  return resolvedFilePath
}

export async function moveWorkspaceEntry(rootPath: string, entryPath: string, nextRelativePath: string) {
  const normalizedRelativePath = nextRelativePath.trim().replace(/^[\\/]+/, '')

  if (!normalizedRelativePath) {
    throw new Error('Destination path is required.')
  }

  const resolvedRootPath = path.resolve(rootPath)
  const resolvedCurrentEntryPath = path.resolve(entryPath)
  const resolvedNextEntryPath = path.resolve(resolvedRootPath, normalizedRelativePath)

  if (!isInsideWorkspace(resolvedRootPath, resolvedCurrentEntryPath) || !isInsideWorkspace(resolvedRootPath, resolvedNextEntryPath)) {
    throw new Error('Path must stay inside the current workspace.')
  }

  const currentInfo = await stat(resolvedCurrentEntryPath).catch(() => null)
  if (!currentInfo) {
    throw new Error('The selected item no longer exists.')
  }

  if (resolvedCurrentEntryPath === resolvedNextEntryPath) {
    return resolvedCurrentEntryPath
  }

  if (
    currentInfo.isDirectory()
    && isSamePathOrDescendant(resolvedNextEntryPath, resolvedCurrentEntryPath)
  ) {
    throw new Error('A folder cannot be moved into itself or one of its descendants.')
  }

  try {
    await access(resolvedNextEntryPath)
    throw new Error('That destination already exists.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  await mkdir(path.dirname(resolvedNextEntryPath), { recursive: true })
  await rename(resolvedCurrentEntryPath, resolvedNextEntryPath)

  return resolvedNextEntryPath
}

export async function deleteWorkspaceFile(rootPath: string, filePath: string) {
  const resolvedRootPath = path.resolve(rootPath)
  const resolvedFilePath = path.resolve(filePath)

  if (!isInsideWorkspace(resolvedRootPath, resolvedFilePath)) {
    throw new Error('File path must stay inside the current workspace.')
  }

  const fileInfo = await stat(resolvedFilePath).catch(() => null)
  if (!fileInfo) {
    throw new Error('The selected item no longer exists.')
  }

  if (fileInfo.isDirectory()) {
    // For now we only support deleting empty directories or use rm -rf logic
    // To be safe, let's keep it simple for files first or implement recursive delete
    await unlink(resolvedFilePath).catch(async () => {
      // If it's a directory, unlink might fail, try rm
      const { rm } = await import('node:fs/promises')
      await rm(resolvedFilePath, { recursive: true, force: true })
    })
  } else {
    await unlink(resolvedFilePath)
  }
}

export async function createWorkspaceDirectory(rootPath: string, relativeDirPath: string) {
  const normalizedRelativePath = relativeDirPath.trim().replace(/^[\\/]+/, '')

  if (!normalizedRelativePath) {
    throw new Error('Directory name is required.')
  }

  const resolvedRootPath = path.resolve(rootPath)
  const resolvedDirPath = path.resolve(resolvedRootPath, normalizedRelativePath)

  if (!isInsideWorkspace(resolvedRootPath, resolvedDirPath)) {
    throw new Error('Directory path must stay inside the current workspace.')
  }

  try {
    const info = await stat(resolvedDirPath)
    if (info.isDirectory()) {
      throw new Error('That directory already exists.')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  await mkdir(resolvedDirPath, { recursive: true })
  return resolvedDirPath
}

export async function watchWorkspace(
  rootPath: string,
  onChange: (event: WorkspaceChangeEvent) => void,
) {
  await unwatchWorkspace()

  workspaceWatcher = chokidar.watch(rootPath, {
    ignoreInitial: true,
    ignored: shouldIgnoreWorkspacePath,
  })

  const relay = (type: WorkspaceChangeEvent['type'], changedPath: string) => {
    onChange({
      rootPath,
      path: changedPath,
      type,
    })
  }

  workspaceWatcher
    .on('add', (changedPath) => relay('add', changedPath))
    .on('addDir', (changedPath) => relay('addDir', changedPath))
    .on('change', (changedPath) => relay('change', changedPath))
    .on('unlink', (changedPath) => relay('unlink', changedPath))
    .on('unlinkDir', (changedPath) => relay('unlinkDir', changedPath))
    .on('error', (error) => {
      if (isIgnorableWorkspaceWatcherError(error)) {
        return
      }

      throw error
    })
}

export async function unwatchWorkspace() {
  if (!workspaceWatcher) {
    return
  }

  await workspaceWatcher.close()
  workspaceWatcher = null
}
