import { describe, expect, it } from 'vitest'
import { resolveWorkspaceTreeActiveFilePath } from '../src/features/workspace/lib/workspace-tree-active-file'

describe('workspace tree active file path', () => {
  it('keeps the active file path when the tree tracks the active file', () => {
    expect(resolveWorkspaceTreeActiveFilePath('C:/workspace/notes.md', 'track-active-file')).toBe('C:/workspace/notes.md')
  })

  it('clears the active file path when active file highlighting is disabled', () => {
    expect(resolveWorkspaceTreeActiveFilePath('C:/workspace/notes.md', 'none')).toBeNull()
  })

  it('keeps an empty active file path empty', () => {
    expect(resolveWorkspaceTreeActiveFilePath(null, 'track-active-file')).toBeNull()
    expect(resolveWorkspaceTreeActiveFilePath(null, 'none')).toBeNull()
  })
})
