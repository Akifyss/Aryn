import { describe, expect, it } from 'vitest'
import { createCodexTimelineModel } from './adapter'
import type { CodexNativeSessionSnapshot } from './contracts'

function snapshot(overrides: Partial<CodexNativeSessionSnapshot> = {}): CodexNativeSessionSnapshot {
  return {
    agentId: 'codex',
    itemRuntime: {},
    notices: [],
    sequence: 1,
    status: { type: 'idle' },
    thread: {
      id: 'thread-1',
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_001,
      cwd: 'C:\\workspace',
      turns: [],
    },
    tokenUsage: null,
    turnRuntime: {},
    ...overrides,
  }
}

describe('createCodexTimelineModel', () => {
  it('preserves official item ordering and deduplicates an optimistic user message by clientId', () => {
    const input = snapshot({
      thread: {
        id: 'thread-1',
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_001,
        cwd: 'C:\\workspace',
        turns: [{
          id: 'turn-1',
          status: 'completed',
          error: null,
          startedAt: 1_700_000_000,
          completedAt: 1_700_000_001,
          durationMs: 1000,
          items: [
            { type: 'userMessage', id: 'user-1', clientId: 'client-1', content: [{ type: 'text', text: 'Hello' }] },
            { type: 'commandExecution', id: 'tool-1', command: 'pwd', cwd: 'C:\\workspace', status: 'completed', aggregatedOutput: 'C:\\workspace', exitCode: 0 },
            { type: 'agentMessage', id: 'assistant-1', text: 'Done', phase: 'final_answer' },
          ],
        }],
      },
    })

    const result = createCodexTimelineModel(input, [
      { id: 'client-1', text: 'Hello', timestamp: 1_700_000_000_000 },
    ])

    expect(result.timelineEntries.map((entry) => entry.id)).toEqual(['user-1', 'tool-1', 'assistant-1'])
    expect(result.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(result.messages.at(-1)?.streaming).toBe(false)
  })

  it('deduplicates a recent optimistic user message when hydrated history omits clientId', () => {
    const input = snapshot({
      thread: {
        id: 'thread-1',
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_001,
        cwd: 'C:\\workspace',
        turns: [{
          id: 'turn-1',
          status: 'completed',
          error: null,
          startedAt: 1_700_000_000,
          completedAt: 1_700_000_001,
          durationMs: 1000,
          items: [
            { type: 'userMessage', id: 'user-1', clientId: null, content: [{ type: 'text', text: 'Hello' }] },
            { type: 'agentMessage', id: 'assistant-1', text: 'Done', phase: 'final_answer' },
          ],
        }],
      },
    })

    const result = createCodexTimelineModel(input, [
      { id: 'optimistic-1', text: 'Hello', timestamp: 1_700_000_000_500 },
    ])

    expect(result.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(result.timelineEntries.map((entry) => entry.id)).toEqual(['user-1', 'assistant-1'])
  })

  it('marks only the last assistant item as streaming within an active turn', () => {
    const input = snapshot({
      status: { type: 'busy' },
      thread: {
        id: 'thread-1',
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_001,
        cwd: 'C:\\workspace',
        turns: [{
          id: 'turn-1',
          status: 'inProgress',
          error: null,
          startedAt: 1_700_000_000,
          completedAt: null,
          durationMs: null,
          items: [
            { type: 'userMessage', id: 'user-1', clientId: null, content: [{ type: 'text', text: 'Work' }] },
            { type: 'agentMessage', id: 'commentary-1', text: 'Checking', phase: 'commentary' },
            { type: 'commandExecution', id: 'tool-1', command: 'pwd', cwd: 'C:\\workspace', status: 'completed', exitCode: 0 },
            { type: 'agentMessage', id: 'assistant-1', text: 'Still working', phase: 'commentary' },
          ],
        }],
      },
    })

    const result = createCodexTimelineModel(input)

    expect(result.isWorking).toBe(true)
    expect(result.runningTurnId).toBe('turn-1')
    expect(result.messages.find((message) => message.id === 'commentary-1')?.streaming).toBe(false)
    expect(result.messages.find((message) => message.id === 'assistant-1')?.streaming).toBe(true)
  })

  it('keeps MCP rows compact while preserving arguments for deliberate expansion', () => {
    const largeResult = { content: 'x'.repeat(1000) }
    const input = snapshot({
      thread: {
        id: 'thread-1',
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_001,
        cwd: 'C:\\workspace',
        turns: [{
          id: 'turn-1',
          status: 'completed',
          error: null,
          startedAt: 1_700_000_000,
          completedAt: 1_700_000_001,
          durationMs: 1000,
          items: [{
            type: 'mcpToolCall',
            id: 'mcp-1',
            server: 'browser',
            tool: 'open',
            status: 'completed',
            arguments: { url: 'https://example.com' },
            result: largeResult,
            error: null,
          }],
        }],
      },
    })

    const result = createCodexTimelineModel(input)
    const entry = result.workEntries[0]

    expect(entry?.label).toBe('browser / open')
    expect(entry?.detail?.length).toBeLessThanOrEqual(180)
    expect(entry?.toolData).toEqual({ url: 'https://example.com' })
  })

  it('turns retry notices and failed commands into visible failure rows', () => {
    const input = snapshot({
      notices: [{ id: 'retry-1', kind: 'error', message: 'Disconnected', turnId: 'turn-1', willRetry: true }],
      status: { type: 'retry', attempt: 1, message: 'Retrying', next: 1_700_000_010 },
      thread: {
        id: 'thread-1',
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_001,
        cwd: 'C:\\workspace',
        turns: [{
          id: 'turn-1',
          status: 'failed',
          error: { message: 'Command failed' },
          startedAt: 1_700_000_000,
          completedAt: 1_700_000_001,
          durationMs: 1000,
          items: [{ type: 'commandExecution', id: 'tool-1', command: 'exit 1', status: 'failed', exitCode: 1 }],
        }],
      },
    })

    const result = createCodexTimelineModel(input)

    expect(result.isWorking).toBe(true)
    expect(result.workEntries.find((entry) => entry.id === 'tool-1')?.tone).toBe('error')
    expect(result.workEntries.find((entry) => entry.id === 'notice:retry-1')?.label).toBe('Retrying')
    expect(result.workEntries.find((entry) => entry.id === 'turn-1:error')?.detail).toBe('Command failed')
  })

  it('preserves image and workspace attachments from official user input items', () => {
    const input = snapshot({
      thread: {
        id: 'thread-1',
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_001,
        cwd: 'C:\\workspace',
        turns: [{
          id: 'turn-1',
          status: 'completed',
          error: null,
          startedAt: 1_700_000_000,
          completedAt: 1_700_000_001,
          durationMs: 1000,
          items: [{
            type: 'userMessage',
            id: 'user-1',
            clientId: null,
            content: [
              { type: 'text', text: 'Inspect these' },
              { type: 'image', url: 'data:image/png;base64,abc' },
              { type: 'localImage', path: 'C:\\workspace\\local image.png' },
              { type: 'mention', name: 'app.ts', path: 'C:\\workspace\\app.ts' },
            ],
          }],
        }],
      },
    })

    const attachments = createCodexTimelineModel(input).messages[0]?.attachments

    expect(attachments).toHaveLength(3)
    expect(attachments?.[0]?.previewUrl).toBe('data:image/png;base64,abc')
    expect(attachments?.[1]?.previewUrl).toBe('file:///C:/workspace/local%20image.png')
    expect(attachments?.[2]?.url).toBe('C:\\workspace\\app.ts')
  })

  it('keeps optimistic image attachments previewable before App Server persistence', () => {
    const result = createCodexTimelineModel(snapshot(), [{
      id: 'optimistic-1',
      text: 'Inspect this',
      timestamp: 1_700_000_000_000,
      attachments: [{
        name: 'screen.png',
        mimeType: 'image/png',
        url: 'data:image/png;base64,abc',
      }],
    }])

    expect(result.messages[0]?.attachments?.[0]).toMatchObject({
      name: 'screen.png',
      previewUrl: 'data:image/png;base64,abc',
      type: 'image',
    })
  })

  it('maps App Server plan and file-change state into T3 plan and turn-summary rows', () => {
    const input = snapshot({
      thread: {
        id: 'thread-1',
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_001,
        cwd: 'C:\\workspace',
        turns: [{
          id: 'turn-1',
          status: 'completed',
          error: null,
          startedAt: 1_700_000_000,
          completedAt: 1_700_000_001,
          durationMs: 1000,
          items: [
            {
              type: 'fileChange',
              id: 'file-1',
              status: 'completed',
              changes: [{ path: 'src/app.ts', kind: 'update', diff: '@@\n-old\n+new' }],
            },
            { type: 'agentMessage', id: 'assistant-1', text: 'Done', phase: 'final_answer' },
          ],
        }],
      },
      turnRuntime: {
        'turn-1': {
          diff: '@@\n-old\n+new',
          plan: {
            explanation: 'Implementation plan',
            steps: [
              { step: 'Inspect', status: 'completed' },
              { step: 'Verify', status: 'inProgress' },
            ],
          },
        },
      },
    })

    const result = createCodexTimelineModel(input)

    expect(result.proposedPlans[0]?.planMarkdown).toContain('- [x] Inspect')
    expect(result.proposedPlans[0]?.planMarkdown).toContain('- [ ] Verify _(in progress)_')
    expect(result.turnDiffSummaryByAssistantMessageId.get('assistant-1')?.files).toEqual([{
      additions: 1,
      deletions: 1,
      patch: '@@\n-old\n+new',
      path: 'src/app.ts',
    }])
  })

  it('keeps every supported App Server activity type in the work-log model', () => {
    const input = snapshot({
      thread: {
        id: 'thread-1',
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_001,
        cwd: 'C:\\workspace',
        turns: [{
          id: 'turn-1',
          status: 'completed',
          error: null,
          startedAt: 1_700_000_000,
          completedAt: 1_700_000_001,
          durationMs: 1000,
          items: [
            { type: 'reasoning', id: 'reasoning-1', summary: ['Inspecting'] },
            { type: 'dynamicToolCall', id: 'dynamic-1', tool: 'lookup', status: 'completed', contentItems: [{ type: 'inputText', text: 'done' }] },
            { type: 'collabAgentToolCall', id: 'collab-1', tool: 'spawnAgent', status: 'completed', prompt: 'Review this' },
            { type: 'subAgentActivity', id: 'subagent-1', kind: 'started', agentPath: 'reviewer' },
            { type: 'webSearch', id: 'search-1', query: 'Codex App Server' },
            { type: 'imageView', id: 'image-view-1', path: 'C:\\workspace\\screen.png' },
            { type: 'imageGeneration', id: 'image-generation-1', status: 'completed', savedPath: 'C:\\workspace\\result.png' },
            { type: 'sleep', id: 'sleep-1', durationMs: 500 },
            { type: 'hookPrompt', id: 'hook-1', fragments: [{ text: 'hook' }] },
            { type: 'enteredReviewMode', id: 'review-enter-1', review: 'Review changes' },
            { type: 'exitedReviewMode', id: 'review-exit-1', review: 'Review complete' },
            { type: 'contextCompaction', id: 'compact-1' },
          ],
        }],
      },
    })

    const result = createCodexTimelineModel(input)

    expect(result.workEntries.map((entry) => entry.id)).toEqual([
      'reasoning-1',
      'dynamic-1',
      'collab-1',
      'subagent-1',
      'search-1',
      'image-view-1',
      'image-generation-1',
      'sleep-1',
      'hook-1',
      'review-enter-1',
      'review-exit-1',
      'compact-1',
    ])
  })

  it('keeps future App Server item types visible instead of silently dropping them', () => {
    const input = snapshot({
      thread: {
        id: 'thread-1',
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_001,
        cwd: 'C:\\workspace',
        turns: [{
          id: 'turn-1',
          status: 'completed',
          error: null,
          startedAt: 1_700_000_000,
          completedAt: 1_700_000_001,
          durationMs: 1000,
          items: [{ type: 'futureActivity', id: 'future-1' }],
        }],
      },
    })

    expect(createCodexTimelineModel(input).workEntries[0]).toMatchObject({
      id: 'future-1',
      label: 'Codex activity',
      detail: 'futureActivity',
      tone: 'info',
    })
  })
})
