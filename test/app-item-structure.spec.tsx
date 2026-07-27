import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppItem, AppItemActionButton, AppItemIcon } from '@/components/app-item'
import { AppMenu } from '@/components/app-menu'

describe('shared application item', () => {
  it('preserves the original tree item container and interactive row structure', () => {
    const markup = renderToStaticMarkup(
      <ul>
        <AppItem
          isActive
          label='README.md'
          info='M'
        />
      </ul>,
    )

    expect(markup).toContain('<li class="app-item-container">')
    expect(markup).toContain('<div class="app-item-row has-end has-info is-active">')
    expect(markup).toMatch(/<button[^>]*class="app-item-main"[^>]*type="button"/)
    expect(markup).toContain('<span class="app-item-label">README.md</span>')
    expect(markup).toContain('<span class="app-item-info app-item-info-text">M</span>')
  })

  it('keeps header expansion behavior in AppItem instead of TreeItem', () => {
    const markup = renderToStaticMarkup(
      <AppItem
        isExpanded
        label='Files'
        toggleAriaLabel='Collapse files'
        variant='header'
        onToggle={() => undefined}
      />,
    )

    expect(markup).toContain('<div class="app-item-container app-item-header">')
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('aria-label="Collapse files"')
    expect(markup).toContain('app-item-chevron app-item-chevron-box')
  })

  it('lets menu and select semantics use the same row without an extra list item', () => {
    const markup = renderToStaticMarkup(
      <AppItem
        itemAs={null}
        label='Open'
        mainKind='static'
      />,
    )

    expect(markup).toMatch(/^<div class="app-item-row"/)
    expect(markup).not.toContain('app-item-container')
    expect(markup).not.toContain('<li')
  })

  it('adds right padding only when no trailing end content is rendered', async () => {
    const withoutEnd = renderToStaticMarkup(
      <AppItem
        itemAs={null}
        label='Open'
        mainKind='static'
      />,
    )
    const withEnd = renderToStaticMarkup(
      <AppItem
        info='1'
        itemAs={null}
        label='Open'
        mainKind='static'
      />,
    )
    const withCustomEnd = renderToStaticMarkup(
      <AppItem
        end={<span>Meta</span>}
        itemAs={null}
        label='Open'
        mainKind='static'
      />,
    )
    const styles = await readFile(
      new URL('../src/components/app-item/styles.css', import.meta.url),
      'utf8',
    )

    expect(withoutEnd).not.toContain('has-end')
    expect(withEnd).toContain('app-item-row has-end has-info')
    expect(withCustomEnd).toContain('app-item-row has-end')
    expect(styles).toMatch(
      /\.app-item-row:not\(\.has-end\)\s*\{[^}]*padding-right:\s*8px;/,
    )
  })

  it('builds item actions from AppIconButton instead of cloning an icon button', () => {
    const markup = renderToStaticMarkup(
      <AppItemActionButton aria-label='More actions'>
        <svg aria-hidden='true' />
      </AppItemActionButton>,
    )

    expect(markup).toContain('class="app-icon-button app-item-action"')
    expect(markup).toContain('aria-label="More actions"')
  })

  it('renders menu trailing indicators through the shared 32px info slot', () => {
    const markup = renderToStaticMarkup(
      <AppMenu.Option
        info={<svg aria-hidden='true' />}
        infoVariant='status'
        text='Open'
      />,
    )

    expect(markup).toContain('app-item-info app-item-info-status')
    expect(markup).not.toContain('app-menu-item-end')
  })

  it('does not wrap an existing AppItem icon slot a second time', () => {
    const markup = renderToStaticMarkup(
      <AppMenu.Option
        icon={<AppItemIcon><svg aria-hidden='true' /></AppItemIcon>}
        text='README.md'
      />,
    )

    expect(markup.match(/class="app-item-icon"/g)).toHaveLength(1)
  })
})
