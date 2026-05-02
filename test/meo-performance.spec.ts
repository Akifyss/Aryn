import { performance } from 'node:perf_hooks'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ChangeSet, EditorState, Text, Transaction } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { Chunk } from '../src/vendor/codemirror-merge/src/chunk'
import { buildCodeMirrorChunksFromVsCodeDiff } from '../src/vendor/meo/shared/gitDiffLineFlags'
import { textIncludes } from '../src/vendor/meo/webview/helpers/docText'
import { parseFootnotes } from '../src/vendor/meo/webview/helpers/footnotes'
import { getMermaidColonBlocks } from '../src/vendor/meo/webview/helpers/mermaidColonBlocks'
import { parseMergeConflicts } from '../src/vendor/meo/webview/helpers/mergeConflicts'
import {
  collectOrderedListRenumberChanges,
  shouldCollectOrderedListRenumberChanges,
} from '../src/vendor/meo/webview/helpers/listMarkers'
import { applyCodeMirrorChangesToText } from '../src/features/editor/lib/meo-native-diff-split'
import {
  gitDiffGutterBaselineExtensions,
  gitDiffLineFlagsField,
  refreshGitDiffLineFlagsEffect,
  setGitBaselineEffect,
} from '../src/vendor/meo/webview/helpers/gitDiffGutter'
import { liveModeExtensions } from '../src/vendor/meo/webview/liveMode'

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

  it('keeps IME composition input updates off the full live decoration rebuild path', () => {
    let state = EditorState.create({
      doc: createPlainLongDocument(12_000),
      extensions: liveModeExtensions(),
    })

    const startedAt = performance.now()
    state = state.update({
      changes: { from: state.doc.length, insert: '咚' },
      annotations: Transaction.userEvent.of('input.type.compose'),
    }).state

    const durationMs = performance.now() - startedAt
    expect(state.doc.sliceString(state.doc.length - 1)).toBe('咚')
    expect(durationMs).toBeLessThan(100)
  })

  it('keeps split typing updates off the full live decoration rebuild path', () => {
    let state = EditorState.create({
      doc: createPlainLongDocument(12_000),
      extensions: liveModeExtensions({ deferDocChanges: true }),
    })

    const startedAt = performance.now()
    state = state.update({
      changes: { from: state.doc.length, insert: 'x' },
      annotations: Transaction.userEvent.of('input.type'),
    }).state

    const durationMs = performance.now() - startedAt
    expect(state.doc.sliceString(state.doc.length - 1)).toBe('x')
    expect(durationMs).toBeLessThan(100)
  })

  it('keeps split IME composition updates off the git diff line recompute path', () => {
    const documentText = createPlainLongDocument(12_000)
    const baselineText = documentText.replace(
      'plain prose line 6000',
      'plain prose line 6000 before'
    )
    let state = EditorState.create({
      doc: documentText,
      extensions: gitDiffGutterBaselineExtensions(),
    })
    state = state.update({
      effects: setGitBaselineEffect.of({
        available: true,
        baseText: baselineText,
        headOid: 'head',
        indexText: null,
        tracked: true,
      }),
    }).state

    const previousFlags = state.field(gitDiffLineFlagsField)
    expect(previousFlags).not.toBeNull()

    const startedAt = performance.now()
    const composedState = state.update({
      changes: { from: state.doc.length, insert: '咚' },
      annotations: Transaction.userEvent.of('input.type.compose'),
    }).state

    const durationMs = performance.now() - startedAt
    expect(composedState.field(gitDiffLineFlagsField)).toBe(previousFlags)
    expect(durationMs).toBeLessThan(100)

    const refreshedState = composedState.update({
      effects: refreshGitDiffLineFlagsEffect.of(null),
    }).state
    const refreshedFlags = refreshedState.field(gitDiffLineFlagsField)
    expect(refreshedFlags).not.toBe(previousFlags)
    expect(Array.isArray(refreshedFlags)).toBe(true)
    expect(refreshedFlags).toHaveLength(refreshedState.doc.lines)
  })

  it('keeps split typing updates off the git diff line recompute path until refresh', () => {
    const documentText = createPlainLongDocument(12_000)
    const baselineText = documentText.replace(
      'plain prose line 6000',
      'plain prose line 6000 before'
    )
    let state = EditorState.create({
      doc: documentText,
      extensions: gitDiffGutterBaselineExtensions({ deferDocChanges: true }),
    })
    state = state.update({
      effects: setGitBaselineEffect.of({
        available: true,
        baseText: baselineText,
        headOid: 'head',
        indexText: null,
        tracked: true,
      }),
    }).state

    const previousFlags = state.field(gitDiffLineFlagsField)
    expect(previousFlags).not.toBeNull()

    const startedAt = performance.now()
    const editedState = state.update({
      changes: { from: state.doc.length, insert: 'x' },
      annotations: Transaction.userEvent.of('input.type'),
    }).state

    const durationMs = performance.now() - startedAt
    expect(editedState.field(gitDiffLineFlagsField)).toBe(previousFlags)
    expect(durationMs).toBeLessThan(100)

    const refreshedState = editedState.update({
      effects: refreshGitDiffLineFlagsEffect.of(null),
    }).state
    const refreshedFlags = refreshedState.field(gitDiffLineFlagsField)
    expect(refreshedFlags).not.toBe(previousFlags)
    expect(Array.isArray(refreshedFlags)).toBe(true)
    expect(refreshedFlags).toHaveLength(refreshedState.doc.lines)
  })

  it('applies split text snapshots from CodeMirror changes without flattening the document', () => {
    const documentText = createPlainLongDocument(12_000)
    const document = Text.of(documentText.split('\n'))
    const firstLine = document.line(1)
    const middleLine = document.line(6000)
    const changes = ChangeSet.of([
      { from: firstLine.to, insert: ' typed' },
      { from: middleLine.from, to: middleLine.from + 'plain'.length, insert: 'edited' },
      { from: document.length, insert: '\nappendix' },
    ], document.length)
    const originalToString = document.toString
    ;(document as unknown as { toString: () => string }).toString = () => {
      throw new Error('split text snapshot sync should not flatten the CodeMirror document')
    }

    try {
      const nextText = applyCodeMirrorChangesToText(documentText, changes)

      expect(nextText.startsWith('plain prose line 0 typed\n')).toBe(true)
      expect(nextText).toContain('edited prose line 5999')
      expect(nextText.endsWith('\nappendix')).toBe(true)
    } finally {
      ;(document as unknown as { toString: () => string }).toString = originalToString
    }
  })

  it('keeps plain text edits off the full ordered-list renumber scan path', () => {
    const state = EditorState.create({
      doc: [
        '1. first item content',
        '2. second item content',
        '',
        createPlainLongDocument(12_000),
      ].join('\n'),
    })
    const firstLine = state.doc.line(1)
    const transaction = state.update({
      changes: { from: firstLine.to, insert: ' typed' },
      annotations: Transaction.userEvent.of('input.type'),
    })

    expect(shouldCollectOrderedListRenumberChanges(transaction)).toBe(false)
  })

  it('still renumbers ordered lists when their marker structure changes', () => {
    const state = EditorState.create({
      doc: [
        '1. first item',
        '2. second item',
      ].join('\n'),
    })
    const secondLine = state.doc.line(2)
    const transaction = state.update({
      changes: { from: secondLine.from, to: secondLine.from + 1, insert: '9' },
      annotations: Transaction.userEvent.of('input.type'),
    })

    expect(shouldCollectOrderedListRenumberChanges(transaction)).toBe(true)
    expect(collectOrderedListRenumberChanges(transaction.state)).toEqual([
      { from: secondLine.from, to: secondLine.from + 1, insert: '2' },
    ])
  })

  it('keeps split merge typing updates on the local incremental chunk path', () => {
    const originalText = createPlainLongDocument(12_000)
    const modifiedText = originalText.replace(
      'plain prose line 6000',
      'plain prose line 6000 changed'
    )
    const originalDoc = Text.of(originalText.split('\n'))
    const modifiedDoc = Text.of(modifiedText.split('\n'))
    const initialChunks = Chunk.build(originalDoc, modifiedDoc, {
      overrideChunks: buildCodeMirrorChunksFromVsCodeDiff,
      scanLimit: 1000,
      timeout: 200,
    })
    const changes = ChangeSet.of([{ from: modifiedDoc.length, insert: '\ntyping' }], modifiedDoc.length)
    const nextModifiedDoc = changes.apply(modifiedDoc)

    const startedAt = performance.now()
    const nextChunks = Chunk.updateB(initialChunks, originalDoc, nextModifiedDoc, changes, {
      incrementalUpdates: true,
      overrideChunks: () => {
        throw new Error('split typing should not rebuild full VS Code-style chunks')
      },
      scanLimit: 1000,
      timeout: 200,
    })

    const durationMs = performance.now() - startedAt
    expect(initialChunks).toHaveLength(1)
    expect(nextChunks.length).toBeGreaterThan(0)
    expect(durationMs).toBeLessThan(100)
  })

  it('does not flatten whole documents while updating split merge chunks incrementally', () => {
    const originalText = createPlainLongDocument(12_000)
    const modifiedText = originalText.replace(
      'plain prose line 6000',
      'plain prose line 6000 changed'
    )
    const originalDoc = Text.of(originalText.split('\n'))
    const modifiedDoc = Text.of(modifiedText.split('\n'))
    const initialChunks = Chunk.build(originalDoc, modifiedDoc, {
      overrideChunks: buildCodeMirrorChunksFromVsCodeDiff,
      scanLimit: 1000,
      timeout: 200,
    })
    const changes = ChangeSet.of([{ from: modifiedDoc.length, insert: '\ntyping' }], modifiedDoc.length)
    const nextModifiedDoc = changes.apply(modifiedDoc)
    const originalToString = originalDoc.toString
    const nextModifiedToString = nextModifiedDoc.toString
    ;(originalDoc as unknown as { toString: () => string }).toString = () => {
      throw new Error('split typing should not flatten the original document')
    }
    ;(nextModifiedDoc as unknown as { toString: () => string }).toString = () => {
      throw new Error('split typing should not flatten the modified document')
    }

    try {
      const nextChunks = Chunk.updateB(initialChunks, originalDoc, nextModifiedDoc, changes, {
        incrementalUpdates: true,
        overrideChunks: buildCodeMirrorChunksFromVsCodeDiff,
        scanLimit: 1000,
        timeout: 200,
      })

      expect(nextChunks.length).toBeGreaterThan(0)
    } finally {
      ;(originalDoc as unknown as { toString: () => string }).toString = originalToString
      ;(nextModifiedDoc as unknown as { toString: () => string }).toString = nextModifiedToString
    }
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
