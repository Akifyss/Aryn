import { performance } from 'node:perf_hooks'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { textIncludes } from '../src/vendor/meo/webview/helpers/docText'
import { parseFootnotes } from '../src/vendor/meo/webview/helpers/footnotes'
import { getMermaidColonBlocks } from '../src/vendor/meo/webview/helpers/mermaidColonBlocks'
import { parseMergeConflicts } from '../src/vendor/meo/webview/helpers/mergeConflicts'

function createMarkdownState(doc: string) {
  return EditorState.create({
    doc,
    extensions: [
      markdown({
        addKeymap: false,
        base: markdownLanguage,
      }),
    ],
  })
}

function createPlainLongDocument(lineCount: number) {
  return Array.from({ length: lineCount }, (_, index) => `plain prose line ${index}`).join('\n')
}

describe('meo performance guards', () => {
  it('detects text features without flattening the whole CodeMirror document', () => {
    const doc = Text.of(['alpha', 'beta KBD', 'gamma'])

    expect(textIncludes(doc, 'a\nb')).toBe(true)
    expect(textIncludes(doc, 'beta')).toBe(true)
    expect(textIncludes(doc, 'KBD\ngamma')).toBe(true)
    expect(textIncludes(doc, 'delta')).toBe(false)
  })

  it('keeps optional syntax scanners cheap for long plain documents', () => {
    const state = createMarkdownState(createPlainLongDocument(12_000))
    const startedAt = performance.now()

    expect(parseFootnotes(state)).toMatchObject({
      definitions: [],
      references: [],
    })
    expect(getMermaidColonBlocks(state)).toEqual([])
    expect(parseMergeConflicts(state)).toEqual([])

    const durationMs = performance.now() - startedAt
    expect(durationMs).toBeLessThan(500)
  })

  it('still detects guarded features when their trigger tokens are present', () => {
    const state = createMarkdownState([
      'before [^note]',
      '',
      '[^note]: footnote text',
      '',
      '::: mermaid',
      'graph TD',
      ':::',
      '',
      '<<<<<<< ours',
      'local',
      '=======',
      'incoming',
      '>>>>>>> theirs',
    ].join('\n'))

    expect(parseFootnotes(state).definitions).toHaveLength(1)
    expect(parseFootnotes(state).references).toHaveLength(1)
    expect(getMermaidColonBlocks(state)).toHaveLength(1)
    expect(parseMergeConflicts(state)).toHaveLength(1)
  })
})
