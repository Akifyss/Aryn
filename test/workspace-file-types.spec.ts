import { describe, expect, it } from 'vitest'
import {
  getCodeLanguage,
  getDefaultWorkspaceFileViewMode,
  getWorkspaceEditorKind,
  supportsAlternateCodeEditorView,
  supportsMeoEditor,
} from '../src/features/workspace/lib/file-types'

describe('workspace file types', () => {
  it('routes markdown and plain text files to the prose editor', () => {
    expect(getWorkspaceEditorKind('C:/workspace/draft.md')).toBe('prose')
    expect(getWorkspaceEditorKind('C:/workspace/snippet.mdc')).toBe('prose')
    expect(getWorkspaceEditorKind('C:/workspace/README')).toBe('prose')
    expect(getWorkspaceEditorKind('C:/workspace/notes.txt')).toBe('prose')
  })

  it('routes code and config files to the code editor', () => {
    expect(getWorkspaceEditorKind('C:/workspace/main.ts')).toBe('code')
    expect(getWorkspaceEditorKind('C:/workspace/index.html')).toBe('code')
    expect(getWorkspaceEditorKind('C:/workspace/.env.local')).toBe('code')
    expect(getWorkspaceEditorKind('C:/workspace/Dockerfile')).toBe('code')
  })

  it('leaves unsupported files closed', () => {
    expect(getWorkspaceEditorKind('C:/workspace/logo.png')).toBe('unsupported')
    expect(getWorkspaceEditorKind('C:/workspace/archive.zip')).toBe('unsupported')
  })

  it('maps known code files to monaco languages', () => {
    expect(getCodeLanguage('C:/workspace/main.tsx')).toBe('typescript')
    expect(getCodeLanguage('C:/workspace/index.html')).toBe('html')
    expect(getCodeLanguage('C:/workspace/component.mdc')).toBe('markdown')
    expect(getCodeLanguage('C:/workspace/theme.css')).toBe('css')
    expect(getCodeLanguage('C:/workspace/config.yaml')).toBe('yaml')
    expect(getCodeLanguage('C:/workspace/.env')).toBe('plaintext')
  })

  it('defaults MEO-capable files to MEO and other editable text to Monaco code view', () => {
    expect(getDefaultWorkspaceFileViewMode('C:/workspace/index.html', 'code')).toBe('code')
    expect(getDefaultWorkspaceFileViewMode('C:/workspace/partial.htm', 'code')).toBe('code')
    expect(getDefaultWorkspaceFileViewMode('C:/workspace/main.ts', 'code')).toBe('code')
    expect(getDefaultWorkspaceFileViewMode('C:/workspace/notes.md', 'prose')).toBe('meo')
    expect(getDefaultWorkspaceFileViewMode('C:/workspace/notes.txt', 'prose')).toBe('code')
  })

  it('only exposes alternate Monaco entry points for files that default to MEO', () => {
    expect(supportsAlternateCodeEditorView('C:/workspace/index.html', 'code')).toBe(false)
    expect(supportsAlternateCodeEditorView('C:/workspace/notes.md', 'prose')).toBe(true)
    expect(supportsAlternateCodeEditorView('C:/workspace/notes.txt', 'prose')).toBe(false)
    expect(supportsAlternateCodeEditorView('C:/workspace/main.ts', 'code')).toBe(false)
    expect(supportsAlternateCodeEditorView('C:/workspace/config.json', 'code')).toBe(false)
  })

  it('only exposes MEO for markdown-native prose files', () => {
    expect(supportsMeoEditor('C:/workspace/notes.md', 'prose')).toBe(true)
    expect(supportsMeoEditor('C:/workspace/notes.markdown', 'prose')).toBe(true)
    expect(supportsMeoEditor('C:/workspace/notes.mdc', 'prose')).toBe(true)
    expect(supportsMeoEditor('C:/workspace/notes.mdx', 'prose')).toBe(true)
    expect(supportsMeoEditor('C:/workspace/notes.txt', 'prose')).toBe(false)
    expect(supportsMeoEditor('C:/workspace/index.html', 'code')).toBe(false)
  })
})
