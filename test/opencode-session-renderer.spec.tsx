import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OpenCodeSessionTimeline } from '../src/features/agent/components/opencode-session-timeline'
import { PiWebSessionTimeline } from '../src/features/agent/components/pi-web-session-timeline'

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
