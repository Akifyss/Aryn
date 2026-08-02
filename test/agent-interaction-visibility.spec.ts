import { describe, expect, it } from 'vitest'
import { findVisiblePendingInteraction } from '@/features/agent/lib/interaction-visibility'

const request = {
  agentId: 'pi' as const,
  id: 'request-1',
  kind: 'question' as const,
  message: 'Choose',
  options: [],
  sessionId: 'active-session',
  title: 'Choice',
  workspacePath: 'C:/workspace',
}

describe('pending interaction visibility', () => {
  it('shows the interaction only while viewing its active runtime session', () => {
    const options = {
      activeRuntimeSessionId: 'active-session',
      isViewingActiveRuntime: true,
      pendingInteractions: [request],
      selectedAgentId: 'pi' as const,
      workspacePath: 'C:/workspace',
    }

    expect(findVisiblePendingInteraction(options)).toEqual(request)
    expect(findVisiblePendingInteraction({
      ...options,
      isViewingActiveRuntime: false,
    })).toBeNull()
  })

  it('does not expose another session or provider interaction', () => {
    expect(findVisiblePendingInteraction({
      activeRuntimeSessionId: 'other-session',
      isViewingActiveRuntime: true,
      pendingInteractions: [request],
      selectedAgentId: 'pi',
      workspacePath: 'C:/workspace',
    })).toBeNull()
    expect(findVisiblePendingInteraction({
      activeRuntimeSessionId: 'active-session',
      isViewingActiveRuntime: true,
      pendingInteractions: [request],
      selectedAgentId: 'codex',
      workspacePath: 'C:/workspace',
    })).toBeNull()
  })
})
