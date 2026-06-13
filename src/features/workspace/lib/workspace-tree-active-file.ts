export type WorkspaceTreeActiveFileMode = 'track-active-file' | 'none'

export function resolveWorkspaceTreeActiveFilePath(
  activeFilePath: string | null,
  activeFileMode: WorkspaceTreeActiveFileMode,
) {
  return activeFileMode === 'none' ? null : activeFilePath
}
