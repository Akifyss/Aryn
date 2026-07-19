import { describe, expect, it } from 'vitest'
import { shouldShowAgentNewConversationPrompt } from '../src/features/agent/lib/agent-surface-state'

describe('shouldShowAgentNewConversationPrompt', () => {
  it('shows the prompt for true new-session entry points', () => {
    expect(shouldShowAgentNewConversationPrompt({ kind: 'conversationDraft' }, { kind: 'new' })).toBe(true)
    expect(shouldShowAgentNewConversationPrompt({ kind: 'project', projectId: 'project-1' }, { kind: 'new' })).toBe(true)
  })

  it('does not treat a selected conversation record without a restored session as a new conversation', () => {
    expect(shouldShowAgentNewConversationPrompt({ kind: 'conversation', conversationId: 'conversation-1' }, { kind: 'new' })).toBe(false)
  })

  it('hides the prompt when an actual session is selected', () => {
    expect(shouldShowAgentNewConversationPrompt({ kind: 'project', projectId: 'project-1' }, {
      agentId: 'codex',
      kind: 'session',
      sessionPath: 'session-a',
    })).toBe(false)
  })
})
