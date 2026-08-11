import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  MeoDiffHunkActionButtons,
  MeoLiveInlineDiffToolbar,
} from '../src/features/editor/components/meo-diff-controls'

describe('MEO diff controls', () => {
  it('renders Git block actions with the shared icon button contract', () => {
    const markup = renderToStaticMarkup(
      <MeoDiffHunkActionButtons
        actions={['stage', 'discard', 'unstage']}
        busy={false}
        onAction={vi.fn()}
      />,
    )

    expect(markup.match(/class="app-icon-button meo-diff-hunk-action"/g)).toHaveLength(3)
    expect(markup).toContain('aria-label="Stage block"')
    expect(markup).toContain('aria-label="Discard block"')
    expect(markup).toContain('aria-label="Unstage block"')
    expect(markup).toContain('data-action="stage"')
    expect(markup).toContain('data-action="discard"')
    expect(markup).toContain('data-action="unstage"')
  })

  it('keeps action semantics available while an action is busy', () => {
    const markup = renderToStaticMarkup(
      <MeoDiffHunkActionButtons
        actions={['stage']}
        busy
        onAction={vi.fn()}
      />,
    )

    expect(markup).toContain('aria-label="Stage block"')
    expect(markup).toContain('disabled=""')
  })

  it('renders the inline diff toolbar as icon-only AppIconButton controls', () => {
    const markup = renderToStaticMarkup(
      <MeoLiveInlineDiffToolbar
        actions={['stage', 'discard']}
        busy={false}
        onAction={vi.fn()}
        onNavigate={vi.fn()}
        onViewModeChange={vi.fn()}
        viewMode='split'
      />,
    )

    expect(markup).toContain('role="toolbar"')
    expect(markup).toContain('aria-label="Inline diff controls"')
    expect(markup).toContain('data-target-mode="unified"')
    expect(markup).toContain('aria-label="Switch to inline unified"')
    expect(markup).toContain('aria-label="Previous change"')
    expect(markup).toContain('aria-label="Next change"')
    expect(markup.match(/class="app-icon-button/g)).toHaveLength(5)
  })

  it('describes the target layout when toggling from unified mode', () => {
    const markup = renderToStaticMarkup(
      <MeoLiveInlineDiffToolbar
        actions={[]}
        busy={false}
        onAction={vi.fn()}
        onNavigate={vi.fn()}
        onViewModeChange={vi.fn()}
        viewMode='unified'
      />,
    )

    expect(markup).toContain('data-target-mode="split"')
    expect(markup).toContain('aria-label="Switch to inline split"')
    expect(markup.match(/class="app-icon-button/g)).toHaveLength(3)
  })
})
