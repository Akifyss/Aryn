import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PiWebTimeline } from '../src/timeline'
import type { AgentMessage } from '../src/upstream/pi-web/lib/types'

function renderTimeline(
  messages: AgentMessage[],
  options: {
    agentRunning?: boolean
    streamingMessage?: Partial<AgentMessage> | null
  } = {},
) {
  return renderToStaticMarkup(
    <PiWebTimeline
      agentPhase={options.agentRunning ? { kind: 'waiting_model' } : null}
      agentRunning={options.agentRunning ?? false}
      entryIds={messages.map((_, index) => `entry-${index}`)}
      messages={messages}
      modelNames={{}}
      sessionId='session-1'
      streamingMessage={options.streamingMessage ?? null}
      workspacePath='C:\\workspace'
    />,
  )
}

describe('vendored pi-web timeline rendering contract', () => {
  it('renders persisted user and final assistant content', () => {
    const html = renderTimeline([
      { role: 'user', content: '你好', timestamp: 10 },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '你好，有什么可以帮你？' }],
        timestamp: 20,
      },
    ] as AgentMessage[])

    expect(html).toContain('你好')
    expect(html).toContain('你好，有什么可以帮你？')
  })

  it('keeps completed tool details collapsed while preserving the final answer', () => {
    const html = renderTimeline([
      { role: 'user', content: '读取文件', timestamp: 10 },
      {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          toolCallId: 'tool-1',
          toolName: 'read',
          input: { path: 'C:\\workspace\\secret.txt' },
        }],
        timestamp: 20,
      },
      {
        role: 'toolResult',
        toolCallId: 'tool-1',
        toolName: 'read',
        content: [{ type: 'text', text: 'private tool output' }],
        isError: false,
        timestamp: 21,
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '读取完成。' }],
        timestamp: 22,
      },
    ] as AgentMessage[])

    expect(html).toContain('Process details')
    expect(html).toContain('读取完成。')
    expect(html).not.toContain('private tool output')
    expect(html).not.toContain('secret.txt')
  })

  it('renders the current assistant text before message_end', () => {
    const html = renderTimeline(
      [{ role: 'user', content: '持续输出', timestamp: 10 }] as AgentMessage[],
      {
        agentRunning: true,
        streamingMessage: {
          role: 'assistant',
          content: [{ type: 'text', text: '正在流式返回' }],
          timestamp: 20,
        } as Partial<AgentMessage>,
      },
    )

    expect(html).toContain('持续输出')
    expect(html).toContain('正在流式返回')
    expect(html).not.toContain('Waiting for model')
  })
})
