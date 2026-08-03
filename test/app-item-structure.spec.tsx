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

  it('adds right padding whenever no trailing end content is visible', async () => {
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
    const withHiddenActions = renderToStaticMarkup(
      <AppItem
        actions={<button type='button'>More</button>}
        itemAs={null}
        label='Open'
        mainKind='static'
      />,
    )
    const withVisibleActions = renderToStaticMarkup(
      <AppItem
        actions={<button type='button'>More</button>}
        actionsAlwaysVisible
        itemAs={null}
        label='Open'
        mainKind='static'
      />,
    )
    const withInfoAndActions = renderToStaticMarkup(
      <AppItem
        actions={<button type='button'>More</button>}
        info='1'
        itemAs={null}
        label='Open'
        mainKind='static'
      />,
    )
    const withEmptyActions = renderToStaticMarkup(
      <AppItem
        actions={() => null}
        itemAs={null}
        label='Open'
        mainKind='static'
      />,
    )
    const withOverriddenActions = renderToStaticMarkup(
      <AppItem
        actions={<button type='button'>Unused action</button>}
        end={<span>Custom end</span>}
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
    expect(withHiddenActions).toContain('app-item-row has-actions has-end')
    expect(withHiddenActions).not.toContain('has-visible-actions')
    expect(withVisibleActions).toContain('app-item-row has-actions has-end has-visible-actions')
    expect(withInfoAndActions).toContain('app-item-row has-actions has-end has-info')
    expect(withEmptyActions).not.toContain('has-actions')
    expect(withEmptyActions).not.toContain('has-end')
    expect(withOverriddenActions).toContain('app-item-row has-end')
    expect(withOverriddenActions).not.toContain('has-actions')
    expect(withOverriddenActions).not.toContain('Unused action')
    expect(styles).toContain([
      '.app-item-row:not(.has-end) {',
      '  padding-right: var(--app-item-content-inset);',
      '}',
    ].join('\n'))
    expect(styles).not.toContain('.app-item-row.has-actions:not(.has-info)')
    expect(styles).not.toContain('.app-item-row:focus-within .app-item-actions,')
    expect(styles).not.toContain('.app-item-row.has-actions:focus-within .app-item-info,')
    expect(styles).toContain('.app-item-row:focus-visible .app-item-actions,')
    expect(styles).toContain('.app-item-row:has(:focus-visible) .app-item-actions,')
    expect(styles).toContain('.app-item-row:has(.app-item-actions:focus-within) .app-item-actions,')
    expect(styles).toContain('.app-item-row.has-actions:focus-visible .app-item-info,')
    expect(styles).toContain('.app-item-row.has-actions:has(:focus-visible) .app-item-info,')
    expect(styles).toContain('.app-item-row.has-actions:has(.app-item-actions:focus-within) .app-item-info,')
    expect(styles).not.toMatch(
      /\.app-item-header > \.app-item-row > \.app-item-main:is\(button\):hover\s*\{[^}]*outline:\s*none;/,
    )
  })

  it('reserves the end slot so revealing actions does not change item or popup width', async () => {
    const styles = await readFile(new URL('../src/components/app-item/styles.css', import.meta.url), 'utf8')
    const actionsRule = styles.match(/\.app-item-actions\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? ''
    const visibleActionsRule = styles.match(
      /\.app-item-row:focus-visible \.app-item-actions,[\s\S]*?\.app-item-row\.has-visible-actions \.app-item-actions\s*\{(?<body>[^}]*)\}/,
    )?.groups?.body ?? ''
    const hiddenInfoRule = styles.match(
      /\.app-item-row\.has-actions:focus-visible \.app-item-info,[\s\S]*?\.app-item-row\.has-actions\.has-visible-actions \.app-item-info\s*\{(?<body>[^}]*)\}/,
    )?.groups?.body ?? ''

    expect(styles).toMatch(
      /\.app-item-end\s*\{[^}]*display:\s*grid;[^}]*justify-items:\s*end;/,
    )
    expect(styles).toMatch(
      /\.app-item-end > \.app-item-actions,\s*\.app-item-end > \.app-item-info\s*\{[^}]*grid-area:\s*1 \/ 1;/,
    )
    expect(actionsRule).not.toContain('max-width:')
    expect(actionsRule).not.toContain('overflow: hidden;')
    expect(actionsRule).toContain('visibility: hidden;')
    expect(visibleActionsRule).not.toContain('max-width:')
    expect(hiddenInfoRule).not.toMatch(/(?:min-|max-)?width\s*:/)
    expect(hiddenInfoRule).not.toContain('padding-inline:')
  })

  it('builds item actions from AppIconButton instead of cloning an icon button', () => {
    const markup = renderToStaticMarkup(
      <AppItemActionButton aria-label='More actions' isActive>
        <svg aria-hidden='true' />
      </AppItemActionButton>,
    )

    expect(markup).toContain('class="app-icon-button app-item-action"')
    expect(markup).toContain('aria-label="More actions"')
    expect(markup).toContain('data-active="true"')
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

  it('uses the shared semantic icon-size scale', () => {
    const defaultMarkup = renderToStaticMarkup(
      <AppItemIcon><svg aria-hidden='true' /></AppItemIcon>,
    )
    const largeMarkup = renderToStaticMarkup(
      <AppItemIcon size='xl'><svg aria-hidden='true' /></AppItemIcon>,
    )

    expect(defaultMarkup).toContain('data-size="md"')
    expect(largeMarkup).toContain('data-size="xl"')
  })
})
