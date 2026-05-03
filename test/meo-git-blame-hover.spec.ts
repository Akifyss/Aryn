import { Text } from '@codemirror/state'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getGitGutterClickIntent,
  normalizeTrailingEofVisualLineHit,
} from '../src/vendor/meo/webview/helpers/gitBlameHover'

const originalHTMLElement = globalThis.HTMLElement

afterEach(() => {
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
})
