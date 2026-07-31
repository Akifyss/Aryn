import { readdir, readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppButton } from '../src/components/app-button'

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

describe('shared text button', () => {
  it('renders a non-submit button with the default visual contract', () => {
    const markup = renderToStaticMarkup(
      createElement(AppButton, { className: 'custom-button' }, '保存'),
    )

    expect(markup).toContain('type="button"')
    expect(markup).toContain('data-size="md"')
    expect(markup).toContain('data-variant="primary"')
    expect(markup).toContain('class="app-button custom-button"')
  })

  it('uses Base UI and owns the shared visual contract', async () => {
    const [indexCss, buttonSource, buttonCss] = await Promise.all([
      readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
      readFile(
        new URL('../src/components/app-button/app-button.tsx', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/components/app-button/styles.css', import.meta.url),
        'utf8',
      ),
    ])

    expect(buttonSource).toContain("from '@base-ui/react/button'")
    expect(buttonSource).toContain("export type AppButtonSize = 'md' | 'sm'")
    expect(buttonSource).not.toContain("| 'xs'")
    expect(buttonSource).toContain("| 'ghost'")
    expect(buttonSource).not.toContain("| 'link'")
    expect(buttonSource).not.toContain("| 'tertiary'")
    expect(buttonSource).toContain('<BaseButton')
    expect(buttonSource).toContain("type = 'button'")
    expect(buttonSource).toContain("typeof className === 'function'")
    expect(buttonSource).toContain('data-size={size}')
    expect(buttonSource).toContain('data-variant={variant}')
    expect(indexCss).toContain('--app-button-height-md: 32px;')
    expect(indexCss).toContain('--app-button-height-sm: 28px;')
    expect(indexCss).toContain('--app-button-font-size-md: 13px;')
    expect(indexCss).toContain('--app-button-font-size-sm: 12px;')
    expect(indexCss).toContain('--app-button-padding-inline-md: 8px;')
    expect(indexCss).toContain('--app-button-padding-inline-sm: 6px;')
    expect(indexCss).not.toContain('--app-button-height-xs:')
    expect(indexCss).toContain('--app-button-base-icon-size: 16px;')
    expect(indexCss).toContain('--app-button-base-radius-md: 8px;')
    expect(indexCss).toContain('--app-button-base-radius-sm: 6px;')
    expect(indexCss).toContain('--app-button-base-transition-duration: 140ms;')
    expect(indexCss).toContain('--app-button-base-disabled-opacity: 0.48;')
    expect(indexCss).not.toContain('--app-button-icon-size:')
    expect(indexCss).not.toContain('--app-button-radius-md:')
    expect(indexCss).not.toContain('--app-button-radius-sm:')
    expect(indexCss).not.toContain('--app-button-transition-duration:')
    expect(buttonCss).toContain(
      '--app-button-current-radius: var(--app-button-base-radius-md);',
    )
    expect(buttonCss).toContain('width: var(--app-button-base-icon-size);')
    expect(buttonCss).toContain('var(--app-button-base-transition-duration)')
    expect(buttonCss).toContain(
      'opacity: var(--app-button-base-disabled-opacity);',
    )
    expect(indexCss).not.toContain('--app-button-outline-')
    expect(indexCss).not.toContain('--app-button-ghost-')
    expect(buttonCss).toContain(
      '--app-button-border-color: var(--border-primary);',
    )
    expect(buttonCss).toContain(
      '--app-button-shadow: var(--shadow-xs);',
    )
    expect(buttonCss).toContain('--app-button-background: transparent;')
    expect(buttonCss).toContain('box-shadow: var(--app-button-shadow);')
    expect(buttonCss).not.toContain("[data-size='xs']")
    expect(buttonCss).toContain("[data-variant='ghost']")
    expect(buttonCss).toContain('--app-button-hover-background: var(--hover);')
    expect(buttonCss).toContain('[data-popup-open]')
    expect(buttonCss).toContain("[aria-expanded='true']")
    expect(buttonCss).not.toContain("[data-variant='tertiary']")
    expect(buttonCss).not.toMatch(
      /^\s*border(?!-radius)(?:-[a-z]+)*\s*:[^;]*var\(--(?:background|foreground)-/m,
    )
    expect(buttonCss).not.toMatch(
      /^\s*background(?:-color)?\s*:[^;]*var\(--(?:border|foreground)-/m,
    )
    expect(buttonCss).not.toMatch(
      /^\s*color\s*:[^;]*var\(--(?:background|border)-/m,
    )
    expect(buttonCss).not.toContain('scale(')
    expect(buttonCss).not.toContain('transform:')
    expect(buttonCss).not.toContain("[data-variant='link']")
    expect(buttonCss).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('does not leave HeroUI Button as an application button path', async () => {
    const sourceFiles = await collectSourceFiles(new URL('../src/', import.meta.url))
    const sources = await Promise.all(
      sourceFiles.map(async (url) => ({
        path: url.pathname.replaceAll('\\', '/'),
        source: await readFile(url, 'utf8'),
      })),
    )
    const heroButtonImports = sources
      .filter(({ source }) =>
        /import\s*\{[^}]*\bButton\b[^}]*\}\s*from\s*['"]@heroui\/react['"]/.test(
          source,
        ),
      )
      .map(({ path }) => path)
    const fileSystemSource = sources.find(({ path }) =>
      path.endsWith('/src/components/ui/file-system/file-system.tsx'),
    )?.source
    const viewerControlsSource = sources.find(({ path }) =>
      path.endsWith(
        '/src/components/ui/document-viewer-controls/document-viewer-controls.tsx',
      ),
    )?.source
    const agentSessionTreeSource = sources
      .filter(({ path }) => path.includes(
        '/src/features/agent/components/agent-session-tree/',
      ))
      .map(({ source }) => source)
      .join('\n')
    const agentChatSurfaceSource = sources.find(({ path }) =>
      path.endsWith(
        '/src/features/agent/components/agent-chat-surface/agent-chat-surface.tsx',
      ),
    )?.source
    const agentTypeSwitchSource = sources.find(({ path }) =>
      path.endsWith(
        '/src/features/agent/components/agent-type-switch/agent-type-switch.tsx',
      ),
    )?.source
    const agentModelCascaderSource = sources.find(({ path }) =>
      path.endsWith(
        '/src/features/agent/components/agent-model-cascader/agent-model-cascader.tsx',
      ),
    )?.source
    const workspaceSidebarSource = sources.find(({ path }) =>
      path.endsWith(
        '/src/features/workspace/components/workspace-sidebar/workspace-sidebar.tsx',
      ),
    )?.source
    const nonActionControlClasses = [
      'agent-status-action',
      'agent-model-cascader-trigger',
      'agent-project-switch-trigger',
      'agent-session-new-button',
      'sidebar-footer-item',
      'editor-workspace-switch-button',
    ]
    const nonActionAppButtonUsages = sources.flatMap(({ path, source }) =>
      (source.match(/<AppButton\b[^>]*>/gs) ?? []).flatMap((openingTag) =>
        nonActionControlClasses
          .filter((className) => openingTag.includes(className))
          .map((className) => ({ className, path })),
      ),
    )

    expect(heroButtonImports).toEqual([])
    expect(fileSystemSource).toBeDefined()
    expect(fileSystemSource ?? '').not.toContain(
      'const Button = React.forwardRef<HTMLButtonElement',
    )
    expect(viewerControlsSource).toBeDefined()
    expect(viewerControlsSource ?? '').not.toContain('ViewerControlButton')
    expect(agentSessionTreeSource).toMatch(
      /<button[\s\S]{0,240}className='agent-session-new-button'/,
    )
    expect(agentSessionTreeSource).toMatch(
      /<AppTooltipButton[\s\S]{0,240}className='agent-session-new-button'/,
    )
    expect(agentSessionTreeSource).not.toMatch(
      /<AppButton[\s\S]{0,240}className='agent-session-new-button'/,
    )
    expect(agentSessionTreeSource).toMatch(
      /<Menu\.TriggerSurface[\s\S]{0,260}agent-project-switch-trigger[\s\S]{0,220}size=\{size\}[\s\S]{0,100}variant='ghost'/,
    )
    expect(agentChatSurfaceSource).toBeDefined()
    expect(agentChatSurfaceSource ?? '').toMatch(
      /className=\{`agent-session-trigger[\s\S]{0,160}size='md'[\s\S]{0,80}variant='ghost'/,
    )
    expect(agentChatSurfaceSource ?? '').not.toMatch(
      /className=\{`agent-session-trigger[\s\S]{0,240}render=/,
    )
    expect(agentTypeSwitchSource).toBeDefined()
    expect(agentTypeSwitchSource ?? '').toMatch(
      /<Menu\.Trigger[\s\S]{0,240}size='md'[\s\S]{0,80}variant='ghost'/,
    )
    expect(agentTypeSwitchSource ?? '').not.toContain("className='agent-type-switch-trigger'")
    expect(agentModelCascaderSource).toBeDefined()
    expect(agentModelCascaderSource ?? '').toMatch(
      /<Menu\.TriggerSurface[\s\S]{0,300}className='agent-model-cascader-trigger'[\s\S]{0,180}size='md'[\s\S]{0,80}variant='ghost'/,
    )
    expect(workspaceSidebarSource).toBeDefined()
    expect(workspaceSidebarSource ?? '').toMatch(
      /<Menu\.TriggerSurface[\s\S]{0,320}editor-workspace-switch-button[\s\S]{0,120}size='md'[\s\S]{0,80}variant='outline'/,
    )
    expect(workspaceSidebarSource ?? '').not.toMatch(
      /<AppButton[\s\S]{0,320}editor-workspace-switch-button/,
    )
    expect(workspaceSidebarSource ?? '').toMatch(
      /<button type='button' className='sidebar-footer-item'/,
    )
    expect(nonActionAppButtonUsages).toEqual([])
  })
})
