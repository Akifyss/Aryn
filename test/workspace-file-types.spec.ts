import { describe, expect, it } from 'vitest'
import { getCodeLanguage, getWorkspaceEditorKind } from '../src/features/workspace/lib/file-types'

describe('workspace file types', () => {
  it('routes markdown and plain text files to the rich text editor', () => {
    expect(getWorkspaceEditorKind('C:/workspace/draft.md')).toBe('rich-text')
    expect(getWorkspaceEditorKind('C:/workspace/README')).toBe('rich-text')
    expect(getWorkspaceEditorKind('C:/workspace/notes.txt')).toBe('rich-text')
  })

  it('routes code and config files to the code editor', () => {
    expect(getWorkspaceEditorKind('C:/workspace/main.ts')).toBe('code')
    expect(getWorkspaceEditorKind('C:/workspace/.env.local')).toBe('code')
    expect(getWorkspaceEditorKind('C:/workspace/Dockerfile')).toBe('code')
  })

  it('leaves unsupported files closed', () => {
    expect(getWorkspaceEditorKind('C:/workspace/logo.png')).toBe('unsupported')
    expect(getWorkspaceEditorKind('C:/workspace/archive.zip')).toBe('unsupported')
  })

  it('maps known code files to monaco languages', () => {
    expect(getCodeLanguage('C:/workspace/main.tsx')).toBe('typescript')
    expect(getCodeLanguage('C:/workspace/theme.css')).toBe('css')
    expect(getCodeLanguage('C:/workspace/config.yaml')).toBe('yaml')
    expect(getCodeLanguage('C:/workspace/.env')).toBe('plaintext')
  })
})
