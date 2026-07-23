import path from 'node:path'

export function createWorkspaceIdentity(workspacePath: string) {
  const resolvedPath = path.resolve(workspacePath)
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath
}

export function createSessionRuntimeKey(workspacePath: string, sessionId: string) {
  return `${createWorkspaceIdentity(workspacePath)}\0${sessionId}`
}

export function createWorkspaceRuntimeKeyPrefix(workspacePath: string) {
  return `${createWorkspaceIdentity(workspacePath)}\0`
}
