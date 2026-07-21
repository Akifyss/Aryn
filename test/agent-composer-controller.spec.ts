import { describe, expect, it } from 'vitest'
import {
  hasAgentComposerPayload,
  type AgentComposerAttachment,
} from '@/features/agent/composer/use-agent-composer-draft'
import { resolveSupportedRunningPromptBehavior } from '@/features/agent/composer/use-agent-composer-actions'

describe('Agent Composer controller helpers', () => {
  it('treats whitespace-only text as an empty payload', () => {
    expect(hasAgentComposerPayload({ mentions: [], value: '  \n  ' }, [])).toBe(false)
  })

  it('treats attachments as payload without text', () => {
    const attachment: AgentComposerAttachment = {
      fileName: 'notes.txt',
      id: 'attachment-1',
      kind: 'file',
      path: 'C:\\workspace\\notes.txt',
      size: 12,
    }

    expect(hasAgentComposerPayload({ mentions: [], value: '' }, [attachment])).toBe(true)
  })

  it('keeps a requested running behavior when the runtime supports it', () => {
    expect(resolveSupportedRunningPromptBehavior(['steer', 'followUp'], 'followUp')).toBe('followUp')
  })

  it('falls back to the first runtime-supported running behavior', () => {
    expect(resolveSupportedRunningPromptBehavior(['steer'], 'followUp')).toBe('steer')
  })

  it('uses follow-up behavior when the runtime reports no supported behavior', () => {
    expect(resolveSupportedRunningPromptBehavior([], 'steer')).toBe('followUp')
  })
})
