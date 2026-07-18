export function formatWorkspaceRelativePath(filePath: string, workspaceRoot?: string) {
  if (!workspaceRoot) return filePath
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '')
  const normalizedPath = filePath.replace(/\\/g, '/')
  if (normalizedPath.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }
  return filePath
}
