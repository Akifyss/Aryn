import { describe, expect, it } from 'vitest'
import { resolveDefaultWorkspaceFileTypeIcon } from '../src/components/workspace-file-icons'

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
})
