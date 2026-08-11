import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

function readSource(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

const SHARED_ICON_BUTTON_VISUAL_PROPERTIES =
  /(?:^|;)\s*(?:appearance|display|align-items|justify-content|width|min-width|height|min-height|padding|border(?:-[\w-]+)?|border-radius|background(?:-[\w-]+)?|color|font|line-height|cursor|opacity|outline|transition|box-shadow)\s*:/m

function findSharedIconButtonVisualOverrides(source: string, contextualClass: string) {
  const contextualClassPattern = new RegExp(`\\.${contextualClass}(?![\\w-])`)
  const violations: string[] = []

  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selectorList, declarations] = match
    if (!SHARED_ICON_BUTTON_VISUAL_PROPERTIES.test(declarations)) {
      continue
    }

    for (const selector of selectorList.split(',')) {
      if (
        contextualClassPattern.test(selector)
        && !selector.includes(':not(.app-icon-button)')
      ) {
        violations.push(selector.trim())
      }
    }
  }

  return violations
}

describe('MEO React chrome boundary', () => {
  it('renders application chrome with shared React components and locally bundled icons', async () => {
    const shellSource = await readSource(
      'src/features/editor/lib/meo-native-editor-shell.tsx',
    )

    expect(shellSource).toContain("from '@mingcute/react'")
    expect(shellSource).toContain("from '@iconify/react/offline'")
    expect(shellSource).toContain("from '@iconify-icons/lucide/whole-word'")
    expect(shellSource).toContain("import { Input } from '@heroui/react'")
    expect(shellSource).toContain("import { AppIconButton } from '@/components/app-icon-button'")
    expect(shellSource).toContain('SegmentedIconTabs')
    expect(shellSource).toContain("AppMenu as Menu")
    expect(shellSource).toContain('const MeoNativeEditorChromeImpl = forwardRef')
    expect(shellSource).toContain('memo(MeoNativeEditorChromeImpl)')
    expect(shellSource).toContain("aria-hidden='true'")
    expect(shellSource).toContain('headingMenuControllerRef.current?.close()')
    expect(shellSource).toContain("findPanelElements.panel.setAttribute('aria-hidden', 'true')")
    expect(shellSource).toContain("selectionMenu.setAttribute('aria-hidden', 'true')")
    expect(shellSource).not.toContain('createRoot(')
    expect(shellSource).not.toContain('createPortal(')
    expect(shellSource).not.toContain("from 'lucide'")
    expect(shellSource).not.toContain("document.createElement('button')")
    expect(shellSource).not.toContain('createFindPanel(')
    expect(shellSource).not.toContain('createSelectionMenu(')
  })

  it('uses action-specific icons for editor-only concepts', async () => {
    const shellSource = await readSource(
      'src/features/editor/lib/meo-native-editor-shell.tsx',
    )

    for (const icon of [
      'headingIcon',
      'heading1Icon',
      'heading2Icon',
      'heading3Icon',
      'heading4Icon',
      'heading5Icon',
      'heading6Icon',
      'listTreeIcon',
      'minusIcon',
      'replaceIcon',
      'replaceAllIcon',
      'wholeWordIcon',
      'ListCheck3Line',
      'EditLine',
      'CodeLine',
    ]) {
      expect(shellSource).toContain(icon)
    }

    for (const misleadingIcon of [
      'BorderHorizontalLine',
      'Heading1Line',
      'LetterSpacingLine',
      'ListSearchLine',
      'Refresh2Line',
      'RepeatLine',
      'TaskLine',
    ]) {
      expect(shellSource).not.toContain(misleadingIcon)
    }

    expect(shellSource).not.toContain('meo-heading-menu-level')
    expect(shellSource).not.toContain('MeoModeTextButton')
    expect(shellSource).not.toContain('MeoModeIconButton')
    expect(shellSource).toMatch(/ariaLabel: 'Live preview mode',[\s\S]*?icon: <EditLine/)
    expect(shellSource).toMatch(/ariaLabel: 'Markdown source mode',[\s\S]*?icon: <CodeLine/)
  })

  it('keeps the CodeMirror engine outside React while the shell owns the outline', async () => {
    const [editorSource, hostSource, outlineSource, profileSource, shellCss] = await Promise.all([
      readSource('src/features/editor/lib/meo-native-editor.ts'),
      readSource('src/features/editor/components/meo-editor-host/meo-editor-host.tsx'),
      readSource('src/features/editor/lib/meo-native-outline.tsx'),
      readSource('scripts/electron-open-file-profile.mjs'),
      readSource('src/features/editor/lib/meo-native-editor-shell.css'),
    ])

    expect(hostSource).toContain('<MeoNativeEditorChrome ref={editorChromeRef} />')
    expect(editorSource).toContain('shell.setEditorGetter(getActiveEditor)')
    expect(editorSource).toContain('shell.setMode(currentMode)')
    expect(editorSource).toContain('shell.setModeChangeHandler(applyMode)')
    expect(editorSource).toContain('const eventAbortController = new AbortController()')
    expect(editorSource).toContain('eventAbortController.abort()')
    expect(editorSource).toContain('shell.disconnectController()')
    expect(editorSource).not.toContain('root.replaceChildren()')
    expect(editorSource).not.toContain('createOutlineController')
    expect(editorSource).not.toContain('modeGroupKeydownHandler')
    expect(editorSource).not.toContain("liveButton.addEventListener('click'")
    expect(hostSource).not.toContain('root: editorShell.root')
    expect(outlineSource).toContain('<AppScrollArea')
    expect(outlineSource).toContain('<AppButton')
    expect(outlineSource).not.toContain('document.createElement')
    expect(profileSource).toContain("'meo-host:react-chrome-ready'")
    expect(profileSource).not.toContain("'native-meo:create-shell:end'")
    expect(shellCss).toContain('.selection-inline-menu.is-visible')
  })

  it('renders diff actions through shared React controls instead of button-specific DOM factories', async () => {
    const [controlsSource, splitSource, inlineSource] = await Promise.all([
      readSource('src/features/editor/components/meo-diff-controls/meo-diff-controls.tsx'),
      readSource('src/features/editor/lib/meo-native-diff-split.ts'),
      readSource('src/features/editor/lib/meo-native-live-inline-diff.ts'),
    ])

    expect(controlsSource).toContain("import { AppIconButton } from '@/components/app-icon-button'")
    expect(controlsSource).toContain("from '@mingcute/react'")
    expect(controlsSource).toContain("from '@iconify/react/offline'")
    expect(controlsSource).toContain('<AppIconButton')
    expect(splitSource).toContain('mountMeoDiffHunkActions')
    expect(splitSource).toContain('mountMeoDiffHunkAction')
    expect(splitSource).toContain('mountedHunkActionControls.delete(trackedControl)')
    expect(inlineSource).toContain('mountMeoLiveInlineDiffToolbar')
    expect(inlineSource).toContain('this.toolbar.destroy()')
    expect(splitSource).not.toContain('getHunkActionIcon')
    expect(splitSource).not.toContain('createHunkActionButton')
    expect(splitSource).toContain('placeholder.hidden = true')
    expect(inlineSource).not.toContain('createHunkActionButton')
    expect(inlineSource).not.toContain('createNavButton')
    expect(inlineSource).not.toContain('button.innerHTML')
    expect(controlsSource).toContain("dom.setAttribute('aria-orientation', 'vertical')")
    expect(controlsSource).not.toContain("classList.toggle('is-busy'")
  })

  it('keeps shared icon-button visuals owned by AppIconButton across the MEO surface', async () => {
    const [shellCss, vendorCss, mergeTheme] = await Promise.all([
      readSource('src/features/editor/lib/meo-native-editor-shell.css'),
      readSource('src/vendor/meo/webview/styles.css'),
      readSource('src/vendor/codemirror-merge/src/theme.ts'),
    ])

    expect(shellCss).not.toContain('.app-icon-button')
    expect(shellCss).not.toContain('--toolbar-hoverBackground')

    for (const contextualClass of [
      'format-button',
      'selection-inline-button',
      'meo-diff-hunk-action',
      'meo-live-inline-diff-nav-button',
    ]) {
      expect(findSharedIconButtonVisualOverrides(vendorCss, contextualClass)).toEqual([])
    }

    expect(vendorCss).toMatch(
      /\.cm-merge-revert\s*\{[^}]*width:\s*calc\(var\(--app-icon-button-size-sm\) \+ 4px\);[^}]*border:\s*0;/,
    )
    expect(vendorCss).not.toMatch(
      /\.cm-merge-revert\s*\{[^}]*(?:border-left|border-right)\s*:/,
    )
    expect(vendorCss).toContain('inset-inline-start: 0;')
    expect(vendorCss).toMatch(
      /\.meo-diff-floating-hunk-toolbar,[\s\S]*?\.cm-chunkButtons\s*\{[^}]*gap:\s*2px;[^}]*height:\s*var\(--meo-live-inline-diff-floating-height, calc\(var\(--app-icon-button-size-sm\) \+ 4px\)\);[^}]*padding:\s*2px;/,
    )
    expect(vendorCss).toMatch(
      /\.meo-diff-split-body \.meo-diff-hunk-actions\s*\{[^}]*flex-flow:\s*column nowrap !important;[^}]*gap:\s*2px;[^}]*width:\s*calc\(var\(--app-icon-button-size-sm\) \+ 4px\);[^}]*padding:\s*2px;/,
    )
    expect(vendorCss).toMatch(
      /\.meo-diff-floating-control-surface,[\s\S]*?\.cm-chunkButtons,[\s\S]*?\.cm-merge-revert>\.meo-diff-hunk-actions\s*\{[^}]*background:\s*var\(--meo-floating-toolbar-background\) !important;[^}]*z-index:\s*var\(--meo-floating-toolbar-z-index\);/,
    )
    expect(vendorCss).toMatch(/\.meo-live-inline-diff-nav\s*\{[^}]*gap:\s*2px;/)
    expect(vendorCss).toMatch(
      /\.meo-live-inline-diff-header \.meo-live-inline-diff-hunk-actions\s*\{[^}]*gap:\s*2px;/,
    )
    expect(mergeTheme).toContain('.cm-merge-revert .cm-merge-defaultControl')
    expect(mergeTheme).toContain('& .cm-merge-defaultControl')
    expect(mergeTheme).not.toContain('.cm-merge-revert button')
    expect(mergeTheme).not.toContain('& button')
  })
})
