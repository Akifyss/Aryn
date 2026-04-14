import { describe, expect, it } from 'vitest'
import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import { serializeSessionEntries } from '../electron/main/agent'

describe('agent session serialization', () => {
  it('keeps thinking-only assistant messages without placeholder text', () => {
    const entries: SessionEntry[] = [
      {
        id: 'assistant-1',
        parentId: null,
        timestamp: '2026-04-08T17:05:56.123Z',
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'Internal reasoning that should stay behind the disclosure.',
              thinkingSignature: 'reasoning',
            },
          ],
          api: 'openai-completions',
          model: 'deepseek/deepseek-v3.2-exp',
          provider: 'openrouter',
          responseId: 'resp-1',
          stopReason: 'stop',
          timestamp: 1775667945852,
          usage: {
            cacheRead: 0,
            cacheWrite: 0,
            input: 1,
            output: 1,
            totalTokens: 2,
            cost: {
              cacheRead: 0,
              cacheWrite: 0,
              input: 0,
              output: 0,
              total: 0,
            },
          },
        },
      } as SessionEntry,
    ]

    expect(serializeSessionEntries(entries)).toEqual([
      {
        id: 'assistant-1775667945852-0',
        kind: 'assistant',
        sessionEntryId: 'assistant-1',
        text: '',
        thinkingText: 'Internal reasoning that should stay behind the disclosure.',
        timestamp: 1775667945852,
        isError: false,
      },
    ])
  })

  it('attaches the originating entry id to the first visible tool message when assistant text is empty', () => {
    const entries: SessionEntry[] = [
      {
        id: 'assistant-2',
        parentId: null,
        timestamp: '2026-04-08T17:05:59.123Z',
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'tool-call-1',
              name: 'write',
              arguments: {
                path: 'docs/outline.md',
              },
            },
          ],
          api: 'openai-completions',
          model: 'deepseek/deepseek-v3.2-exp',
          provider: 'openrouter',
          responseId: 'resp-2',
          stopReason: 'stop',
          timestamp: 1775667949123,
          usage: {
            cacheRead: 0,
            cacheWrite: 0,
            input: 1,
            output: 1,
            totalTokens: 2,
            cost: {
              cacheRead: 0,
              cacheWrite: 0,
              input: 0,
              output: 0,
              total: 0,
            },
          },
        },
      } as SessionEntry,
    ]

    expect(serializeSessionEntries(entries)).toEqual([
      expect.objectContaining({
        id: 'tool-call-1',
        kind: 'tool',
        sessionEntryId: 'assistant-2',
        status: 'running',
        title: 'write',
      }),
    ])
  })
})
