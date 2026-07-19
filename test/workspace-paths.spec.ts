import { describe, expect, it } from 'vitest'
import {
  getBaseName,
  getDirectoryRelativePath,
  getNextUntitledDirectoryName,
  getNextUntitledFileName,
  getRelativePath,
  hasPathPrefix,
  joinPath,
  normalizeFilePath,
  rebasePathPrefix,
} from '../src/features/workspace/lib/workspace-paths'

describe('workspace path helpers', () => {
  it('extracts base names from Windows and POSIX paths', () => {
    expect(getBaseName('C:\\workspace\\docs\\readme.md')).toBe('readme.md')
    expect(getBaseName('/workspace/docs/readme.md')).toBe('readme.md')
  })

  it('creates relative paths only for descendants of the workspace root', () => {
    expect(getRelativePath('C:\\workspace', 'C:\\workspace\\docs\\readme.md')).toBe('docs/readme.md')
    expect(getRelativePath('C:\\Workspace', 'c:\\workspace\\docs\\readme.md')).toBe('docs/readme.md')
    expect(getRelativePath('/workspace', '/workspace/docs/readme.md')).toBe('docs/readme.md')
    expect(getRelativePath('/workspace', '/workspace-copy/readme.md')).toBe('readme.md')
    expect(getRelativePath('/workspace', '/elsewhere/readme.md')).toBe('readme.md')
  })

  it('derives the containing directory from a workspace-relative file path', () => {
    expect(getDirectoryRelativePath('C:\\workspace', 'C:\\workspace\\docs\\guide\\intro.md'))
      .toBe('docs/guide')
    expect(getDirectoryRelativePath('C:\\workspace', 'C:\\workspace\\readme.md')).toBe('')
  })

  it('allocates untitled file and directory names case-insensitively', () => {
    expect(getNextUntitledFileName(['README.md'])).toBe('untitled.md')
    expect(getNextUntitledFileName(['Untitled.md', 'untitled-2.md'])).toBe('untitled-3.md')
    expect(getNextUntitledDirectoryName(['New-Folder', 'new-folder-1'])).toBe('new-folder-2')
  })

  it('normalizes paths and checks prefixes at directory boundaries', () => {
    expect(normalizeFilePath('C:\\Workspace\\docs//readme.md')).toBe('c:/workspace/docs/readme.md')
    expect(hasPathPrefix('C:\\Workspace\\docs\\readme.md', 'c:/workspace/docs')).toBe(true)
    expect(hasPathPrefix('C:\\Workspace-Copy\\readme.md', 'c:/workspace')).toBe(false)
  })

  it('joins and rebases paths using the destination separator', () => {
    expect(joinPath('C:\\workspace\\', '/docs/readme.md')).toBe('C:\\workspace\\docs\\readme.md')
    expect(joinPath('/workspace/', '\\docs\\readme.md')).toBe('/workspace/docs/readme.md')
    expect(rebasePathPrefix(
      'C:\\workspace\\docs\\guide.md',
      'C:\\workspace\\docs',
      'D:\\archive\\documentation',
    )).toBe('D:\\archive\\documentation\\guide.md')
  })
})
