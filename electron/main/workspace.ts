import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'

export type WorkspaceNode = {
  name: string
  path: string
  kind: 'directory' | 'file'
  children?: WorkspaceNode[]
}

export type WorkspaceChangeEvent = {
  rootPath: string
  path: string
  type: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir'
}

const IGNORED_NAMES = new Set(['.git', 'node_modules', 'dist', 'dist-electron'])

let workspaceWatcher: FSWatcher | null = null

function shouldIgnore(entryName: string) {
  return IGNORED_NAMES.has(entryName)
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
    const nodes = await Promise.all(entries
      .filter((entry) => !shouldIgnore(entry.name))
      .map(async (entry) => {
        const entryPath = path.join(currentPath, entry.name)

        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: entryPath,
            kind: 'directory' as const,
            children: await walk(entryPath),
          }
        }

        return {
          name: entry.name,
          path: entryPath,
          kind: 'file' as const,
        }
      }))

    return nodes.sort(sortNodes)
  }

  return walk(rootPath)
}

export async function loadWorkspaceFile(filePath: string) {
  return readFile(filePath, 'utf8')
}

export async function saveWorkspaceFile(filePath: string, content: string) {
  await writeFile(filePath, content, 'utf8')
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
