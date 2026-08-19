import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const STATIC_SHELL_ICON_SOURCES = [
  'src/components/app-titlebar/app-titlebar.tsx',
  'src/features/agent/components/agent-brand-icon/agent-brand-icon.tsx',
  'src/features/command-palette/components/command-palette/command-palette.tsx',
  'src/features/layout/components/app-chrome-controls/app-chrome-controls.tsx',
  'src/features/workspace/components/workspace-editor-surface/workspace-editor-surface.tsx',
  'src/features/workspace/components/workspace-sidebar/workspace-sidebar.tsx',
  'src/features/workspace/components/workspace-tree-panel/workspace-tree-panel.tsx',
]

const AGENT_ICON_ASSETS = [
  'aryn.svg',
  'codex.svg',
  'opencode.svg',
  'pi.svg',
]

describe('app shell icons', () => {
  it('bundles always-visible shell icons instead of fetching Iconify collections at runtime', async () => {
    const sources = await Promise.all(STATIC_SHELL_ICON_SOURCES.map(async (sourcePath) => (
      readFile(path.resolve(sourcePath), 'utf8')
    )))

    for (const source of sources) {
      expect(source).not.toContain('material-symbols:chrome-')
      expect(source).not.toContain('lucide:search')
      expect(source).not.toContain('lucide:settings')
      expect(source).not.toContain('ri:menu-fold-line')
      expect(source).not.toContain('lucide:file-plus')
      expect(source).not.toContain('lucide:folder-plus')
      expect(source).not.toContain('lucide:fold-vertical')
      expect(source).not.toContain('lucide:unfold-vertical')
    }
  })

  it('uses the window-minimize glyph for the minimize control', async () => {
    const source = await readFile(path.resolve(
      'src/components/app-titlebar/app-titlebar.tsx',
    ), 'utf8')

    expect(source).toContain('MinimizeLine')
    expect(source).not.toContain('SubtractLine')
  })

  it('resolves every agent icon from the document base and ships each referenced SVG', async () => {
    const source = await readFile(path.resolve(
      'src/features/agent/components/agent-brand-icon/agent-brand-icon.tsx',
    ), 'utf8')

    expect(source).toContain('new URL(relativePath, document.baseURI).href')
    await Promise.all(AGENT_ICON_ASSETS.map(async (fileName) => {
      expect(source).toContain(`'${fileName}'`)
      const svg = await readFile(path.resolve('public/agent-icons', fileName), 'utf8')
      expect(svg).toMatch(/^<svg\b/)
      expect(svg).toContain('viewBox="0 0 16 16"')
    }))
  })
})
