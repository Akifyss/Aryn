import { Text } from '@codemirror/state'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeTrailingEofVisualLineHit } from '../src/vendor/meo/webview/helpers/gitBlameHover'

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
})
