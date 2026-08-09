import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

function readSource(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
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
    expect(shellSource).toContain("import { AppButton } from '@/components/app-button'")
    expect(shellSource).toContain("import { AppIconButton } from '@/components/app-icon-button'")
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
    expect(editorSource).toContain('const eventAbortController = new AbortController()')
    expect(editorSource).toContain('eventAbortController.abort()')
    expect(editorSource).toContain('shell.disconnectController()')
    expect(editorSource).not.toContain('root.replaceChildren()')
    expect(editorSource).not.toContain('createOutlineController')
    expect(hostSource).not.toContain('root: editorShell.root')
    expect(outlineSource).toContain('<AppScrollArea')
    expect(outlineSource).toContain('<AppButton')
    expect(outlineSource).not.toContain('document.createElement')
    expect(profileSource).toContain("'meo-host:react-chrome-ready'")
    expect(profileSource).not.toContain("'native-meo:create-shell:end'")
    expect(shellCss).toContain('.selection-inline-menu.is-visible')
  })
})
