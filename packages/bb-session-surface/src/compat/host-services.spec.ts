import { describe, expect, it } from 'vitest'
import {
  buildThreadHostFileContentUrl,
  isAbsoluteFilePathWithinRoot,
  normalizeAbsoluteFilePath,
} from './host-services'

describe('bb host file compatibility', () => {
  it('builds valid Windows drive and UNC file URLs', () => {
    expect(buildThreadHostFileContentUrl('thread-1', 'C:\\workspace\\image one.png'))
      .toBe('file:///C:/workspace/image%20one.png')
    expect(buildThreadHostFileContentUrl('thread-1', '\\\\server\\share\\image one.png'))
      .toBe('file://server/share/image%20one.png')
  })

  it('normalizes absolute paths without collapsing a UNC share root', () => {
    expect(normalizeAbsoluteFilePath({ path: 'c:\\workspace\\folder\\..\\image.png' }))
      .toBe('C:/workspace/image.png')
    expect(normalizeAbsoluteFilePath({ path: '\\\\server\\share\\..\\image.png' }))
      .toBe('//server/share/image.png')
  })

  it('rejects traversal and sibling-prefix paths outside the workspace root', () => {
    expect(isAbsoluteFilePathWithinRoot({
      candidatePath: 'C:/workspace/../secret.txt',
      rootPath: 'C:/workspace',
    })).toBe(false)
    expect(isAbsoluteFilePathWithinRoot({
      candidatePath: 'C:/workspace-other/file.txt',
      rootPath: 'C:/workspace',
    })).toBe(false)
    expect(isAbsoluteFilePathWithinRoot({
      candidatePath: 'C:/workspace/nested/file.txt',
      rootPath: 'c:/WORKSPACE',
    })).toBe(true)
  })
})
