import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function collectTypeScriptFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const entryUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)

    if (entry.isDirectory()) {
      return collectTypeScriptFiles(entryUrl)
    }

    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [entryUrl] : []
  }))

  return files.flat()
}

async function collectCssFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const entryUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)

    if (entry.isDirectory()) {
      return collectCssFiles(entryUrl)
    }

    return entry.name.endsWith('.css') ? [entryUrl] : []
  }))

  return files.flat()
}

describe('shared application menu', () => {
  it('centralizes menu primitives while keeping form popovers outside the menu boundary', async () => {
    const sourceFiles = await collectTypeScriptFiles(new URL('../src/', import.meta.url))
    const directMenuImports: string[] = []
    const directPopoverImports: string[] = []

    await Promise.all(sourceFiles.map(async (fileUrl) => {
      const source = await readFile(fileUrl, 'utf8')
      const sourcePath = fileUrl.pathname.replace(/\\/g, '/')

      if (
        source.includes('@base-ui/react/menu')
        || source.includes('@base-ui/react/context-menu')
        || source.includes('@base-ui/react/select')
      ) {
        directMenuImports.push(sourcePath)
      }

      if (source.includes('@base-ui/react/popover')) {
        directPopoverImports.push(sourcePath)
      }
    }))

    expect(directMenuImports).toHaveLength(1)
    expect(directMenuImports[0]).toMatch(/\/src\/components\/app-menu\/app-menu\.tsx$/)
    expect(directPopoverImports).toHaveLength(3)
    expect(directPopoverImports).toEqual(expect.arrayContaining([
      expect.stringMatching(/\/src\/components\/app-menu\/app-menu\.tsx$/),
      expect.stringMatching(/\/src\/components\/ui\/document-viewer-controls\/document-viewer-controls\.tsx$/),
      expect.stringMatching(/\/src\/components\/ui\/file-system\/file-system\.tsx$/),
    ]))
  })

  it('shares AppItem between tree rows and menu choices', async () => {
    const [
      agentSessionTreeSource,
      agentMentionSource,
      agentModelSource,
      appItemSource,
      appMenuSource,
      gitPanelSource,
      treeSource,
      workspaceTreeSource,
    ] = await Promise.all([
      Promise.all([
        'agent-session-tree.tsx',
        'flat-session-tree.tsx',
        'menus.tsx',
        'project-tree.tsx',
        'session-row.tsx',
      ].map((fileName) => (
        readFile(new URL(`../src/features/agent/components/agent-session-tree/${fileName}`, import.meta.url), 'utf8')
      ))).then((sources) => sources.join('\n')),
      readFile(new URL('../src/features/agent/components/agent-composer-mention-input/agent-composer-mention-input.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/agent/components/agent-model-cascader/agent-model-cascader.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/app-item/app-item.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/app-menu/app-menu.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/git/components/git-panel/git-panel.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/tree/tree.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/workspace/components/workspace-tree/workspace-tree.tsx', import.meta.url), 'utf8'),
    ])

    expect(appMenuSource).toMatch(
      /import \{[\s\S]{0,160}AppItem,[\s\S]{0,80}AppItemIcon,[\s\S]{0,120}from '@\/components\/app-item'/,
    )
    expect(appMenuSource).toContain('itemAs={null}')
    expect(appMenuSource).toContain('export const AppMenuTriggerSurface')
    expect(appMenuSource).toContain('export const AppMenuOption')
    expect(appMenuSource).toContain('export const AppMenuSelectItem')
    expect(appMenuSource).toContain('export const AppMenuLinkItem')
    expect(appMenuSource).toContain('LinkItem: AppMenuLinkItem')
    expect(appMenuSource).not.toContain('LinkItem: BaseMenu.LinkItem')
    expect(appMenuSource).toContain('TriggerSurface: AppMenuTriggerSurface')
    expect(appMenuSource).toMatch(/export const AppMenuItem[\s\S]*?<BaseMenu\.Item[\s\S]*?render=\{resolvedRender\}/)
    expect(appMenuSource).toContain('Trigger: AppMenuTrigger')

    expect(appItemSource).toContain("itemAs?: 'div' | 'li' | null")
    expect(appItemSource).toContain(
      "Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className' | 'onToggle'>",
    )
    expect(appItemSource).toContain("const effectiveItemAs = itemAs === undefined ? (isHeader ? 'div' : 'li') : itemAs")
    expect(appItemSource).toContain('isHeader && !isHeaderToggleable')
    expect(appItemSource).toContain('{after}')

    expect(treeSource).not.toContain("from '@/components/app-item'")
    expect(treeSource).not.toMatch(/export const TreeItem(?:\s|=)/)
    expect(treeSource).toContain('export const TreeChildren')

    for (const source of [agentSessionTreeSource, gitPanelSource, workspaceTreeSource]) {
      expect(source).toContain("from '@/components/app-item'")
      expect(source).toContain('<AppItem')
      expect(source).not.toMatch(/<TreeItem(?:\s|>)/)
    }

    for (const source of [agentMentionSource, agentModelSource]) {
      expect(source).toContain('<Menu.Option')
      expect(source).not.toMatch(/className=\{?['"`]app-menu-item/)
    }
    expect(agentModelSource).toContain('text={provider}')
    expect(agentModelSource).toContain("info={<RightLine aria-hidden='true' />}")
    expect(agentModelSource).toContain('info={option.provider}')
    expect(agentModelSource).not.toContain('agent-model-cascader-option-main')
    expect(agentModelSource).not.toContain('agent-model-cascader-option-sub')
    expect(agentModelSource).not.toMatch(
      /text=\{\([\s\S]{0,180}<RightLine/,
    )
    expect(agentModelSource).not.toContain('end={')
  })

  it('owns popup, trigger, item, selection, submenu, and context-menu variants', async () => {
    const appMenuSource = await readFile(
      new URL('../src/components/app-menu/app-menu.tsx', import.meta.url),
      'utf8',
    )

    for (const member of [
      'CheckboxItem',
      'Context',
      'Item',
      'List',
      'Option',
      'Popup',
      'RadioItem',
      'Separator',
      'SubmenuTrigger',
      'Surface',
      'Trigger',
    ]) {
      expect(appMenuSource).toContain(`${member}:`)
    }

    expect(appMenuSource).toContain("export type AppMenuTriggerVariant = 'ghost' | 'icon' | 'outline'")
    expect(appMenuSource).toContain(
      "export type AppMenuTriggerSurfaceVariant = Exclude<AppMenuTriggerVariant, 'icon'>",
    )
    expect(appMenuSource).toContain('export type AppMenuVisualTriggerProps')
    expect(appMenuSource).toContain('export type AppMenuCustomTriggerProps')
    expect(appMenuSource).toContain('iconTooltip?: never')
    expect(appMenuSource).toContain('iconVariant?: never')
    expect(appMenuSource).toContain('size?: never')
    expect(appMenuSource).toContain('variant?: never')
    expect(appMenuSource).toContain("export type AppMenuLayout = 'compound' | 'list'")
    expect(appMenuSource).toContain('export const AppMenuSelect =')
    expect(appMenuSource).toContain('export const AppMenuPopover =')
    expect(appMenuSource).toContain('infoVariant?: AppItemInfoVariant')
    expect(appMenuSource).toMatch(
      /function AppMenuRadioItem[\s\S]{0,900}<AppMenuRadioItemIndicator>[\s\S]{0,300}infoVariant/,
    )
    expect(appMenuSource).toMatch(
      /function AppMenuCheckboxItem[\s\S]{0,900}<AppMenuCheckboxItemIndicator>[\s\S]{0,300}infoVariant/,
    )
    expect(appMenuSource).toMatch(
      /function AppMenuSelectItem[\s\S]{0,900}<AppMenuSelectItemIndicator>[\s\S]{0,400}info=\{resolvedInfo\}/,
    )
    expect(appMenuSource).toMatch(
      /function AppMenuSubmenuTrigger[\s\S]{0,300}info = <RightLine aria-hidden='true' \/>/,
    )
    expect(appMenuSource).not.toContain('app-menu-item-end')
    expect(appMenuSource).not.toContain('AppMenuPopupVariant')
    expect(appMenuSource).not.toContain("'picker'")
  })

  it('owns list geometry instead of relying on business-level gap and item clones', async () => {
    const [
      agentMentionSource,
      agentModelCss,
      agentModelSource,
      agentTypeCss,
      appScrollAreaCss,
      appMenuCss,
      appMenuSource,
      projectMenuCss,
      projectMenuSource,
      settingsCss,
    ] = await Promise.all([
      readFile(new URL('../src/features/agent/components/agent-composer-mention-input/agent-composer-mention-input.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/agent/components/agent-model-cascader/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/agent/components/agent-model-cascader/agent-model-cascader.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/agent/components/agent-type-switch/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/app-scroll-area/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/app-menu/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/app-menu/app-menu.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/workspace/components/project-menu/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/workspace/components/project-menu/project-menu.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/settings/components/settings-dialog/styles.css', import.meta.url), 'utf8'),
    ])

    expect(appMenuCss).toMatch(
      /\.app-menu-list\s*\{[^}]*flex-direction:\s*column;[^}]*gap:\s*var\(--app-item-list-gap\);/,
    )
    expect(appMenuCss).toMatch(
      /\.app-menu-item\.app-item-row\s*\{[^}]*margin:\s*0;/,
    )
    expect(appMenuCss).not.toContain('--app-item-row-gap: 0;')
    expect(appMenuCss).not.toContain('.app-menu-item-end')
    expect(appMenuCss).toMatch(
      /\.app-menu-radio-indicator-dot\s*\{[^}]*width:\s*8px;[^}]*height:\s*8px;/,
    )
    expect(appMenuCss).toMatch(
      /\.app-menu-separator\s*\{[^}]*height:\s*1px;[^}]*background:\s*var\(--separator\);/,
    )
    expect(appMenuCss).toContain('@media (min-resolution: 1.25dppx)')
    expect(appMenuCss).toContain('@media (min-resolution: 2.5dppx)')
    expect(appMenuSource).toContain("layout === 'list' && 'app-menu-list'")
    expect(appMenuSource).toContain("'app-menu-scroll-content', 'app-scroll-area-content', 'app-menu-list'")
    expect(appMenuSource).toContain("className={mergeStatefulClassName('app-menu-list', className)}")
    expect(appMenuSource).toContain('export const AppMenuOption')
    expect(appMenuSource).toContain('export const AppMenuSelectItem')

    expect(projectMenuCss).not.toContain('.project-menu-list-content')
    expect(projectMenuCss).not.toContain('--app-item-font-size:')
    expect(projectMenuSource).toContain("<Menu.ScrollContent className='project-menu-project-list'>")
    expect(projectMenuSource).toContain("className='app-menu-search-field project-menu-search'")
    expect(projectMenuSource).toContain("<Menu.List className='project-menu-actions'>")
    expect(projectMenuSource).toContain("layout={isCompoundMenu ? 'compound' : 'list'}")
    expect(projectMenuSource).toContain("size={isCompoundMenu ? 'lg' : 'sm'}")
    expect(projectMenuSource).not.toContain('resolveProjectMenuStyle')
    expect(projectMenuSource).not.toContain('project-menu-projectless-actions')
    expect(projectMenuSource.match(/className='project-menu-section-separator'/g)).toHaveLength(1)
    expect(projectMenuSource).not.toContain('project-menu-action-section')
    expect(projectMenuCss).not.toMatch(/\.project-menu\s*\{[^}]*\bpadding\s*:/)
    expect(projectMenuCss).not.toMatch(/\.project-menu\s*\{[^}]*\bwidth\s*:/)
    expect(projectMenuCss).not.toMatch(/\.project-menu\s*\{[^}]*\n\s*max-height\s*:/)
    expect(projectMenuCss).toMatch(
      /\.project-menu-search-section\s*\{[^}]*padding:\s*var\(--app-menu-content-padding\)\s*var\(--app-menu-content-padding\)\s*0;/,
    )
    expect(projectMenuCss).toMatch(
      /\.project-menu-project-list\s*\{[^}]*padding:\s*var\(--app-menu-content-padding\);/,
    )
    expect(projectMenuCss).toMatch(
      /\.project-menu-actions\s*\{[^}]*padding:\s*var\(--app-menu-content-padding\);/,
    )
    expect(projectMenuCss).toMatch(
      /\.project-menu-section-separator\s*\{[^}]*height:\s*1px;[^}]*margin:\s*0;[^}]*border:\s*0;/,
    )
    expect(projectMenuCss).not.toMatch(
      /\.project-menu-list\.app-menu-scroll-area\.app-scroll-area\s*\{/,
    )
    expect(projectMenuCss).not.toMatch(
      /\.project-menu-list \.app-menu-scroll-viewport\.app-scroll-area-viewport\s*\{[^}]*(?:inline-size|margin-inline):/,
    )
    expect(projectMenuCss).not.toContain('calc(0px - var(--app-menu-content-padding))')
    expect(agentTypeCss).not.toContain('.agent-type-switch-options-content')
    expect(settingsCss).not.toContain('.settings-select-list')
    expect(settingsCss).not.toContain('.settings-select-item')
    expect(agentModelCss).not.toContain('.agent-model-cascader-list')
    expect(agentModelCss).not.toContain('--app-scroll-area-scrollbar-gap')
    expect(agentModelCss).not.toContain('--app-scroll-area-scrollbar-thickness')
    expect(agentModelSource).toContain("className='app-menu-search-field agent-model-cascader-search'")
    expect(agentModelCss).not.toMatch(/\.agent-model-cascader\s*\{[^}]*\bpadding\s*:/)
    expect(agentModelCss).toMatch(
      /\.agent-model-cascader-scroll \.app-menu-list\s*\{[^}]*padding:\s*0 var\(--app-menu-content-padding\) var\(--app-menu-content-padding\);/,
    )
    expect(appScrollAreaCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.app-scroll-area-scrollbar,[\s\S]*\.app-scroll-area-thumb\s*\{[^}]*transition:\s*none;/,
    )

    for (const source of [agentMentionSource, agentModelSource]) {
      expect(source).toContain('<Menu.Option')
      expect(source).not.toMatch(/className=\{?['"`]app-menu-item/)
    }
  })

  it('centralizes button-like trigger visuals while preserving explicit custom-render escape hatches', async () => {
    const [
      agentChatCss,
      agentChatSource,
      agentModelSource,
      agentQueuedSource,
      appIconButtonCss,
      appMenuCss,
      appMenuSource,
      documentViewerCss,
      documentViewerSource,
      fileSystemSource,
      indexCss,
      workspaceSidebarSource,
      xlsxViewerSource,
    ] = await Promise.all([
      readFile(new URL('../src/features/agent/components/agent-chat-surface/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/agent/components/agent-chat-surface/agent-chat-surface.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/agent/components/agent-model-cascader/agent-model-cascader.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/agent/components/agent-queued-composer-tray/agent-queued-composer-tray.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/app-icon-button/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/app-menu/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/app-menu/app-menu.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/ui/document-viewer-controls/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/ui/document-viewer-controls/document-viewer-controls.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/ui/file-system/file-system.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/workspace/components/workspace-sidebar/workspace-sidebar.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/ui/xlsx-viewer.tsx', import.meta.url), 'utf8'),
    ])

    expect(appMenuSource).toContain("from '@/components/app-button'")
    expect(appMenuSource).toContain("from '@/components/app-icon-button'")
    expect(appMenuSource).toContain('if (render !== undefined)')
    expect(appMenuSource).toContain("const resolvedVariant = variant ?? 'outline'")
    expect(appMenuSource).toContain('function createAppMenuVisualTrigger')
    expect(appMenuSource).toContain("return cx('app-menu-trigger', className)")
    expect(appMenuSource).not.toContain('`app-menu-trigger-${variant}`')
    expect(appMenuSource).not.toContain('`app-menu-trigger-${size}`')
    expect(appMenuSource).toContain('const resolvedRender = createAppMenuVisualTrigger')
    expect(appMenuSource).toContain('<AppIconButton')
    expect(appMenuSource).toContain('tooltip={iconTooltip}')
    expect(appMenuSource).toContain('variant={iconVariant}')
    expect(appMenuSource).toContain('<AppButton')
    expect(appMenuSource).toMatch(
      /function AppMenuTriggerSurface[\s\S]{0,520}return \([\s\S]{0,80}<AppButton/,
    )
    expect(appMenuSource).not.toMatch(
      /function AppMenuTriggerSurface[\s\S]{0,520}return \([\s\S]{0,80}<button/,
    )
    expect(appMenuSource).toContain('export const AppMenuPopoverTrigger')
    expect(appMenuSource).toContain('Trigger: AppMenuPopoverTrigger')
    expect(appMenuSource).not.toContain("'plain'")
    expect(appMenuSource).not.toContain('customRenderUsesAppButton')
    expect(appMenuSource).toContain("export type AppMenuPopupSize = 'anchor' | 'fit' | 'lg' | 'md' | 'sm'")
    expect(appMenuCss).not.toContain('.app-menu-trigger-icon')
    expect(appMenuCss).not.toContain('.app-menu-trigger-plain')
    expect(indexCss).not.toContain('--app-button-outline-')
    expect(indexCss).not.toContain('--app-button-ghost-')
    expect(indexCss).not.toContain('--app-menu-item-hover-background')
    expect(indexCss).not.toContain('--app-menu-item-active-background')
    expect(appMenuCss).not.toContain('.app-menu-trigger-outline')
    expect(appMenuCss).not.toContain('.app-menu-trigger-ghost')
    expect(appMenuCss).not.toContain('--app-menu-trigger-')
    expect(appIconButtonCss).toContain('[data-popup-open]')
    expect(appIconButtonCss).toContain("[aria-expanded='true']")

    expect(agentChatSource).toMatch(
      /className=\{`agent-session-trigger[\s\S]{0,160}size='md'[\s\S]{0,80}variant='ghost'/,
    )
    expect(agentChatSource).toMatch(
      /className='agent-floating-panel'[\s\S]{0,180}size='lg'/,
    )
    expect(agentChatSource).not.toMatch(
      /className='agent-floating-panel'[\s\S]{0,180}layout='compound'/,
    )
    expect(agentChatCss).not.toMatch(/\.agent-floating-panel\s*\{[^}]*\bwidth\s*:/)
    expect(agentChatCss).not.toMatch(/\.agent-floating-panel\s*\{[^}]*max-height\s*:/)
    expect(agentChatCss).not.toMatch(/\.agent-floating-panel\s*\{[^}]*\bpadding\s*:/)
    expect(agentModelSource).toMatch(
      /className='agent-model-cascader-trigger'[\s\S]{0,160}size='md'[\s\S]{0,80}variant='ghost'/,
    )
    expect(agentQueuedSource).toMatch(
      /<Menu\.Trigger[\s\S]{0,220}agent-queued-action[\s\S]{0,180}iconTooltip=[\s\S]{0,120}size='sm'[\s\S]{0,80}variant='icon'/,
    )
    expect(agentQueuedSource).not.toMatch(
      /agent-queued-action[\s\S]{0,220}render=\{<AppIconButton/,
    )
    expect(fileSystemSource).toMatch(
      /<DropdownMenuTrigger[\s\S]{0,220}iconVariant="outline"[\s\S]{0,120}size="md"[\s\S]{0,80}variant="icon"/,
    )
    expect(workspaceSidebarSource).toMatch(
      /<Menu\.TriggerSurface[\s\S]{0,320}editor-workspace-switch-button[\s\S]{0,160}size='md'[\s\S]{0,80}variant='outline'/,
    )
    expect(documentViewerSource).toMatch(
      /viewer-toolbar-select[\s\S]{0,220}size="md"[\s\S]{0,80}variant="outline"/,
    )
    expect(documentViewerSource).toMatch(
      /function ViewerMenuTrigger[\s\S]{0,480}iconTooltip=\{label\}[\s\S]{0,80}variant="icon"/,
    )
    expect(documentViewerSource).not.toContain('variant="plain"')
    expect(xlsxViewerSource).toMatch(
      /<DropdownMenuTrigger[\s\S]{0,220}size="sm"[\s\S]{0,180}label="列菜单"/,
    )
    expect(xlsxViewerSource).not.toMatch(
      /<DropdownMenuTrigger asChild>[\s\S]{0,120}<AppIconButton/,
    )
    expect(documentViewerCss).not.toMatch(
      /\.viewer-toolbar-select\s*\{[^}]*(?:height|padding|border|border-radius|font-size):/,
    )
    expect(appMenuCss).toMatch(
      /\.app-menu-scroll-area\.app-scroll-area\s*\{[^}]*inline-size:\s*calc\(100% \+ var\(--app-menu-content-padding\) \+ var\(--app-menu-content-padding\)\);[^}]*margin-inline:\s*calc\(0px - var\(--app-menu-content-padding\)\);[^}]*--app-scroll-area-scrollbar-gap:\s*0px;/,
    )
    expect(appMenuCss).toMatch(
      /\.app-menu-scroll-viewport\.app-scroll-area-viewport\s*\{[^}]*inline-size:\s*calc\(100% - var\(--app-menu-content-padding\) - var\(--app-menu-content-padding\)\);[^}]*margin-inline:\s*var\(--app-menu-content-padding\);[^}]*overscroll-behavior:\s*contain;/,
    )
    expect(indexCss).toContain('--app-menu-content-padding: 6px;')
    expect(indexCss).toContain('--app-item-list-gap: 2px;')
    expect(indexCss).not.toContain('--app-menu-item-gap:')
    expect(indexCss).toContain(
      '--app-menu-popup-radius: calc(var(--app-item-row-radius) + var(--app-menu-content-padding));',
    )
    expect(indexCss).toContain('--app-menu-popup-max-width: 360px;')
    expect(indexCss).toContain('--app-menu-popup-max-height: 520px;')
    expect(indexCss).toContain(
      [
        '--app-menu-popup-shadow:',
        '    var(--shadow-sm),',
        '    0 0 0 1px var(--smooth-ring-color);',
      ].join('\n'),
    )
    expect(indexCss).toContain('--app-z-menu: 82;')
    expect(appMenuCss).toMatch(
      /\.app-menu-surface\s*\{[^}]*padding:\s*var\(--app-menu-content-padding\);[^}]*border:\s*0;[^}]*border-radius:\s*var\(--app-menu-popup-radius\);[^}]*box-shadow:\s*var\(--app-menu-popup-shadow\);/,
    )
    expect(appMenuCss).not.toMatch(/\.app-menu-surface\s*\{[^}]*border:\s*1px/)
    expect(appMenuCss).toContain('z-index: var(--app-menu-z-index, var(--app-z-menu));')
    expect(appMenuCss).toMatch(
      /max-width:\s*min\(\s*var\(--app-menu-popup-max-width\),\s*var\(--available-width, calc\(100vw - 16px\)\)\s*\);/,
    )
    expect(appMenuCss).toMatch(
      /max-height:\s*min\(\s*var\(--app-menu-popup-max-height\),\s*var\(--available-height, calc\(100vh - 16px\)\)\s*\);/,
    )
    expect(appMenuCss).not.toContain('var(--app-menu-popup-max-width, 360px)')
    expect(appMenuCss).not.toContain('var(--app-menu-popup-max-height, 520px)')
    expect(appMenuCss).not.toContain('--app-menu-content-padding: 6px;')
    expect(appMenuCss).not.toContain('var(--app-menu-popup-radius, 12px)')
    expect(appMenuCss).not.toContain('var(--app-menu-popup-shadow,')
    expect(appMenuCss).toMatch(
      /\.app-menu-list\s*\{[^}]*flex-direction:\s*column;[^}]*gap:\s*var\(--app-item-list-gap\);/,
    )
    expect(appMenuCss).not.toMatch(/\.app-menu-list\s*\{[^}]*gap:\s*2px;/)
    expect(appMenuCss).not.toContain('.app-menu-surface-picker')
    expect(appMenuCss).not.toMatch(/\.app-menu-surface\s*\{[^}]*\n\s*gap:/)
    expect(appMenuCss).not.toContain('--app-menu-popup-padding')
    expect(appMenuCss).toMatch(
      /\.app-menu-surface\[data-layout='compound'\]\s*\{[^}]*padding:\s*0;/,
    )
    expect(appMenuCss).toMatch(
      /\.app-menu-surface\[data-layout='compound'\] \.app-menu-scroll-area\.app-scroll-area,\s*\.app-menu-surface\[data-layout='compound'\] \.app-menu-scroll-viewport\.app-scroll-area-viewport\s*\{[^}]*inline-size:\s*100%;[^}]*margin-inline:\s*0;/,
    )
    expect(appMenuSource).toMatch(
      /AppMenuSurface[\s\S]*?layout = 'list',[\s\S]*?AppMenuPopup/,
    )
    expect(appMenuSource).toMatch(
      /AppMenuPopoverPopup[\s\S]*?layout = 'list',[\s\S]*?<BasePopover\.Popup/,
    )
    expect(appMenuCss).toMatch(
      /\.app-menu-surface\s*\{[^}]*--tree-scroll-content-inline-padding:\s*0px;/,
    )
    expect(appMenuCss).toMatch(
      /\.app-menu-surface-anchor\s*\{[^}]*width:\s*var\(--anchor-width\);[^}]*max-width:\s*var\(--available-width, calc\(100vw - 16px\)\);/,
    )
    expect(appMenuCss).not.toMatch(/\.app-menu-scrollbar[^}]*\{[^}]*(?:right|inset-inline-end):/)
    expect(appMenuCss).not.toMatch(/\.app-menu-scroll-area\.app-scroll-area\s*\{[^}]*overflow:\s*visible;/)
    expect(appMenuCss).not.toContain('--app-menu-scrollbar-edge-offset')
    expect(appMenuCss).not.toMatch(/\.app-menu-scroll-(?:area|viewport)[^{]*\{[^}]*padding(?:-inline-end|-right)?:/)
    expect(appMenuSource).toContain('export const AppMenuScrollArea')
    expect(appMenuSource).toContain("className='app-menu-scrollbar app-scroll-area-scrollbar'")
    expect(appMenuSource).not.toContain('app-menu-scrollbar-edge-offset')
    expect(appMenuSource).toContain('export const AppMenuScrollViewport')
    expect(appMenuSource).toContain('export const AppMenuScrollContent')
    expect(appMenuSource).toContain("'app-menu-scroll-content', 'app-scroll-area-content', 'app-menu-list'")
    expect(appMenuSource).toContain("className={mergeStatefulClassName('app-menu-list', className)}")
    expect(appMenuSource).toContain('export const AppMenuSelectScrollList')
    expect(appMenuSource).toContain('className: listClassName')
    expect(appMenuSource).toContain('className={cx(listClassName, viewportClassName)}')
    expect(appMenuSource).not.toContain('className={viewportClassName}')
    expect(documentViewerSource).toContain('<Select.ScrollList>')
    expect(documentViewerSource).not.toContain('<Menu.ScrollArea')
    expect(documentViewerSource).not.toContain('@base-ui/react/scroll-area')
    expect(documentViewerSource).not.toContain('@base-ui/react/select')
    expect(documentViewerSource).toContain('@base-ui/react/popover')
    expect(documentViewerSource).not.toContain('AppMenuPopover as Popover')
    expect(fileSystemSource).not.toContain('@base-ui/react/select')
    expect(fileSystemSource).toContain('@base-ui/react/popover')
    expect(fileSystemSource).not.toContain('AppMenuPopover as MenuPopover')
    expect(fileSystemSource).toMatch(
      /<DropdownMenuSubTrigger[\s\S]{0,180}icon=\{[\s\S]{0,180}text=\{FILE_SYSTEM_COPY\.filter\.type\.fileType\}/,
    )
    expect(fileSystemSource).not.toMatch(
      /function DropdownMenuSubTrigger[\s\S]{0,320}<RightLine/,
    )
    expect(documentViewerSource).not.toContain('viewer-zoom-select-popup')
    expect(documentViewerCss).not.toContain('.viewer-zoom-select-popup')
    expect(documentViewerSource).not.toContain('className="w-32 overflow-hidden p-0"')
    expect(documentViewerSource).not.toContain('className="p-1"')
    expect(documentViewerSource).not.toContain('--app-menu-popup-max-height')
    expect(documentViewerSource).not.toContain('"--app-menu-content-padding": "16px"')
    expect(documentViewerSource).toContain('VIEWER_POPOVER_SURFACE')
    expect(documentViewerCss).toMatch(
      /\.viewer-search-popover\s*\{[^}]*padding:\s*6px 12px;/,
    )
    expect(documentViewerSource).not.toContain('menuMaxHeight')
  })

  it('keeps single-line items at 32px, opens without animation, and preserves Select alignment', async () => {
    const [appButtonCss, appItemCss, appMenuCss, appMenuSource, fileSystemSource, indexCss, settingsSelectCss, settingsSelectSource, treeCss] = await Promise.all([
      readFile(new URL('../src/components/app-button/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/app-item/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/app-menu/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/app-menu/app-menu.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/ui/file-system/file-system.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/settings/components/settings-dialog/settings-select/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/settings/components/settings-dialog/settings-select/settings-select.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/tree/styles.css', import.meta.url), 'utf8'),
    ])

    expect(indexCss).not.toContain('--app-item-row-single-line-height:')
    expect(indexCss).not.toContain('--app-item-row-description-min-height:')
    expect(indexCss).toContain('--app-item-row-radius: 8px;')
    expect(indexCss).toContain('--icon-size-md: 16px;')
    expect(indexCss).toContain('--icon-size-lg: 20px;')
    expect(indexCss).toContain('--icon-size-xl: 24px;')
    expect(indexCss).not.toContain('--app-item-icon-size:')
    expect(indexCss).not.toContain('--app-item-trailing-size:')
    expect(indexCss).toContain('--app-item-font-size: 13px;')
    expect(indexCss).toContain('--app-item-content-gap: 8px;')
    expect(indexCss).toContain('--app-item-content-inset: 8px;')
    expect(appItemCss).toContain('height: 32px;')
    expect(appItemCss).toMatch(
      /\.app-item-row\.has-description\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*48px;/,
    )
    expect(appItemCss).not.toContain('--app-item-row-description-min-height')
    expect(appItemCss).toContain('border-radius: var(--app-item-row-radius);')
    expect(appItemCss).not.toContain('--app-item-row-height')
    expect(appItemCss).toMatch(/\.app-item-row\s*\{[^}]*margin:\s*0;/)
    expect(appItemCss).not.toContain('--app-item-row-gap')
    expect(appItemCss).not.toContain('var(--app-item-row-radius, 8px)')
    expect(appItemCss).not.toContain('var(--app-item-icon-size')
    expect(appItemCss).not.toContain('--app-item-trailing-size')
    expect(appItemCss).toContain('min-width: var(--app-icon-button-size-md);')
    expect(appItemCss).not.toContain('var(--app-item-font-size, 13px)')
    expect(appItemCss).toContain('padding: 0 0 0 var(--app-item-content-inset);')
    expect(appItemCss).toContain('gap: var(--app-item-content-gap);')
    expect(appItemCss).toContain('padding-right: var(--app-item-content-inset);')
    expect(appItemCss).not.toContain('--app-item-row-padding-')
    expect(treeCss).toMatch(
      /\.tree-list\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:\s*var\(--app-item-list-gap\);/,
    )
    expect(treeCss).toMatch(
      /\.tree-list > \.app-item-container,\s*\.tree-section > \.app-item-container,\s*\.tree-section\s*\{[^}]*gap:\s*var\(--app-item-list-gap\);/,
    )
    expect(treeCss).toMatch(/\.tree-error\s*\{[^}]*margin:\s*0;/)
    expect(treeCss).toContain('var(--app-item-content-inset)')
    expect(treeCss).not.toContain('--app-item-trailing-size:')
    expect(treeCss).not.toContain('--app-item-action-size:')
    expect(treeCss).not.toContain('--app-item-action-gap:')
    expect(treeCss).not.toContain('--app-item-icon-size:')
    expect(treeCss).not.toContain('--app-item-row-padding-')
    expect(appMenuCss).not.toContain('--app-item-row-height:')
    expect(appMenuCss).not.toContain('--app-item-row-padding-')
    expect(appMenuCss).not.toContain('--app-item-row-radius:')
    expect(appMenuCss).not.toContain('--app-item-font-size:')
    expect(appMenuCss).not.toContain('data-starting-style')
    expect(appMenuCss).not.toContain('data-ending-style')
    expect(appMenuCss).not.toContain('transform: scale(')
    expect(settingsSelectCss).not.toMatch(/\.settings-select-item\s*\{[^}]*--app-item-row-height:/)
    expect(indexCss).toContain('--app-button-font-size-md: 13px;')
    expect(indexCss).not.toContain('--app-button-outline-')
    expect(indexCss).not.toContain('--app-button-ghost-')
    expect(appButtonCss).toContain('--app-button-background: transparent;')
    expect(appButtonCss).toContain("--app-button-hover-background: var(--hover);")
    expect(appMenuCss).not.toContain('--app-menu-trigger-')
    expect(settingsSelectCss).not.toMatch(/\.settings-select-trigger\s*\{[^}]*(?:min-)?height:/)
    expect(settingsSelectCss).not.toMatch(/\.settings-select-trigger\s*\{[^}]*font-size:/)
    expect(settingsSelectCss).not.toMatch(/\.settings-select-trigger\s*\{[^}]*border-radius:/)

    expect(appMenuSource).toContain('alignItemWithTrigger = true')
    expect(settingsSelectSource).toMatch(/<Select\.Positioner[\s\S]{0,160}alignItemWithTrigger/)
    expect(settingsSelectSource).toContain('<Select.Trigger')
    expect(settingsSelectSource).toMatch(
      /<Select\.Trigger[\s\S]{0,180}variant='outline'/,
    )
    expect(settingsSelectSource).not.toContain("'app-menu-trigger app-menu-trigger-outline settings-select-trigger'")
    expect(settingsSelectSource).toContain('<Select.ScrollList')
    expect(settingsSelectSource).toContain("size='anchor'")
    expect(settingsSelectSource).not.toContain('settings-select-popup')
    expect(settingsSelectCss).not.toContain('.settings-select-popup')
    expect(settingsSelectSource).toContain("scrollAreaClassName='settings-select-scroll'")
    expect(settingsSelectSource).toContain('<Select.Item')
    expect(settingsSelectSource).not.toContain('<BaseSelect.')
    expect(settingsSelectSource).not.toContain('@base-ui/react/scroll-area')
    expect(fileSystemSource).toContain('alignItemWithTrigger={alignItemWithTrigger}')
    expect(fileSystemSource).not.toContain('alignItemWithTrigger={false}')
    expect(fileSystemSource).toContain('<MenuSelect.Trigger')
    expect(fileSystemSource).toMatch(
      /<MenuSelect\.Trigger[\s\S]{0,320}size=\{size\}[\s\S]{0,80}variant="outline"/,
    )
    expect(fileSystemSource).not.toContain('"app-menu-trigger app-menu-trigger-outline app-menu-trigger-sm')
    expect(fileSystemSource).toContain('compact?: boolean')
    expect(fileSystemSource).not.toContain('variant?: "default" | "icon"')
    expect(fileSystemSource).not.toContain('size: _size')
    expect(fileSystemSource).not.toContain('className="h-8 min-h-8 shrink-0 [&_svg]:size-4"')
    expect(fileSystemSource).toContain('<MenuSelect.Value')
    expect(fileSystemSource).toContain('<MenuSelect.Item')
    expect(fileSystemSource).toMatch(
      /<SelectItem[\s\S]{0,180}icon=\{<SystemIcon[\s\S]{0,120}>\s*\{option\.label\}/,
    )
    expect(fileSystemSource).not.toContain('<BaseSelect.')
    expect(fileSystemSource).not.toContain('alignItemWithTrigger: _alignItemWithTrigger')
    expect(fileSystemSource).not.toContain('FILE_SYSTEM_FILE_TYPE_MENU_CLASSNAME')
    expect(fileSystemSource).toMatch(/<DropdownMenuSubContent size="md">/)
    expect(fileSystemSource).toMatch(/<DropdownMenuContent align="start" size="md">/)
  })

  it('prevents business menus from redefining shared item geometry and state tokens', async () => {
    const [
      appMenuSource,
      agentModelCss,
      agentModelSource,
      agentNewPromptCss,
      agentQueuedCss,
      agentSessionCss,
      agentTypeCss,
      agentTypeSource,
      fileSystemSource,
      gitCss,
      mentionCss,
      projectMenuSource,
      treeCss,
    ] = await Promise.all([
      readFile(new URL('../src/components/app-menu/app-menu.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/agent/components/agent-model-cascader/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/agent/components/agent-model-cascader/agent-model-cascader.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/agent/components/agent-new-conversation-prompt/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/agent/components/agent-queued-composer-tray/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/agent/components/agent-session-tree/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/agent/components/agent-type-switch/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/agent/components/agent-type-switch/agent-type-switch.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/ui/file-system/file-system.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/git/components/git-panel/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/agent/components/agent-composer-mention-input/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/workspace/components/project-menu/project-menu.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/tree/styles.css', import.meta.url), 'utf8'),
    ])
    const businessCssFiles = [
      ...await collectCssFiles(new URL('../src/features/', import.meta.url)),
      ...await collectCssFiles(new URL('../src/components/ui/', import.meta.url)),
    ]
    const businessSourceFiles = [
      ...await collectTypeScriptFiles(new URL('../src/features/', import.meta.url)),
      ...await collectTypeScriptFiles(new URL('../src/components/ui/', import.meta.url)),
    ]
    const fileTypeCommandSource = fileSystemSource.slice(
      fileSystemSource.indexOf('function FileSystemFileTypeCommand'),
      fileSystemSource.indexOf('// Toolbar filter menu:'),
    )
    const prohibitedOverrides: string[] = []
    const popupMaxWidthOverrideFiles: string[] = []
    const inlineMenuTokenOverrideFiles: string[] = []
    const compoundLayoutFiles: string[] = []

    await Promise.all(businessCssFiles.map(async (fileUrl) => {
      const source = await readFile(fileUrl, 'utf8')

      if (
        /--app-menu-item-(?:hover|active)-background\s*:/.test(source)
        || /--app-item-(?:content-gap|content-inset|list-gap)\s*:/.test(source)
        || /--app-menu-(?:content-padding|popup-max-height|popup-min-width|popup-radius|popup-shadow)\s*:/.test(source)
        || /\.app-menu-list[^{]*\{[^}]*\bgap\s*:/s.test(source)
        || /\.app-menu-item[^{]*\{[^}]*\bmargin(?:-[a-z]+)?\s*:/s.test(source)
        || /--app-item-row-(?:description-min-height|height|padding-left|padding-right|radius)\s*:/.test(source)
        || /--app-item-font-size\s*:/.test(source)
      ) {
        prohibitedOverrides.push(fileUrl.pathname.replace(/\\/g, '/'))
      }

      if (/--app-menu-popup-max-width\s*:/.test(source)) {
        popupMaxWidthOverrideFiles.push(fileUrl.pathname.replace(/\\/g, '/'))
      }
    }))

    await Promise.all(businessSourceFiles.map(async (fileUrl) => {
      const source = await readFile(fileUrl, 'utf8')
      const sourcePath = fileUrl.pathname.replace(/\\/g, '/')

      if (source.includes('--app-menu-')) {
        inlineMenuTokenOverrideFiles.push(sourcePath)
      }

      if (
        source.includes("layout='compound'")
        || source.includes("layout={isCompoundMenu ? 'compound' : 'list'}")
      ) {
        compoundLayoutFiles.push(sourcePath)
      }
    }))

    expect(prohibitedOverrides).toEqual([])
    expect(inlineMenuTokenOverrideFiles).toEqual([])
    expect(popupMaxWidthOverrideFiles).toHaveLength(1)
    expect(popupMaxWidthOverrideFiles[0]).toMatch(
      /\/src\/features\/agent\/components\/agent-model-cascader\/styles\.css$/,
    )
    expect(compoundLayoutFiles).toHaveLength(2)
    expect(compoundLayoutFiles).toEqual(expect.arrayContaining([
      expect.stringMatching(/\/src\/features\/agent\/components\/agent-model-cascader\/agent-model-cascader\.tsx$/),
      expect.stringMatching(/\/src\/features\/workspace\/components\/project-menu\/project-menu\.tsx$/),
    ]))
    for (const fileUrl of businessCssFiles) {
      const source = await readFile(fileUrl, 'utf8')
      expect(source, fileUrl.pathname).not.toMatch(/\.[a-z0-9-]*(?:menu|select)-positioner\b/i)
    }
    expect(treeCss).not.toContain('--app-item-row-padding-')
    expect(treeCss).not.toContain('--app-item-row-description-min-height: 48px;')
    expect(gitCss).not.toContain('--app-item-row-description-min-height:')
    expect(gitCss).not.toContain('--app-item-row-height: 32px;')
    expect(gitCss).not.toMatch(
      /\.git-history-(?:list|tree-list)\s*\{[^}]*\bgap\s*:/,
    )

    expect(agentModelSource).toContain('is-highlighted')
    expect(agentModelSource).not.toContain('is-active')
    expect(agentModelCss).not.toContain('.agent-model-cascader-option.is-active')
    expect(agentModelCss).not.toContain('.agent-model-cascader-option-main')
    expect(agentModelCss).not.toContain('.agent-model-cascader-option-sub')
    expect(agentModelCss).not.toContain('.agent-model-cascader-option-arrow')
    expect(agentModelCss).not.toContain('--app-menu-item-hover-background')
    expect(agentModelCss).toContain('--app-menu-popup-max-width: 680px;')
    expect(agentModelCss).not.toMatch(
      /\.agent-model-cascader-trigger-thinking\s*\{[^}]*(?:font-size|line-height):/,
    )
    expect(agentTypeCss).not.toContain('.agent-type-switch-menu-separator')
    expect(agentTypeCss).not.toContain('.agent-type-switch-option-title')
    expect(agentTypeCss).not.toContain('.agent-type-switch-option-copy')
    expect(agentTypeCss).not.toContain('.agent-type-switch-option {')
    expect(agentTypeCss).not.toContain('.agent-type-switch-option >')
    expect(agentTypeCss).not.toMatch(
      /\.agent-type-switch-trigger\s*\{[^}]*(?:font-size|line-height):/,
    )
    expect(agentTypeSource).not.toContain('AgentTypeSwitchOptionCopy')
    expect(agentTypeSource).not.toContain("size='lg'")
    expect(agentTypeSource).toContain('text={availability.definition.label}')
    expect(agentTypeSource).toContain('description={isUnavailable ? (')
    expect(agentSessionCss).not.toMatch(
      /\.agent-project-switch-trigger\s*\{[^}]*line-height:/,
    )
    expect(agentSessionCss).not.toContain('--tree-scroll-content-inline-padding')
    expect(agentQueuedCss).not.toMatch(/\.agent-queued-action\s*\{/)
    expect(agentQueuedCss).not.toMatch(/\.agent-queued-action\[aria-expanded/)
    expect(agentNewPromptCss).toMatch(
      /\.agent-new-conversation-prompt h2 \.app-menu-trigger\s*\{[^}]*font-size:\s*inherit;/,
    )
    expect(mentionCss).not.toMatch(
      /\.agent-composer-mention-option-inline \.agent-composer-mention-option-label\s*\{[^}]*(?:font-size|font-weight|line-height):/,
    )
    expect(projectMenuSource).not.toContain('size={18}')

    expect(appMenuSource).toContain('export const AppMenuSelectGroup')
    expect(appMenuSource).toContain('Group: AppMenuSelectGroup')
    expect(appMenuSource).toContain('GroupLabel: AppMenuSelectGroupLabel')
    expect(appMenuSource).toContain('ItemIndicator: AppMenuSelectItemIndicator')
    expect(fileSystemSource).toMatch(
      /<DropdownMenuItem[\s\S]{0,100}text=\{dateFilterPresetLabel\(preset\)\}/,
    )
    expect(fileTypeCommandSource).toContain('<CommandItem')
    expect(fileTypeCommandSource).toContain('icon={(')
    expect(fileTypeCommandSource).toContain('info={isChecked ?')
    expect(fileTypeCommandSource).toContain('infoVariant="status"')
    expect(fileTypeCommandSource).toContain('text={option.label}')
    expect(fileTypeCommandSource).not.toMatch(/<CommandItem[\s\S]*?>[\s\S]*?<\/CommandItem>/)
  })
})
