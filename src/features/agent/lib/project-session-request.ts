export type AgentProjectSessionRequest = {
  kind: 'new'
  projectId: string
  requestId: number
} | {
  kind: 'session'
  projectId: string
  requestId: number
  sessionPath: string
}

export type AgentWorkspaceSessionRestore = {
  options?: { restoreSession: false }
  preferredSessionPath: string | null
}

export function resolveAgentWorkspaceSessionRestore(
  request: AgentProjectSessionRequest | null | undefined,
  lastAgentSessionPath: string | null,
): AgentWorkspaceSessionRestore {
  if (request?.kind === 'new') {
    return {
      options: { restoreSession: false },
      preferredSessionPath: null,
    }
  }

  if (request?.kind === 'session') {
    return {
      preferredSessionPath: request.sessionPath,
    }
  }

  return {
    preferredSessionPath: lastAgentSessionPath,
  }
}
