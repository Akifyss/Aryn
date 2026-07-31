import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function collectSourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryUrl = new URL(
        entry.name + (entry.isDirectory() ? '/' : ''),
        directory,
      )

      if (entry.isDirectory()) {
        return collectSourceFiles(entryUrl)
      }

      return /\.(?:css|[cm]?[jt]sx?)$/.test(entry.name) ? [entryUrl] : []
    }),
  )

  return files.flat()
}

describe('shared icon tooltip button', () => {
  it('owns the icon-only button dimensions and tooltip composition', async () => {
    const [indexCss, iconButtonSource, iconButtonCss, appItemSource] =
      await Promise.all([
        readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
        readFile(
          new URL(
            '../src/components/app-icon-button/app-icon-button.tsx',
            import.meta.url,
          ),
          'utf8',
        ),
        readFile(
          new URL(
            '../src/components/app-icon-button/styles.css',
            import.meta.url,
          ),
          'utf8',
        ),
        readFile(
          new URL('../src/components/app-item/app-item.tsx', import.meta.url),
          'utf8',
        ),
      ])

    expect(indexCss).toContain('--app-icon-button-size-md: 32px;')
    expect(indexCss).toContain('--app-icon-button-size-sm: 24px;')
    expect(indexCss).not.toContain('--app-icon-button-icon-size:')
    expect(indexCss).not.toContain('--app-icon-button-radius-md:')
    expect(indexCss).not.toContain('--app-icon-button-radius-sm:')
    expect(indexCss).not.toContain('--app-icon-button-transition-duration:')
    expect(iconButtonCss).toContain(
      'opacity: var(--app-button-base-disabled-opacity);',
    )
    expect(indexCss).not.toContain('--app-icon-button-size-xs:')
    expect(indexCss).not.toContain('--app-icon-button-size-compact:')
    expect(indexCss).not.toContain('--app-icon-button-radius-xs:')
    expect(indexCss).not.toContain('--app-icon-button-radius-compact:')
    expect(iconButtonSource).toContain('AppTooltipButton')
    expect(iconButtonSource).toContain("export type AppIconButtonSize = 'md' | 'sm'")
    expect(iconButtonSource).toContain('tooltip === undefined ? (title ?? label ?? ariaLabel) : tooltip')
    expect(iconButtonSource).toContain('resolveTextLabel(ariaLabel, label, tooltip, title)')
    expect(iconButtonSource).toMatch(
      /<AppTooltipButton\s+\{\.\.\.props\}[\s\S]*data-size=\{size\}[\s\S]*data-variant=\{variant\}/,
    )
    expect(iconButtonSource).not.toContain('iconSize')
    expect(iconButtonCss).toContain('--app-icon-button-current-size: var(--app-icon-button-size-md);')
    expect(iconButtonCss).toContain('--app-icon-button-current-radius: var(--app-button-base-radius-md);')
    expect(iconButtonCss).toContain('width: var(--app-icon-button-current-size);')
    expect(iconButtonCss).toContain('height: var(--app-icon-button-current-size);')
    expect(iconButtonCss).toContain('width: var(--app-button-base-icon-size);')
    expect(iconButtonCss).toContain('height: var(--app-button-base-icon-size);')
    expect(iconButtonCss).toContain('var(--app-button-base-transition-duration)')
    expect(iconButtonCss).toContain(
      'border: 1px solid var(--border-primary);',
    )
    expect(iconButtonCss).toContain(
      'background: transparent;',
    )
    expect(iconButtonCss).toContain(
      'box-shadow: var(--shadow-xs);',
    )
    expect(iconButtonCss).toContain(
      'background: var(--hover);',
    )
    expect(iconButtonCss).toContain(
      'background: var(--active);',
    )
    expect(iconButtonCss).toContain('[data-popup-open]')
    expect(iconButtonCss).toContain("[aria-expanded='true']")
    expect(iconButtonCss).not.toMatch(
      /^\s*border(?!-radius)(?:-[a-z]+)*\s*:[^;]*var\(--(?:background|foreground)-/m,
    )
    expect(iconButtonCss).not.toMatch(
      /^\s*background(?:-color)?\s*:[^;]*var\(--(?:border|foreground)-/m,
    )
    expect(iconButtonCss).not.toMatch(
      /^\s*color\s*:[^;]*var\(--(?:background|border)-/m,
    )
    expect(iconButtonCss).not.toContain('--app-icon-button-local-icon-size')
    expect(iconButtonCss).not.toContain('scale(0.96)')
    expect(iconButtonCss).not.toMatch(
      /transform\s+var\(--app-button-base-transition-duration\)/,
    )
    expect(iconButtonCss).toContain("[data-size='sm']")
    expect(iconButtonCss).not.toContain("[data-size='xs']")
    expect(iconButtonCss).not.toContain("[data-size='compact']")
    expect(appItemSource).toContain("from '@/components/app-icon-button'")
    expect(appItemSource).toContain('<AppIconButton')
  })

  it('uses shared variants for standard states and limits contextual overrides', async () => {
    const [composerSource, composerCss, fileCardCss, modelCascaderCss] = await Promise.all([
      readFile(
        new URL(
          '../src/features/agent/components/agent-composer-surface/agent-composer-surface.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL(
          '../src/features/agent/components/agent-composer-surface/styles.css',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL(
          '../src/features/agent/components/agent-file-card/styles.css',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL(
          '../src/features/agent/components/agent-model-cascader/styles.css',
          import.meta.url,
        ),
        'utf8',
      ),
    ])

    expect(composerSource).toContain("composerAction === 'stop' ? 'outline' : 'solid'")
    expect(composerSource).not.toContain('agent-send-button')
    expect(composerCss).not.toContain('.agent-send-button')
    expect(fileCardCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[^{]*\{[\s\S]*\.app-icon-button\.agent-file-card-remove\s*\{[^}]*transition:\s*none;/,
    )
    expect(modelCascaderCss).toContain('var(--app-icon-button-size-md)')
    expect(modelCascaderCss).not.toContain('--agent-send-button-size')
  })

  it('reuses the shared icon-button size for AppItem trailing controls without business overrides', async () => {
    const [
      segmentedIconTabsCss,
      appItemCss,
      treeCss,
      queuedTrayCss,
      gitDiffCss,
      fileSystemSource,
    ] =
      await Promise.all([
        readFile(
          new URL(
            '../src/components/ui/segmented-icon-tabs/styles.css',
            import.meta.url,
          ),
          'utf8',
        ),
        readFile(
          new URL('../src/components/app-item/styles.css', import.meta.url),
          'utf8',
        ),
        readFile(new URL('../src/components/tree/styles.css', import.meta.url), 'utf8'),
        readFile(
          new URL(
            '../src/features/agent/components/agent-queued-composer-tray/styles.css',
            import.meta.url,
          ),
          'utf8',
        ),
        readFile(
          new URL(
            '../src/features/editor/components/git-diff-editor/styles.css',
            import.meta.url,
          ),
          'utf8',
        ),
        readFile(
          new URL(
            '../src/components/ui/file-system/file-system.tsx',
            import.meta.url,
          ),
          'utf8',
        ),
      ])

    expect(segmentedIconTabsCss).not.toContain('--app-icon-button-')
    expect(appItemCss).toContain('min-width: var(--app-icon-button-size-md);')
    expect(appItemCss).not.toMatch(/\.app-item-action\s*\{/)
    expect(appItemCss).not.toContain('.app-item-action.is-menu-open')
    expect(appItemCss).not.toContain('.app-item-action.is-danger')
    expect(appItemCss).not.toContain('--app-item-trailing-size')
    expect(appItemCss).toContain('var(--app-item-icon-size)')
    expect(treeCss).not.toContain('--app-item-trailing-size:')
    expect(treeCss).not.toContain('--app-item-action-size:')
    expect(treeCss).not.toContain('--app-item-action-gap:')
    expect(treeCss).not.toContain('--app-item-icon-size:')
    expect(queuedTrayCss).not.toMatch(
      /\.agent-queued-action\.is-text\s*\{[^}]*--app-icon-button-/s,
    )
    expect(gitDiffCss).not.toContain('--app-icon-button-')
    expect(fileSystemSource).toContain(
      '"flex h-6 items-center gap-1 border-y border-r border-[var(--border-primary)]',
    )
    expect(fileSystemSource).toContain(
      '"rounded-l-md border-l text-[var(--accent)]"',
    )
    expect(fileSystemSource).not.toContain('border border-l-0')
    expect(fileSystemSource).not.toContain(
      'h-[var(--app-icon-button-size-compact)]',
    )
  })

  it('keeps viewer toolbar icon triggers on the shared button path', async () => {
    const sourceFiles = await collectSourceFiles(new URL('../src/', import.meta.url))
    const sources = await Promise.all(
      sourceFiles.map(async (url) => ({
        path: url.pathname.replaceAll('\\', '/'),
        source: await readFile(url, 'utf8'),
      })),
    )
    const legacyIconButtonConsumers = sources
      .filter(({ source }) =>
        /<Button\b[\s\S]{0,280}size\s*=\s*['"]icon-sm['"]/.test(source),
      )
      .map(({ path }) => path)
    const viewerToolbarTooltipWrappers = sources
      .filter(({ path, source }) =>
        /\/src\/components\/ui\/(?:csv|docx|pdf|pptx|xlsx)-viewer\.tsx$/.test(path)
        && /ToolbarTooltip|<AppTooltip\b/.test(source),
      )
      .map(({ path }) => path)
    const localTokenOverrides = sources
      .filter(({ path, source }) =>
        !path.includes('/components/app-icon-button/')
        && /--app-icon-button-(?:current|local)-(?:size|radius)\s*:/.test(source),
      )
      .map(({ path }) => path)
    const inaccessibleIconButtons = sources.flatMap(({ path, source }) =>
      Array.from(
        source.matchAll(/<AppIconButton\b[\s\S]*?(?:\/>|>)/g),
        ([openingTag]) => ({ openingTag, path }),
      ).filter(({ openingTag }) =>
        !/\b(?:aria-label|label|tooltip)\s*=/.test(openingTag),
      ),
    )
    const fileSystemSource = await readFile(
      new URL('../src/components/ui/file-system/file-system.tsx', import.meta.url),
      'utf8',
    )
    const viewerControlsSource = await readFile(
      new URL(
        '../src/components/ui/document-viewer-controls/document-viewer-controls.tsx',
        import.meta.url,
      ),
      'utf8',
    )

    expect(legacyIconButtonConsumers).toEqual([])
    expect(viewerToolbarTooltipWrappers).toEqual([])
    expect(localTokenOverrides).toEqual([])
    expect(inaccessibleIconButtons).toEqual([])
    expect(fileSystemSource).not.toContain('"icon-sm": "size-8 rounded-[10px]"')
    expect(viewerControlsSource).not.toContain('size: _size')
    expect(viewerControlsSource).not.toContain('size?: "sm"')
  })
})
