import { describe, expect, it } from 'vitest'
import {
  areSameWorkspacePaths,
  canMoveNodeToDirectory,
  getParentDirectoryPath,
  resolveDropTargetDirectoryPath,
} from '@/features/workspace/lib/workspace-tree-dnd'
import type { WorkspaceNode } from '@/features/workspace/types'

describe('workspace tree drag and drop helpers', () => {
  it('preserves Windows separators when resolving a parent directory', () => {
    expect(getParentDirectoryPath('C:\\workspace\\drafts\\chapter.md')).toBe('C:\\workspace\\drafts')
    expect(getParentDirectoryPath('C:\\workspace\\draft.md')).toBe('C:\\workspace')
  })

  it('treats slash variants of the same workspace path as equal', () => {
    expect(areSameWorkspacePaths('C:\\workspace', 'C:/workspace')).toBe(true)
    expect(areSameWorkspacePaths('C:\\workspace\\drafts', 'C:/workspace/notes')).toBe(false)
  })

  it('resolves a root file drop target back to the workspace root on Windows paths', () => {
    const rootPath = 'C:\\workspace'
    const fileNode: WorkspaceNode = {
      kind: 'file',
      name: 'draft.md',
      path: 'C:\\workspace\\draft.md',
    }

    expect(resolveDropTargetDirectoryPath(fileNode, rootPath)).toBe(rootPath)
  })

  it('allows moving a nested file into the workspace root but blocks same-directory no-ops', () => {
    const nestedFileNode: WorkspaceNode = {
      kind: 'file',
      name: 'draft.md',
      path: 'C:\\workspace\\chapters\\draft.md',
    }
    const rootFileNode: WorkspaceNode = {
      kind: 'file',
      name: 'root.md',
      path: 'C:\\workspace\\root.md',
    }

    expect(canMoveNodeToDirectory(nestedFileNode, 'C:/workspace')).toBe(true)
    expect(canMoveNodeToDirectory(rootFileNode, 'C:/workspace')).toBe(false)
  })
})
