import { describe, expect, it } from 'vitest'
import { resolveWorkspaceMessageLink } from '../src/features/agent/lib/message-links'

describe('agent message links', () => {
  it('resolves workspace-relative markdown links to absolute file paths', () => {
    expect(resolveWorkspaceMessageLink(
      'C:\\Users\\25672\\Desktop\\Aryn\\workspace',
      'docs/markdown_example.md',
    )).toBe('C:\\Users\\25672\\Desktop\\Aryn\\workspace\\docs\\markdown_example.md')

    expect(resolveWorkspaceMessageLink(
      '/workspace/project',
      'README.md',
    )).toBe('/workspace/project/README.md')
  })

  it('accepts url-encoded workspace-relative paths', () => {
    expect(resolveWorkspaceMessageLink(
      '/workspace/project',
      'folder/My%20File.md',
    )).toBe('/workspace/project/folder/My File.md')
  })

  it('rejects external, absolute, and escaping links', () => {
    expect(resolveWorkspaceMessageLink('/workspace/project', 'https://example.com')).toBeNull()
    expect(resolveWorkspaceMessageLink('/workspace/project', '#section')).toBeNull()
    expect(resolveWorkspaceMessageLink('/workspace/project', '/absolute/file.md')).toBeNull()
    expect(resolveWorkspaceMessageLink('/workspace/project', '../outside.md')).toBeNull()
    expect(resolveWorkspaceMessageLink('C:\\workspace', 'C:\\temp\\file.md')).toBeNull()
  })
})
