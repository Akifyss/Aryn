import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  CodexSessionTimeline,
  toCodexSurfaceOptimisticMessages,
} from '../src/features/agent/components/codex-session-timeline'
import { OpenCodeSessionTimeline } from '../src/features/agent/components/opencode-session-timeline'
import { PiWebSessionTimeline } from '../src/features/agent/components/pi-web-session-timeline'
import type { CodexNativeSessionSnapshot } from '../src/features/agent/types'

describe('Codex T3 session surface host', () => {
  it('renders an isolated mount point keyed by the native thread', () => {
    const snapshot = {
      agentId: 'codex',
      itemRuntime: {},
      notices: [],
      sequence: 0,
      status: { type: 'idle' },
      thread: {
        id: 'thread-1',
        createdAt: 1,
        cwd: 'C:\\workspace',
        turns: [],
        updatedAt: 1,
      },
      tokenUsage: null,
      turnRuntime: {},
    } as CodexNativeSessionSnapshot
    const html = renderToStaticMarkup(
      <CodexSessionTimeline
        snapshot={snapshot}
        workspacePath='C:\\workspace'
      />,
    )

    expect(html).toContain('codex-session-surface-host')
    expect(html).toContain('data-codex-thread-id="thread-1"')
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('Working')
    expect(html).not.toContain('reasoning')
  })

  it('preserves optimistic image data for an immediate preview', () => {
    expect(toCodexSurfaceOptimisticMessages([{
      attachments: [{
        data: 'data:image/png;base64,cHJldmlldw==',
        fileName: 'preview.png',
        kind: 'image',
        mimeType: 'image/png',
      }],
      id: 'client-user-1',
      kind: 'user',
      text: 'Inspect this image',
      timestamp: 1,
    }])).toEqual([{
      attachments: [{
        id: 'client-user-1:attachment:0',
        mimeType: 'image/png',
        name: 'preview.png',
        path: undefined,
        url: 'data:image/png;base64,cHJldmlldw==',
      }],
      id: 'client-user-1',
      text: 'Inspect this image',
      timestamp: 1,
    }])
  })
})

describe('OpenCode official session surface host', () => {
  it('renders an isolated mount point keyed by the native session', () => {
    const html = renderToStaticMarkup(
      <OpenCodeSessionTimeline
        sessionID='session-1'
        workspacePath='C:\\workspace'
      />,
    )

    expect(html).toContain('opencode-session-surface-host')
    expect(html).toContain('data-opencode-session-id="session-1"')
    expect(html).not.toContain('Working')
    expect(html).not.toContain('reasoning')
  })
})

describe('pi-web official session surface host', () => {
  it('renders an isolated mount point keyed by the native session', () => {
    const html = renderToStaticMarkup(
      <PiWebSessionTimeline
        snapshot={{
          agentId: 'pi',
          entryIds: [],
          isStreaming: false,
          messages: [],
          modelNames: {},
          sessionId: 'pi-session-1',
        }}
        workspacePath='C:\\workspace'
      />,
    )

    expect(html).toContain('pi-web-session-surface-host')
    expect(html).toContain('data-pi-web-agent-id="pi"')
    expect(html).toContain('data-pi-web-session-id="pi-session-1"')
    expect(html).not.toContain('Waiting for model')
  })
})
