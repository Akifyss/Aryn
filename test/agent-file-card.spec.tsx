import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AgentAttachmentFileCard } from '@/features/agent/components/agent-file-card/agent-file-card'

describe('AgentAttachmentFileCard', () => {
  it('renders file attachment metadata and a remove action', () => {
    const markup = renderToStaticMarkup(
      <AgentAttachmentFileCard
        attachment={{
          fileName: 'notes.md',
          kind: 'file',
          size: 2048,
          status: 'sent',
        }}
        onRemove={() => undefined}
      />,
    )

    expect(markup).toContain('agent-file-card')
    expect(markup).toContain('notes.md')
    expect(markup).toContain('File · 2.00 KB · sent')
    expect(markup).toContain('agent-file-card-remove')
    expect(markup).toContain('aria-label="移除 notes.md"')
  })

  it('renders an omitted image attachment with its preview', () => {
    const markup = renderToStaticMarkup(
      <AgentAttachmentFileCard
        attachment={{
          data: 'data:image/png;base64,preview',
          fileName: 'preview.png',
          kind: 'image',
          status: 'omitted',
        }}
      />,
    )

    expect(markup).toContain('agent-file-card is-image is-muted')
    expect(markup).toContain('agent-file-card-preview has-image')
    expect(markup).toContain('src="data:image/png;base64,preview"')
    expect(markup).not.toContain('agent-file-card-text')
  })
})
