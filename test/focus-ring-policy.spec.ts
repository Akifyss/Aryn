import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url))

function readSource(path: string) {
  return readFile(join(workspaceRoot, path), 'utf8')
}

describe('input focus ring policy', () => {
  it('removes rings from text-entry controls without suppressing button focus', async () => {
    const [
      indexCss,
      projectMenuCss,
      modelCascaderCss,
      newProjectCss,
      gitPanelCss,
      interactionCss,
      queuedComposerCss,
      viewerControlsCss,
      fileSystemSource,
      meoWebviewCss,
    ] = await Promise.all([
      readSource('src/index.css'),
      readSource('src/features/workspace/components/project-menu/styles.css'),
      readSource('src/features/agent/components/agent-model-cascader/styles.css'),
      readSource('src/features/workspace/components/new-project-dialog/styles.css'),
      readSource('src/features/git/components/git-panel/styles.css'),
      readSource('src/features/agent/components/agent-interaction-panel/styles.css'),
      readSource('src/features/agent/components/agent-queued-composer-tray/styles.css'),
      readSource('src/components/ui/document-viewer-controls/styles.css'),
      readSource('src/components/ui/file-system/file-system.tsx'),
      readSource('src/vendor/meo/webview/styles.css'),
    ])

    const inputPolicy = indexCss.slice(
      indexCss.indexOf('/* Text-entry controls keep focus behavior'),
    )
    expect(inputPolicy).toContain('input:not([type])')
    expect(inputPolicy).toContain("[type='text']")
    expect(inputPolicy).toContain("[type='search']")
    expect(inputPolicy).toContain("[contenteditable]:not([contenteditable='false'])")
    expect(inputPolicy).toContain("[role='textbox']")
    expect(inputPolicy).toContain('--tw-ring-shadow: 0 0 #0000 !important;')
    expect(inputPolicy).toContain('outline: none !important;')
    expect(inputPolicy).toContain(":not([data-invalid], [aria-invalid='true'])")
    expect(inputPolicy).not.toContain("[type='checkbox']")
    expect(inputPolicy).not.toContain("[type='radio']")
    expect(inputPolicy).not.toContain("[type='range']")
    expect(inputPolicy).not.toContain("[type='file']")

    expect(projectMenuCss).not.toContain('.project-menu-search:focus-within')
    expect(modelCascaderCss).not.toContain('.agent-model-cascader-search:focus-within')
    expect(newProjectCss).not.toContain('.project-create-field input:focus')
    expect(gitPanelCss).not.toContain('.git-commit-textarea:focus')
    expect(interactionCss).not.toContain('.agent-interaction-input:focus-visible')
    expect(queuedComposerCss).not.toContain('.agent-queued-edit-input:focus')
    expect(viewerControlsCss).not.toContain('.viewer-search-field:focus-within')
    expect(viewerControlsCss).toContain(
      '.viewer-toolbar-page-control:is(button):focus-visible',
    )

    const commandInputSource = fileSystemSource.slice(
      fileSystemSource.indexOf('const CommandInput'),
      fileSystemSource.indexOf('function CommandList'),
    )
    const inputSource = fileSystemSource.slice(
      fileSystemSource.indexOf('const Input ='),
      fileSystemSource.indexOf('function Popover'),
    )
    const searchFieldSource = fileSystemSource.slice(
      fileSystemSource.indexOf('function FileSystemSearchField'),
      fileSystemSource.indexOf('function FileSystemSortSelect'),
    )
    expect(commandInputSource).not.toContain('focus-visible:ring')
    expect(inputSource).not.toContain('focus-visible:ring')
    expect(searchFieldSource).not.toContain('focus-within:ring')

    expect(meoWebviewCss).toMatch(
      /\.meo-native-theme \.find-input:focus\s*\{[^}]*outline:\s*none;[^}]*box-shadow:\s*none;/s,
    )
  })
})
