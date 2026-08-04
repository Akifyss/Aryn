import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppLoadingState } from '@/components/app-loading-state'

describe('AppLoadingState', () => {
  it('renders an accessible HeroUI spinner with the default loading label', () => {
    const markup = renderToStaticMarkup(<AppLoadingState />)

    expect(markup).toContain('class="app-loading-state"')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('aria-atomic="true"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('spinner--md')
    expect(markup).toContain('spinner--accent')
    expect(markup).toContain('正在加载…')
  })

  it('supports a filled surface and custom label', () => {
    const markup = renderToStaticMarkup(
      <AppLoadingState
        className='custom-loading-state'
        fill
        label='正在加载会话'
      />,
    )

    expect(markup).toContain('class="app-loading-state is-fill custom-loading-state"')
    expect(markup).toContain('spinner--md')
    expect(markup).toContain('正在加载会话')
  })

  it('centers the spinner above the label', async () => {
    const styles = await readFile(
      new URL('../src/components/app-loading-state/styles.css', import.meta.url),
      'utf8',
    )

    expect(styles).toMatch(/\.app-loading-state\s*{[\s\S]*?flex-direction: column;/)
    expect(styles).toMatch(/\.app-loading-state\s*{[\s\S]*?align-items: center;/)
    expect(styles).toMatch(/\.app-loading-state\s*{[\s\S]*?justify-content: center;/)
    expect(styles).toMatch(/\.app-loading-state\s*{[\s\S]*?font-size: 14px;/)
  })
})
