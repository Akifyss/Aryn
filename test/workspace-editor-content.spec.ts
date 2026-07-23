import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  resolveWorkspaceEditorContentKind,
  type WorkspaceEditorContentKind,
} from '../src/features/workspace/components/workspace-editor-content/workspace-editor-content-state'
import type {
  WorkspaceFileTabEditorKind,
  WorkspaceFileViewMode,
} from '../src/features/workspace/lib/file-types'
import type {
  WorkspaceDiffTab,
  WorkspaceFileTab,
} from '../src/features/workspace/store/use-workspace-store'

function createFileTab(
  editorKind: WorkspaceFileTabEditorKind,
  viewMode: WorkspaceFileViewMode,
): WorkspaceFileTab {
  return {
    content: 'content',
    editorKind,
    exists: true,
    filePath: 'C:\\workspace\\file.md',
    id: 'file:C:\\workspace\\file.md',
    isDirty: false,
    kind: 'file',
    savedContent: 'content',
    viewMode,
  }
}

describe('resolveWorkspaceEditorContentKind', () => {
  it('returns no editor when there is no active workspace tab', () => {
    expect(resolveWorkspaceEditorContentKind({
      activeDiffTab: null,
      activeFileTab: null,
      isVisible: true,
    })).toBeNull()
  })

  it('does not expose an editor while a fixed workspace panel is active', () => {
    expect(resolveWorkspaceEditorContentKind({
      activeDiffTab: null,
      activeFileTab: createFileTab('prose', 'meo'),
      isVisible: false,
    })).toBeNull()
  })

  it('prioritizes an active diff tab', () => {
    expect(resolveWorkspaceEditorContentKind({
      activeDiffTab: { kind: 'diff' } as WorkspaceDiffTab,
      activeFileTab: createFileTab('prose', 'meo'),
      isVisible: true,
    })).toBe('diff')
  })

  it.each<[
    WorkspaceFileTabEditorKind,
    WorkspaceFileViewMode,
    WorkspaceEditorContentKind | null,
  ]>([
    ['prose', 'meo', 'meo'],
    ['prose', 'code', 'code'],
    ['code', 'code', 'code'],
    ['code', 'preview', 'html-preview'],
    ['file', 'file', 'file'],
    ['prose', 'preview', null],
    ['file', 'code', null],
  ])('maps %s/%s file tabs to %s', (editorKind, viewMode, expectedKind) => {
    expect(resolveWorkspaceEditorContentKind({
      activeDiffTab: null,
      activeFileTab: createFileTab(editorKind, viewMode),
      isVisible: true,
    })).toBe(expectedKind)
  })
})

describe('workspace editor content ownership', () => {
  it('keeps concrete editor views outside the application composition root', async () => {
    const [appSource, editorContentSource] = await Promise.all([
      readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
      readFile(
        new URL(
          '../src/features/workspace/components/workspace-editor-content/workspace-editor-content.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
    ])

    expect(appSource).toContain('<WorkspaceEditorContent')
    expect(appSource).not.toMatch(
      /<(CodeEditor|GitDiffEditor|HtmlPreview|MeoEditorHost|WorkspaceFilePreview)\b/,
    )
    for (const editorComponent of [
      'CodeEditor',
      'GitDiffEditor',
      'HtmlPreview',
      'MeoEditorHost',
      'WorkspaceFilePreview',
    ]) {
      expect(editorContentSource).toContain(`<${editorComponent}`)
    }
  })
})
