import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { buildRenderedAgentMessages } from '../src/features/agent/components/agent-message-viewport/use-agent-message-presentation'
import {
  buildNativeOptimisticUserMessages,
  reconcileOptimisticAgentUserMessages,
  type OptimisticAgentUserMessage,
} from '../src/features/agent/lib/optimistic-user-messages'
import type { AgentSessionSnapshot, AgentSidebarMessage } from '../src/features/agent/types'

function createUserMessage(
  id: string,
  text: string,
  timestamp: number,
): AgentSidebarMessage {
  return {
    id,
    kind: 'user',
    text,
    timestamp,
  }
}

function createOptimisticMessage(
  id: string,
  text: string,
  timestamp: number,
  overrides: Partial<OptimisticAgentUserMessage> = {},
): OptimisticAgentUserMessage {
  return {
    agentId: 'codex',
    message: createUserMessage(id, text, timestamp),
    sessionPath: 'session-a',
    ...overrides,
  }
}

describe('agent optimistic user messages', () => {
  it('keeps the existing optimistic collection when the snapshot has no user messages', () => {
    const current = [createOptimisticMessage('optimistic-user', 'Hello', 10_000)]
    const snapshot: AgentSessionSnapshot = {
      annotations: { fileChangesByEntryId: {} },
      messages: [],
      name: null,
      sessionId: 'session-id',
      sessionPath: 'session-a',
      workspacePath: 'C:/workspace',
    }

    expect(reconcileOptimisticAgentUserMessages(current, 'codex', snapshot)).toBe(current)
  })

  it('reconciles non-native persisted messages by content within the timestamp window', () => {
    const snapshot: AgentSessionSnapshot = {
      annotations: { fileChangesByEntryId: {} },
      messages: [createUserMessage('persisted-user', 'Hello', 10_000)],
      name: null,
      sessionId: 'session-id',
      sessionPath: 'session-a',
      workspacePath: 'C:/workspace',
    }
    const unmatched = createOptimisticMessage('optimistic-late', 'Hello', 80_001)
    const otherSession = createOptimisticMessage('optimistic-other', 'Hello', 10_001, {
      sessionPath: 'session-b',
    })

    expect(reconcileOptimisticAgentUserMessages([
      createOptimisticMessage('optimistic-match', 'Hello', 10_001),
      unmatched,
      otherSession,
    ], 'codex', snapshot)).toEqual([unmatched, otherSession])
  })

  it('requires exact native message IDs when reconciling OpenCode prompts', () => {
    const snapshot = {
      annotations: { fileChangesByEntryId: {} },
      messages: [],
      name: null,
      native: {
        agentId: 'opencode',
        diffs: [],
        messages: [{
          info: {
            id: 'persisted-user',
            role: 'user',
            time: { created: 10_000 },
          },
          parts: [{ text: 'Hello', type: 'text' }],
        }],
        parentSessionId: null,
        status: { type: 'idle' },
      },
      sessionId: 'session-id',
      sessionPath: 'session-a',
      workspacePath: 'C:/workspace',
    } as unknown as AgentSessionSnapshot
    const sameContent = createOptimisticMessage('optimistic-user', 'Hello', 10_001, {
      agentId: 'opencode',
    })

    expect(reconcileOptimisticAgentUserMessages([
      sameContent,
      createOptimisticMessage('persisted-user', 'Hello', 10_001, { agentId: 'opencode' }),
    ], 'opencode', snapshot)).toEqual([sameContent])
  })

  it('adapts optimistic image attachments for native OpenCode and Pi surfaces', () => {
    const entry = createOptimisticMessage('optimistic-user', 'Describe this', 10_000, {
      message: {
        ...createUserMessage('optimistic-user', 'Describe this', 10_000),
        attachments: [{
          data: 'data:image/png;base64,aW1hZ2U=',
          fileName: 'image.png',
          kind: 'image',
          mimeType: 'image/png',
        }],
      },
      nativePartIds: ['text-part', 'image-part'],
    })

    const adapted = buildNativeOptimisticUserMessages([entry])

    expect(adapted.codex).toEqual([entry.message])
    expect(adapted.openCode).toEqual([expect.objectContaining({
      attachments: [expect.objectContaining({
        partId: 'image-part',
        url: 'data:image/png;base64,aW1hZ2U=',
      })],
      textPartId: 'text-part',
    })])
    expect(adapted.piWeb).toEqual([{
      content: [
        { text: 'Describe this', type: 'text' },
        {
          source: {
            data: 'aW1hZ2U=',
            media_type: 'image/png',
            type: 'base64',
          },
          type: 'image',
        },
      ],
      timestamp: 10_000,
    }])
  })
})

describe('agent message presentation', () => {
  it('merges live tools and draft output only into the active runtime view', () => {
    const persistedTool: AgentSidebarMessage = {
      id: 'tool-existing',
      kind: 'tool',
      sessionEntryId: 'entry-1',
      status: 'done',
      text: 'Old summary',
      timestamp: 1,
      title: 'Read',
    }

    const rendered = buildRenderedAgentMessages({
      draftAssistant: 'Draft response',
      draftThinking: 'Thinking',
      isThinkingStreaming: true,
      isViewingActiveRuntime: true,
      liveTools: [
        { id: 'tool-existing', name: 'Read', status: 'running', summary: 'Reading' },
        { id: 'tool-new', name: 'Search', status: 'done', summary: 'Found it' },
      ],
      optimisticUserMessages: [createUserMessage('optimistic-user', 'Question', 2)],
      persistedMessages: [persistedTool],
    })

    expect(rendered).toHaveLength(4)
    expect(rendered[0]).toEqual(expect.objectContaining({
      id: 'tool-existing',
      sessionEntryId: 'entry-1',
      status: 'running',
      text: 'Reading',
    }))
    expect(rendered[2]).toEqual(expect.objectContaining({ id: 'tool-new', kind: 'tool' }))
    expect(rendered[3]).toEqual(expect.objectContaining({
      id: 'draft-assistant',
      isThinkingStreaming: true,
      text: 'Draft response',
      thinkingText: 'Thinking',
    }))

    expect(buildRenderedAgentMessages({
      draftAssistant: 'Hidden draft',
      draftThinking: '',
      isThinkingStreaming: false,
      isViewingActiveRuntime: false,
      liveTools: [{ id: 'tool-new', name: 'Search', status: 'running', summary: 'Searching' }],
      optimisticUserMessages: [],
      persistedMessages: [persistedTool],
    })).toEqual([persistedTool])
  })
})

describe('agent session view structure', () => {
  it('keeps view selection and message presentation out of the Agent provider', async () => {
    const [sidebarSource, visibleSessionSource, presentationSource, optimisticSource] = await Promise.all([
      readFile(new URL('../src/features/agent/components/agent-sidebar/agent-sidebar.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/agent/hooks/use-agent-visible-session.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/agent/components/agent-message-viewport/use-agent-message-presentation.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/agent/lib/optimistic-user-messages.ts', import.meta.url), 'utf8'),
    ])

    expect(sidebarSource).toContain("from '@/features/agent/hooks/use-agent-visible-session'")
    expect(sidebarSource).toContain("from '@/features/agent/components/agent-message-viewport/use-agent-message-presentation'")
    expect(sidebarSource).not.toContain('function getPiWebUserMessageText(')
    expect(sidebarSource).not.toContain('const visibleSessionSnapshot =')
    expect(sidebarSource).not.toContain('const renderedMessages = useMemo(')
    expect(visibleSessionSource).toContain('export function useAgentVisibleSession(')
    expect(presentationSource).toContain('export function useAgentMessagePresentation(')
    expect(optimisticSource).not.toContain("from 'react'")
    expect(visibleSessionSource).not.toContain('agent-sidebar')
    expect(presentationSource).not.toContain('agent-sidebar')
  })
})
