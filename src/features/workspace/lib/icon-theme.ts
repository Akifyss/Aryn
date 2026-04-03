import type { WorkspaceIconTheme } from '@/features/workspace/types'

function normalizeIdentifier(value: string) {
  return value.trim().toLowerCase()
}

function getExtensionCandidates(fileName: string) {
  const segments = normalizeIdentifier(fileName).split('.')

  if (segments.length <= 1) {
    return []
  }

  const candidates: string[] = []

  for (let index = 1; index < segments.length; index += 1) {
    const candidate = segments.slice(index).join('.')
    if (candidate) {
      candidates.push(candidate)
    }
  }

  return candidates
}

export function resolveWorkspaceFileIconUrl(theme: WorkspaceIconTheme | null, fileName: string) {
  if (!theme) {
    return null
  }

  const normalizedFileName = normalizeIdentifier(fileName)

  if (theme.fileNames[normalizedFileName]) {
    return theme.fileNames[normalizedFileName]
  }

  for (const extensionCandidate of getExtensionCandidates(normalizedFileName)) {
    if (theme.fileExtensions[extensionCandidate]) {
      return theme.fileExtensions[extensionCandidate]
    }
  }

  return theme.defaultFileIcon
}

export function resolveWorkspaceDirectoryIconUrl(
  theme: WorkspaceIconTheme | null,
  directoryName: string,
  isExpanded: boolean,
) {
  if (!theme) {
    return null
  }

  const normalizedDirectoryName = normalizeIdentifier(directoryName)

  if (isExpanded) {
    return theme.folderNamesExpanded[normalizedDirectoryName]
      ?? theme.folderNames[normalizedDirectoryName]
      ?? theme.defaultFolderExpandedIcon
      ?? theme.defaultFolderIcon
  }

  return theme.folderNames[normalizedDirectoryName]
    ?? theme.defaultFolderIcon
    ?? theme.defaultFolderExpandedIcon
}
