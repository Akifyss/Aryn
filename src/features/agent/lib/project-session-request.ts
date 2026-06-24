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

export type AgentWorkspaceRestoreState = {
  lastAgentSessionPath: string | null
  prefersNewAgentSession?: boolean
}

export function resolveAgentWorkspaceSessionRestore(
  request: AgentProjectSessionRequest | null | undefined,
  workspaceState: AgentWorkspaceRestoreState,
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

  if (workspaceState.prefersNewAgentSession) {
    return {
      options: { restoreSession: false },
      preferredSessionPath: null,
    }
  }

  return {
    preferredSessionPath: workspaceState.lastAgentSessionPath,
  }
}
