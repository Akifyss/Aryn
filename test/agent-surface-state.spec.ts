import { describe, expect, it } from 'vitest'
import {
  shouldShowAgentNewConversationPrompt,
  shouldShowAgentProjectSessionMenu,
  shouldShowAgentThreadbarSessionControl,
} from '../src/features/agent/lib/agent-surface-state'

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

  it('hides the threadbar session control only for standalone conversation drafts', () => {
    expect(shouldShowAgentThreadbarSessionControl(
      { kind: 'conversationDraft' },
      { kind: 'new' },
    )).toBe(false)
    expect(shouldShowAgentThreadbarSessionControl(
      { kind: 'project', projectId: 'project-1' },
      { kind: 'new' },
    )).toBe(true)
    expect(shouldShowAgentThreadbarSessionControl(
      { kind: 'conversation', conversationId: 'conversation-1' },
      { kind: 'new' },
    )).toBe(true)
  })

  it('keeps the project session menu identity independent of runtime readiness', () => {
    expect(shouldShowAgentProjectSessionMenu({ kind: 'project', projectId: 'project-1' })).toBe(true)
    expect(shouldShowAgentProjectSessionMenu({ kind: 'conversationDraft' })).toBe(false)
    expect(shouldShowAgentProjectSessionMenu({
      kind: 'conversation',
      conversationId: 'conversation-1',
    })).toBe(false)
  })
})
