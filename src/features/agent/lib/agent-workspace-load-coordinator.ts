import type { AgentId } from '@/features/agent/agent-definition'
import type { AgentWorkspaceState } from '@/features/agent/types'
import { normalizeAgentProjectPath } from '@/features/agent/lib/session-tree'

export type AgentWorkspaceLoadRequest = {
  agentId: AgentId
  preferredSessionPath: string | null
  restoreSession: boolean
  workspacePath: string
}

export type AgentWorkspaceLoadResult = {
  state: AgentWorkspaceState
  status: 'completed'
} | {
  status: 'superseded'
}

export type LoadAgentWorkspaceState = (
  request: AgentWorkspaceLoadRequest,
  options?: { reuseSettled?: boolean },
) => Promise<AgentWorkspaceLoadResult>

type InFlightWorkspaceLoad = {
  key: string
  promise: Promise<AgentWorkspaceLoadResult>
}

type SettledWorkspaceLoad = {
  key: string
  state: AgentWorkspaceState
}

function workspaceLoadKey(request: AgentWorkspaceLoadRequest) {
  return [
    request.agentId,
    normalizeAgentProjectPath(request.workspacePath),
    request.preferredSessionPath
      ? normalizeAgentProjectPath(request.preferredSessionPath)
      : '',
    request.restoreSession ? 'restore' : 'new',
  ].join('\n')
}

/**
 * Coordinates every renderer-initiated workspace load for one Agent surface.
 * Identical concurrent requests share one native activation, while a newer,
 * different target turns older completions and failures into cancellation.
 */
export class AgentWorkspaceLoadCoordinator {
  private inFlight: InFlightWorkspaceLoad | null = null
  private revision = 0
  private settled: SettledWorkspaceLoad | null = null

  load(
    request: AgentWorkspaceLoadRequest,
    loader: () => Promise<AgentWorkspaceState>,
    options: { reuseSettled?: boolean } = {},
  ): Promise<AgentWorkspaceLoadResult> {
    const key = workspaceLoadKey(request)
    if (this.inFlight?.key === key) return this.inFlight.promise
    if (options.reuseSettled && this.settled?.key === key) {
      return Promise.resolve({ state: this.settled.state, status: 'completed' })
    }

    const revision = this.revision + 1
    this.revision = revision
    this.settled = null
    const promise = loader().then<AgentWorkspaceLoadResult, AgentWorkspaceLoadResult>(
      (state) => {
        if (this.revision !== revision) return { status: 'superseded' }
        this.settled = { key, state }
        return { state, status: 'completed' }
      },
      (error) => {
        if (this.revision !== revision) return { status: 'superseded' }
        throw error
      },
    ).finally(() => {
      if (this.inFlight?.promise === promise) this.inFlight = null
    })
    this.inFlight = { key, promise }
    return promise
  }

  invalidate() {
    this.revision += 1
    this.inFlight = null
    this.settled = null
  }
}
