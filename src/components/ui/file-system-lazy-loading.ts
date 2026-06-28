export const LAZY_SCOPE_LOAD_CONCURRENCY = 4

type LazyFolderIndex = {
  children: ReadonlyMap<string, readonly unknown[]>
  folders: ReadonlyMap<string, { hasChildren?: boolean }>
}

export function canRequestFolderChildren(
  index: LazyFolderIndex,
  folderPath: string,
  currentPath: string
) {
  if ((index.children.get(folderPath)?.length ?? 0) > 0) return false
  if (folderPath === "") return true

  const folder = index.folders.get(folderPath)

  return folder?.hasChildren === true || (folderPath === currentPath && !folder)
}

export function collectLazyFolderLoadCandidates({
  currentPath,
  index,
  limit = Number.POSITIVE_INFINITY,
  loadingFolders,
  requestedFolders,
}: {
  currentPath: string
  index: LazyFolderIndex
  limit?: number
  loadingFolders: ReadonlySet<string>
  requestedFolders: ReadonlySet<string>
}) {
  if (limit <= 0) return []

  const candidates: string[] = []
  const addCandidate = (folderPath: string) => {
    if (candidates.length >= limit) return
    if (requestedFolders.has(folderPath) || loadingFolders.has(folderPath)) {
      return
    }
    if (!canRequestFolderChildren(index, folderPath, currentPath)) return

    candidates.push(folderPath)
  }

  addCandidate(currentPath)

  const folderPaths = [...index.folders.keys()]
    .filter(
      (folderPath) =>
        folderPath !== currentPath &&
        (currentPath === "" || folderPath.startsWith(currentPath))
    )
    .sort((left, right) => left.length - right.length)

  for (const folderPath of folderPaths) {
    addCandidate(folderPath)
    if (candidates.length >= limit) break
  }

  return candidates
}
