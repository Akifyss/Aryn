import { describe, expect, it } from 'vitest'
import {
  getCodeLanguage,
  getDefaultWorkspaceFileViewMode,
  getWorkspaceEditorKind,
  supportsCodeEditorToggle,
  supportsHtmlPreview,
  supportsMeoEditor,
} from '../src/features/workspace/lib/file-types'

describe('workspace file types', () => {
  it('routes markdown and plain text files to the rich text editor', () => {
    expect(getWorkspaceEditorKind('C:/workspace/draft.md')).toBe('rich-text')
    expect(getWorkspaceEditorKind('C:/workspace/snippet.mdc')).toBe('rich-text')
    expect(getWorkspaceEditorKind('C:/workspace/README')).toBe('rich-text')
    expect(getWorkspaceEditorKind('C:/workspace/notes.txt')).toBe('rich-text')
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

  it('defaults html files to preview and markdown-rich text files to MEO', () => {
    expect(supportsHtmlPreview('C:/workspace/index.html')).toBe(true)
    expect(supportsHtmlPreview('C:/workspace/partial.htm')).toBe(true)
    expect(supportsHtmlPreview('C:/workspace/main.ts')).toBe(false)

    expect(getDefaultWorkspaceFileViewMode('C:/workspace/index.html', 'code')).toBe('preview')
    expect(getDefaultWorkspaceFileViewMode('C:/workspace/main.ts', 'code')).toBe('default')
    expect(getDefaultWorkspaceFileViewMode('C:/workspace/notes.md', 'rich-text')).toBe('meo')
    expect(getDefaultWorkspaceFileViewMode('C:/workspace/notes.txt', 'rich-text')).toBe('default')
  })

  it('only exposes alternate code-view entry points for html and rich-text files', () => {
    expect(supportsCodeEditorToggle('C:/workspace/index.html', 'code')).toBe(true)
    expect(supportsCodeEditorToggle('C:/workspace/notes.md', 'rich-text')).toBe(true)
    expect(supportsCodeEditorToggle('C:/workspace/notes.txt', 'rich-text')).toBe(true)
    expect(supportsCodeEditorToggle('C:/workspace/main.ts', 'code')).toBe(false)
    expect(supportsCodeEditorToggle('C:/workspace/config.json', 'code')).toBe(false)
  })

  it('only exposes MEO for markdown-native rich-text files', () => {
    expect(supportsMeoEditor('C:/workspace/notes.md', 'rich-text')).toBe(true)
    expect(supportsMeoEditor('C:/workspace/notes.markdown', 'rich-text')).toBe(true)
    expect(supportsMeoEditor('C:/workspace/notes.mdc', 'rich-text')).toBe(true)
    expect(supportsMeoEditor('C:/workspace/notes.mdx', 'rich-text')).toBe(true)
    expect(supportsMeoEditor('C:/workspace/notes.txt', 'rich-text')).toBe(false)
    expect(supportsMeoEditor('C:/workspace/index.html', 'code')).toBe(false)
  })
})
