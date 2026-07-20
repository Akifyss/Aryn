import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AgentQueuedComposerTray } from '@/features/agent/components/agent-queued-composer-tray/agent-queued-composer-tray'

describe('AgentQueuedComposerTray', () => {
  it('keeps queued message text visible when the provider does not support editing', () => {
    const markup = renderToStaticMarkup(
      <AgentQueuedComposerTray
        canUpdate={false}
        messages={[{
          id: 'followUp:0:来自 Codex 的排队消息',
          index: 0,
          kind: 'followUp',
          text: '来自 Codex 的排队消息',
        }]}
        onUpdate={vi.fn()}
      />,
    )

    expect(markup).toContain('来自 Codex 的排队消息')
    expect(markup).toContain('agent-queued-text')
    expect(markup).not.toContain('agent-queued-actions')
    expect(markup).not.toContain('agent-queued-edit-input')
  })

  it('renders queue controls only when queued message updates are supported', () => {
    const markup = renderToStaticMarkup(
      <AgentQueuedComposerTray
        canUpdate
        messages={[{
          id: 'steer:0:调整当前执行方向',
          index: 0,
          kind: 'steer',
          text: '调整当前执行方向',
        }]}
        onUpdate={vi.fn()}
      />,
    )

    expect(markup).toContain('agent-queued-actions')
    expect(markup).toContain('删除待处理消息')
    expect(markup).toContain('更多待处理消息操作')
  })

  it('renders nothing when there are no queued messages', () => {
    const markup = renderToStaticMarkup(
      <AgentQueuedComposerTray
        canUpdate
        messages={[]}
        onUpdate={vi.fn()}
      />,
    )

    expect(markup).toBe('')
  })
})
