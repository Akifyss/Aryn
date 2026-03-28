import { access, readFile, readdir, mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'

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

const IGNORED_NAMES = new Set(['.git', 'node_modules', 'dist', 'dist-electron'])
const OPENABLE_EXTENSIONS = new Set([
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

function isOpenableFile(entryName: string) {
  return OPENABLE_EXTENSIONS.has(path.extname(entryName).toLowerCase())
}

function isInsideWorkspace(rootPath: string, targetPath: string) {
  return targetPath === rootPath || targetPath.startsWith(rootPath + path.sep)
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

          if (children.length === 0) {
            return null
          }

          return {
            name: entry.name,
            path: entryPath,
            kind: 'directory' as const,
            children,
          }
        }

        if (!isOpenableFile(entry.name)) {
          return null
        }

        return {
          name: entry.name,
          path: entryPath,
          kind: 'file' as const,
          isOpenable: true,
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

export async function workspacePathExists(workspacePath: string) {
  try {
    const info = await stat(workspacePath)
    return info.isDirectory()
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

  if (!isOpenableFile(resolvedFilePath)) {
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

export async function renameWorkspaceFile(rootPath: string, filePath: string, nextRelativeFilePath: string) {
  const normalizedRelativePath = nextRelativeFilePath.trim().replace(/^[\\/]+/, '')

  if (!normalizedRelativePath) {
    throw new Error('File name is required.')
  }

  const resolvedRootPath = path.resolve(rootPath)
  const resolvedCurrentFilePath = path.resolve(filePath)
  const resolvedNextFilePath = path.resolve(resolvedRootPath, normalizedRelativePath)

  if (!isInsideWorkspace(resolvedRootPath, resolvedCurrentFilePath) || !isInsideWorkspace(resolvedRootPath, resolvedNextFilePath)) {
    throw new Error('File path must stay inside the current workspace.')
  }

  if (!isOpenableFile(resolvedNextFilePath)) {
    throw new Error('Only Markdown and text files are supported.')
  }

  const currentInfo = await stat(resolvedCurrentFilePath).catch(() => null)
  if (!currentInfo?.isFile()) {
    throw new Error('The selected file no longer exists.')
  }

  if (resolvedCurrentFilePath === resolvedNextFilePath) {
    return resolvedCurrentFilePath
  }

  try {
    await access(resolvedNextFilePath)
    throw new Error('That file already exists.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  await mkdir(path.dirname(resolvedNextFilePath), { recursive: true })
  await rename(resolvedCurrentFilePath, resolvedNextFilePath)

  return resolvedNextFilePath
}

export async function deleteWorkspaceFile(rootPath: string, filePath: string) {
  const resolvedRootPath = path.resolve(rootPath)
  const resolvedFilePath = path.resolve(filePath)

  if (!isInsideWorkspace(resolvedRootPath, resolvedFilePath)) {
    throw new Error('File path must stay inside the current workspace.')
  }

  const fileInfo = await stat(resolvedFilePath).catch(() => null)
  if (!fileInfo?.isFile()) {
    throw new Error('The selected file no longer exists.')
  }

  await unlink(resolvedFilePath)
}

export async function watchWorkspace(
  rootPath: string,
  onChange: (event: WorkspaceChangeEvent) => void,
) {
  await unwatchWorkspace()

  workspaceWatcher = chokidar.watch(rootPath, {
    ignoreInitial: true,
    ignored: (watchedPath) => watchedPath.split(path.sep).some(shouldIgnore),
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
}

export async function unwatchWorkspace() {
  if (!workspaceWatcher) {
    return
  }

  await workspaceWatcher.close()
  workspaceWatcher = null
}
