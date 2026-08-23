import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildThreadHostFileContentUrl,
  copyTextToClipboard,
  isAbsoluteFilePathWithinRoot,
  isRoutePath,
  normalizeAbsoluteFilePath,
  resolveAbsoluteFilePath,
  resolveRouteHref,
} from './host-services'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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

  it('resolves relative file paths only when a workspace root is available', () => {
    expect(resolveAbsoluteFilePath({
      path: 'nested/file.txt',
      rootPath: 'C:\\workspace',
    })).toBe('C:\\workspace/nested/file.txt')
    expect(resolveAbsoluteFilePath({
      path: 'nested/file.txt',
      rootPath: null,
    })).toBeNull()
    expect(resolveAbsoluteFilePath({
      path: '\\\\server\\share\\file.txt',
      rootPath: 'C:\\workspace',
    })).toBe('\\\\server\\share\\file.txt')
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
    expect(isAbsoluteFilePathWithinRoot({
      candidatePath: '/workspace/nested/file.txt',
      rootPath: '/workspace',
    })).toBe(true)
  })

  it('does not claim bb application routes inside the embedded Aryn surface', () => {
    expect(resolveRouteHref({
      currentOrigin: 'file://',
      href: '/projects/example/threads/thread-1',
    })).toBeNull()
    expect(isRoutePath({ path: '/projects/example/threads/thread-1' })).toBe(false)
  })
})

describe('bb clipboard compatibility', () => {
  it('uses the Clipboard API when it succeeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await expect(copyTextToClipboard('hello')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('falls back to the editing command and restores focus', async () => {
    let activeElement: FakeHTMLElement | null = null
    let appendedTextarea: FakeTextarea | null = null

    class FakeHTMLElement {
      isConnected = true
      focus() {
        activeElement = this
      }
    }
    class FakeTextarea extends FakeHTMLElement {
      value = ''
      readOnly = false
      style = {}
      removed = false
      setAttribute() {}
      select() {}
      setSelectionRange() {}
      remove() {
        this.removed = true
      }
    }

    const button = new FakeHTMLElement()
    activeElement = button
    const execCommand = vi.fn(() => true)
    vi.stubGlobal('HTMLElement', FakeHTMLElement)
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    vi.stubGlobal('document', {
      get activeElement() {
        return activeElement
      },
      body: {
        append(element: FakeTextarea) {
          appendedTextarea = element
        },
      },
      createElement() {
        return new FakeTextarea()
      },
      execCommand,
      getSelection() {
        return null
      },
    })

    await expect(copyTextToClipboard('fallback')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(activeElement).toBe(button)
    const renderedTextarea = appendedTextarea as unknown as FakeTextarea
    expect(renderedTextarea.value).toBe('fallback')
    expect(renderedTextarea.removed).toBe(true)
  })
})
