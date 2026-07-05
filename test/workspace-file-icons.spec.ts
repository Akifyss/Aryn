import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkspaceFileIcon } from '../src/components/file-change-visuals'
import {
  DEFAULT_WORKSPACE_FOLDER_GLYPH_DATA_URL,
  resolveDefaultWorkspaceDirectoryIcon,
  resolveDefaultWorkspaceFileTypeIcon,
} from '../src/components/workspace-file-icons'
import type { WorkspaceIconTheme } from '../src/features/workspace/types'

const customTheme: WorkspaceIconTheme = {
  defaultFileIcon: null,
  defaultFolderExpandedIcon: 'data:image/svg+xml,expanded-folder',
  defaultFolderIcon: 'data:image/svg+xml,folder',
  fileExtensions: {},
  fileNames: {},
  folderNames: {},
  folderNamesExpanded: {},
  hidesExplorerArrows: false,
  id: 'fixture-theme',
  label: 'Fixture theme',
}

describe('default workspace file icons', () => {
  it('uses the @pierre/trees complete icon resolver for common file types', () => {
    expect(resolveDefaultWorkspaceFileTypeIcon('styles.css')).toMatchObject({
      name: 'file-tree-builtin-css',
      token: 'css',
    })
    expect(resolveDefaultWorkspaceFileTypeIcon('component.tsx')).toMatchObject({
      name: 'file-tree-builtin-react',
      token: 'react',
    })
    expect(resolveDefaultWorkspaceFileTypeIcon('README.md')).toMatchObject({
      name: 'file-tree-builtin-markdown',
      token: 'markdown',
    })
  })

  it('falls back to the built-in default document icon for unknown files', () => {
    expect(resolveDefaultWorkspaceFileTypeIcon('archive.unknown-ext')).toMatchObject({
      name: 'file-tree-builtin-default',
      token: 'default',
    })
  })

  it('uses the @pierre/trees chevron slot for default-theme directories', () => {
    expect(resolveDefaultWorkspaceDirectoryIcon()).toMatchObject({
      name: 'file-tree-icon-chevron',
    })

    const collapsed = renderToStaticMarkup(createElement(WorkspaceFileIcon, {
      iconTheme: null,
      isClosed: true,
      isFolder: true,
      nodeLabel: 'src',
    }))
    const expanded = renderToStaticMarkup(createElement(WorkspaceFileIcon, {
      iconTheme: null,
      isClosed: false,
      isFolder: true,
      nodeLabel: 'src',
    }))

    expect(collapsed).toContain('data-icon-name="file-tree-icon-chevron"')
    expect(collapsed).toContain('-rotate-90')
    expect(expanded).toContain('data-icon-name="file-tree-icon-chevron"')
    expect(expanded).not.toContain('-rotate-90')
  })

  it('preserves directory icons and fallbacks for third-party themes', () => {
    const themed = renderToStaticMarkup(createElement(WorkspaceFileIcon, {
      iconTheme: customTheme,
      isClosed: true,
      isFolder: true,
      nodeLabel: 'src',
    }))
    const incompleteTheme = renderToStaticMarkup(createElement(WorkspaceFileIcon, {
      iconTheme: {
        ...customTheme,
        defaultFolderExpandedIcon: null,
        defaultFolderIcon: null,
      },
      isClosed: true,
      isFolder: true,
      nodeLabel: 'src',
    }))

    expect(themed).toContain('src="data:image/svg+xml,folder"')
    expect(themed).not.toContain('file-tree-icon-chevron')
    expect(incompleteTheme).toContain(DEFAULT_WORKSPACE_FOLDER_GLYPH_DATA_URL)
    expect(incompleteTheme).not.toContain('file-tree-icon-chevron')
  })
})
