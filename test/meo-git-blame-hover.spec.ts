import { Text } from '@codemirror/state'
import { afterEach, describe, expect, it } from 'vitest'
import {
  gitGutterMarkerOwnsClientY,
  getGitGutterClickIntent,
  isInsideLiveInlineDiff,
  normalizeTrailingEofVisualLineHit,
} from '../src/vendor/meo/webview/helpers/gitBlameHover'

const originalHTMLElement = globalThis.HTMLElement
const originalElement = globalThis.Element

afterEach(() => {
  Object.defineProperty(globalThis, 'Element', {
    configurable: true,
    writable: true,
    value: originalElement,
  })
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    writable: true,
    value: originalHTMLElement,
  })
})

describe('meo git blame hover', () => {
  it('requests the previous real line when hovering the synthetic trailing EOF visual line', () => {
    Object.defineProperty(globalThis, 'HTMLElement', {
      configurable: true,
      writable: true,
      value: class HTMLElement {},
    })

    const doc = Text.of(['committed line', ''])
    const hit = normalizeTrailingEofVisualLineHit(doc, 2, null)

    expect(hit).toMatchObject({
      lineNumber: 1,
      requestLineNumber: 1,
      proxiedFromTrailingEof: true,
    })
  })

  it('keeps non-EOF visual lines on their own blame request line', () => {
    Object.defineProperty(globalThis, 'HTMLElement', {
      configurable: true,
      writable: true,
      value: class HTMLElement {},
    })

    const doc = Text.of(['first', 'second'])
    const hit = normalizeTrailingEofVisualLineHit(doc, 2, null)

    expect(hit).toMatchObject({
      lineNumber: 2,
      requestLineNumber: 2,
      proxiedFromTrailingEof: false,
    })
  })

  it('keeps plain gutter clicks on inline hunk expansion', () => {
    expect(getGitGutterClickIntent(
      { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false },
      { platform: 'Win32' },
    )).toBe('inline')
    expect(getGitGutterClickIntent(
      { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false },
      { platform: 'MacIntel' },
    )).toBe('inline')
  })

  it('uses the platform primary modifier for jump clicks', () => {
    expect(getGitGutterClickIntent(
      { altKey: false, ctrlKey: true, metaKey: false, shiftKey: false },
      { platform: 'Win32' },
    )).toBe('jump')
    expect(getGitGutterClickIntent(
      { altKey: false, ctrlKey: false, metaKey: true, shiftKey: false },
      { platform: 'MacIntel' },
    )).toBe('jump')
  })

  it('ignores non-primary or chorded gutter modifier clicks', () => {
    expect(getGitGutterClickIntent(
      { altKey: false, ctrlKey: false, metaKey: true, shiftKey: false },
      { platform: 'Linux x86_64' },
    )).toBe('ignore')
    expect(getGitGutterClickIntent(
      { altKey: false, ctrlKey: true, metaKey: false, shiftKey: false },
      { platform: 'MacIntel' },
    )).toBe('ignore')
    expect(getGitGutterClickIntent(
      { altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
      { platform: 'Win32' },
    )).toBe('ignore')
  })

  it('recognizes inline split diff targets so outer live gutter hover ignores them', () => {
    class FakeElement {
      constructor(private readonly insideInlineDiff: boolean) {}

      closest(selector: string) {
        return selector === '.meo-live-inline-diff' && this.insideInlineDiff ? this : null
      }
    }

    Object.defineProperty(globalThis, 'Element', {
      configurable: true,
      writable: true,
      value: FakeElement,
    })
    Object.defineProperty(globalThis, 'HTMLElement', {
      configurable: true,
      writable: true,
      value: FakeElement,
    })

    expect(isInsideLiveInlineDiff(new FakeElement(true))).toBe(true)
    expect(isInsideLiveInlineDiff(new FakeElement(false))).toBe(false)
    expect(isInsideLiveInlineDiff(null)).toBe(false)
  })

  it('distinguishes a marker own row from adjacent delete-triangle hit area', () => {
    class FakeElement {
      parent: FakeElement | null = null

      constructor(private readonly rect: { bottom: number, top: number }) {}

      closest(selector: string) {
        if (selector === '.cm-gutterElement') {
          return this.parent ?? this
        }
        if (selector === '.cm-gutter.meo-git-gutter') {
          return this
        }
        return null
      }

      getBoundingClientRect() {
        return {
          bottom: this.rect.bottom,
          height: this.rect.bottom - this.rect.top,
          left: 0,
          right: 3,
          top: this.rect.top,
          width: 3,
          x: 0,
          y: this.rect.top,
          toJSON: () => ({}),
        } as DOMRect
      }
    }

    Object.defineProperty(globalThis, 'Element', {
      configurable: true,
      writable: true,
      value: FakeElement,
    })
    Object.defineProperty(globalThis, 'HTMLElement', {
      configurable: true,
      writable: true,
      value: FakeElement,
    })

    const row = new FakeElement({ bottom: 48, top: 24 })
    const marker = new FakeElement({ bottom: 24, top: 0 })
    marker.parent = row

    expect(gitGutterMarkerOwnsClientY(marker, 30)).toBe(true)
    expect(gitGutterMarkerOwnsClientY(marker, 20)).toBe(false)
  })
})
