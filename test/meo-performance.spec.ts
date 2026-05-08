import { performance } from 'node:perf_hooks'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
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
  handleBackspaceAtListContentStart,
  handleEnterContinueList,
  indentListByTwoSpaces,
  outdentListByTwoSpaces,
  shouldCollectOrderedListRenumberChanges,
} from '../src/vendor/meo/webview/helpers/listMarkers'
import {
  __meoDiffSplitRenderHealthTestHooks,
  __meoDiffSplitSearchTestHooks,
  applyCodeMirrorChangesToText,
  buildDiffSplitGutterFlagsFromChunks,
  shouldDeferSplitMergeChunkUpdate,
  shouldRefreshSplitInlineChangeLayerAfterLiveMarkerLayoutChange,
  shouldRefreshSplitLiveDecorationsAfterTaskMarkerChange,
} from '../src/features/editor/lib/meo-native-diff-split'
import {
  __gitDiffGutterTestHooks,
  gitDiffGutterBaselineExtensions,
  gitDiffLineFlagsField,
  refreshGitDiffLineFlagsEffect,
  setGitBaselineEffect,
} from '../src/vendor/meo/webview/helpers/gitDiffGutter'
import {
  liveModeExtensions,
  shouldRefreshLiveMarkerLayoutForTransaction,
  shouldRefreshLiveDecorationsForTransaction,
  shouldRefreshLiveDecorationsForViewportChange,
} from '../src/vendor/meo/webview/liveMode'

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

function createLongMarkdownDocument(lineCount: number) {
  return Array.from({ length: lineCount }, (_, index) => (
    index % 5 === 0
      ? `## Heading ${index}`
      : `Paragraph ${index} with **strong** text and [link](https://example.com/${index}).`
  )).join('\n')
}

function dispatchCommandSpec(state: EditorState, command: (view: any) => boolean) {
  let dispatchedSpec: any = null
  const handled = command({
    dispatch: (spec: any) => {
      dispatchedSpec = spec
    },
    state,
  })

  expect(handled).toBe(true)
  expect(dispatchedSpec).not.toBeNull()
  return state.update(dispatchedSpec)
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

    const transaction = state.update({
      changes: { from: state.doc.length, insert: '咚' },
      annotations: Transaction.userEvent.of('input.type.compose'),
    })
    state = transaction.state

    expect(state.doc.sliceString(state.doc.length - 1)).toBe('咚')
    expect(shouldRefreshLiveDecorationsForTransaction(transaction)).toBe(false)
    expect(shouldRefreshLiveMarkerLayoutForTransaction(transaction)).toBe(false)
  })

  it('keeps split typing updates off the full live decoration rebuild path', () => {
    let state = EditorState.create({
      doc: createPlainLongDocument(12_000),
      extensions: liveModeExtensions({ deferDocChanges: true }),
    })

    const transaction = state.update({
      changes: { from: state.doc.length, insert: 'x' },
      annotations: Transaction.userEvent.of('input.type'),
    })
    state = transaction.state

    expect(state.doc.sliceString(state.doc.length - 1)).toBe('x')
    expect(shouldRefreshLiveDecorationsForTransaction(transaction)).toBe(false)
    expect(shouldRefreshLiveMarkerLayoutForTransaction(transaction)).toBe(false)
  })

  it('refreshes live decorations when background parsing advances without a document change', () => {
    const state = createMarkdownState(createLongMarkdownDocument(5_000))

    expect(ensureSyntaxTree(state, state.doc.length, 1000)).not.toBeNull()

    const parseRefreshTransaction = state.update({})
    expect(parseRefreshTransaction.docChanged).toBe(false)
    expect(parseRefreshTransaction.startState.selection.eq(parseRefreshTransaction.state.selection)).toBe(true)
    expect(shouldRefreshLiveDecorationsForTransaction(parseRefreshTransaction)).toBe(true)
  })

  it('refreshes live decorations when scrolling exposes an unparsed markdown viewport', () => {
    const state = createMarkdownState(createLongMarkdownDocument(5_000))
    const update = {
      docChanged: false,
      view: {
        state,
        viewport: { from: Math.max(0, state.doc.length - 500), to: state.doc.length },
        visibleRanges: [{ from: Math.max(0, state.doc.length - 500), to: state.doc.length }],
      },
      viewportChanged: true,
      viewportMoved: true,
    }

    expect(shouldRefreshLiveDecorationsForViewportChange(update)).toBe(true)
    expect(shouldRefreshLiveDecorationsForViewportChange({
      ...update,
      docChanged: true,
    })).toBe(false)
    expect(shouldRefreshLiveDecorationsForViewportChange({
      ...update,
      viewportChanged: false,
      viewportMoved: false,
    })).toBe(false)

    expect(ensureSyntaxTree(state, state.doc.length, 1000)).not.toBeNull()
    const syncedState = state.update({}).state
    const parsedUpdate = {
      ...update,
      view: {
        ...update.view,
        state: syncedState,
      },
    }

    expect(shouldRefreshLiveDecorationsForViewportChange(parsedUpdate)).toBe(false)
  })

  it('refreshes live decorations when viewport parsing already advanced before decoration rebuild', () => {
    const state = createMarkdownState(createLongMarkdownDocument(5_000))
    const staleDecoratedTree = ensureSyntaxTree(state, 1_000, 1000)
    expect(staleDecoratedTree).not.toBeNull()

    expect(ensureSyntaxTree(state, state.doc.length, 1000)).not.toBeNull()
    const syncedState = state.update({}).state
    const update = {
      docChanged: false,
      view: {
        state: syncedState,
        viewport: { from: Math.max(0, syncedState.doc.length - 500), to: syncedState.doc.length },
        visibleRanges: [{ from: Math.max(0, syncedState.doc.length - 500), to: syncedState.doc.length }],
      },
      viewportChanged: true,
      viewportMoved: true,
    }

    expect(shouldRefreshLiveDecorationsForViewportChange(update, staleDecoratedTree)).toBe(true)
    expect(shouldRefreshLiveDecorationsForViewportChange(update, ensureSyntaxTree(syncedState, syncedState.doc.length, 1000))).toBe(false)
  })

  it('keeps split search highlights off the full document scan path during live typing and IME composition', () => {
    let state = EditorState.create({
      doc: createPlainLongDocument(12_000),
      extensions: [
        __meoDiffSplitSearchTestHooks.searchQueryField,
        __meoDiffSplitSearchTestHooks.searchMatchField,
      ],
    })
    state = state.update({
      effects: __meoDiffSplitSearchTestHooks.setSearchQueryEffect.of(
        __meoDiffSplitSearchTestHooks.createSearchQueryState('plain'),
      ),
    }).state

    const docPrototype = Object.getPrototypeOf(state.doc) as { toString: () => string }
    const originalToString = docPrototype.toString
    docPrototype.toString = () => {
      throw new Error('split search highlight input path should not flatten the CodeMirror document')
    }

    try {
      state = state.update({
        changes: { from: state.doc.length, insert: 'x' },
        annotations: Transaction.userEvent.of('input.type'),
      }).state

      expect(state.doc.sliceString(state.doc.length - 1)).toBe('x')

      state = state.update({
        changes: { from: state.doc.length, insert: 'ime' },
        annotations: Transaction.userEvent.of('input.type.compose'),
      }).state

      expect(state.doc.sliceString(state.doc.length - 3)).toBe('ime')
    } finally {
      docPrototype.toString = originalToString
    }
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

    const composedState = state.update({
      changes: { from: state.doc.length, insert: '咚' },
      annotations: Transaction.userEvent.of('input.type.compose'),
    }).state

    expect(composedState.field(gitDiffLineFlagsField)).toBe(previousFlags)

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

    const editedState = state.update({
      changes: { from: state.doc.length, insert: 'x' },
      annotations: Transaction.userEvent.of('input.type'),
    }).state

    expect(editedState.field(gitDiffLineFlagsField)).toBe(previousFlags)

    const refreshedState = editedState.update({
      effects: refreshGitDiffLineFlagsEffect.of(null),
    }).state
    const refreshedFlags = refreshedState.field(gitDiffLineFlagsField)
    expect(refreshedFlags).not.toBe(previousFlags)
    expect(Array.isArray(refreshedFlags)).toBe(true)
    expect(refreshedFlags).toHaveLength(refreshedState.doc.lines)
  })

  it('keeps split baseline echo updates off the git diff line recompute path until chunk refresh', () => {
    const documentText = createPlainLongDocument(12_000)
    const initialBaselineText = documentText.replace(
      'plain prose line 6000',
      'plain prose line 6000 before'
    )
    const nextBaselineText = documentText.replace(
      'plain prose line 7000',
      'plain prose line 7000 before'
    )
    let state = EditorState.create({
      doc: documentText,
      extensions: gitDiffGutterBaselineExtensions({ deferDocChanges: true }),
    })
    state = state.update({
      effects: setGitBaselineEffect.of({
        available: true,
        baseText: initialBaselineText,
        headOid: 'head',
        indexText: null,
        tracked: true,
      }),
    }).state

    const previousFlags = state.field(gitDiffLineFlagsField)
    expect(previousFlags).not.toBeNull()

    const deferredBaselineState = state.update({
      effects: [
        setGitBaselineEffect.of({
          available: true,
          baseText: nextBaselineText,
          headOid: 'head',
          indexText: null,
          tracked: true,
        }),
        __gitDiffGutterTestHooks.deferGitDiffLineFlagsRefreshEffect.of(null),
      ],
    }).state

    expect(deferredBaselineState.field(gitDiffLineFlagsField)).toBe(previousFlags)

    const refreshedState = deferredBaselineState.update({
      effects: refreshGitDiffLineFlagsEffect.of(null),
    }).state
    const refreshedFlags = refreshedState.field(gitDiffLineFlagsField)
    expect(refreshedFlags).not.toBe(previousFlags)
    expect(Array.isArray(refreshedFlags)).toBe(true)
    expect(refreshedFlags).toHaveLength(refreshedState.doc.lines)
  })

  it('defers split merge chunk refresh for live typing and IME composition', () => {
    const state = EditorState.create({ doc: createPlainLongDocument(12_000) })
    const typing = state.update({
      changes: { from: state.doc.length, insert: 'x' },
      annotations: Transaction.userEvent.of('input.type'),
    })
    const composing = state.update({
      changes: { from: state.doc.length, insert: 'ime' },
      annotations: Transaction.userEvent.of('input.type.compose'),
    })
    const deletion = state.update({
      changes: { from: state.doc.length - 1, to: state.doc.length },
      annotations: Transaction.userEvent.of('delete.backward'),
    })
    const undo = state.update({
      changes: { from: state.doc.length, insert: 'x' },
      annotations: Transaction.userEvent.of('undo'),
    })
    const structural = state.update({
      changes: { from: 0, insert: '# ' },
    })
    const generatedTyping = state.update({
      changes: { from: state.doc.length, insert: ' generated' },
      annotations: [
        Transaction.addToHistory.of(false),
        Transaction.userEvent.of('input.type'),
      ],
    })

    expect(shouldDeferSplitMergeChunkUpdate([typing], 'b')).toBe(true)
    expect(shouldDeferSplitMergeChunkUpdate([composing], 'b')).toBe(true)
    expect(shouldDeferSplitMergeChunkUpdate([deletion], 'b')).toBe(true)
    expect(shouldDeferSplitMergeChunkUpdate([generatedTyping], 'b')).toBe(true)
    expect(shouldDeferSplitMergeChunkUpdate([typing], 'a')).toBe(false)
    expect(shouldDeferSplitMergeChunkUpdate([undo], 'b')).toBe(false)
    expect(shouldDeferSplitMergeChunkUpdate([typing, structural], 'b')).toBe(false)
  })

  it('marks list helper edits as live input for split chunk deferral', () => {
    const indentTransaction = dispatchCommandSpec(
      EditorState.create({ doc: '- item' }),
      indentListByTwoSpaces,
    )
    const outdentTransaction = dispatchCommandSpec(
      EditorState.create({ doc: '  - item' }),
      outdentListByTwoSpaces,
    )
    const backspaceTransaction = dispatchCommandSpec(
      EditorState.create({ doc: '- item', selection: { anchor: 2 } }),
      handleBackspaceAtListContentStart,
    )
    const enterTransaction = dispatchCommandSpec(
      EditorState.create({ doc: '1. item', selection: { anchor: '1. item'.length } }),
      handleEnterContinueList,
    )

    expect(indentTransaction.annotation(Transaction.userEvent)).toBe('input.indent')
    expect(outdentTransaction.annotation(Transaction.userEvent)).toBe('input.indent')
    expect(backspaceTransaction.annotation(Transaction.userEvent)).toBe('delete.backward')
    expect(enterTransaction.annotation(Transaction.userEvent)).toBe('input.type')
    expect(shouldDeferSplitMergeChunkUpdate([indentTransaction], 'b')).toBe(true)
    expect(shouldDeferSplitMergeChunkUpdate([outdentTransaction], 'b')).toBe(true)
    expect(shouldDeferSplitMergeChunkUpdate([backspaceTransaction], 'b')).toBe(true)
    expect(shouldDeferSplitMergeChunkUpdate([enterTransaction], 'b')).toBe(true)
  })

  it('refreshes split live decorations when a task marker status changes', () => {
    const taskState = EditorState.create({ doc: '- [ ] todo item' })
    const checkedTransaction = taskState.update({
      changes: { from: 3, to: 4, insert: 'x' },
      annotations: Transaction.userEvent.of('input.type'),
    })
    const contentTransaction = taskState.update({
      changes: { from: taskState.doc.length, insert: ' typed' },
      annotations: Transaction.userEvent.of('input.type'),
    })
    const plainTransaction = EditorState.create({ doc: 'plain text' }).update({
      changes: { from: 'plain'.length, insert: ' typed' },
      annotations: Transaction.userEvent.of('input.type'),
    })

    expect(shouldRefreshSplitLiveDecorationsAfterTaskMarkerChange(checkedTransaction)).toBe(true)
    expect(shouldRefreshSplitLiveDecorationsAfterTaskMarkerChange(contentTransaction)).toBe(false)
    expect(shouldRefreshSplitLiveDecorationsAfterTaskMarkerChange(plainTransaction)).toBe(false)
  })

  it('refreshes split inline change overlay when live marker layout can change', () => {
    const state = createMarkdownState(createLongMarkdownDocument(5_000))
    const selectionTransaction = state.update({
      selection: { anchor: '## Heading'.length },
    })
    const contentTransaction = state.update({
      changes: { from: state.doc.length, insert: ' typed' },
      annotations: Transaction.userEvent.of('input.type'),
    })
    expect(ensureSyntaxTree(state, state.doc.length, 1000)).not.toBeNull()
    const parseRefreshTransaction = state.update({})
    const noOpTransaction = parseRefreshTransaction.state.update({})

    expect(shouldRefreshSplitInlineChangeLayerAfterLiveMarkerLayoutChange(selectionTransaction)).toBe(true)
    expect(shouldRefreshSplitInlineChangeLayerAfterLiveMarkerLayoutChange(contentTransaction)).toBe(false)
    expect(shouldRefreshSplitInlineChangeLayerAfterLiveMarkerLayoutChange(parseRefreshTransaction)).toBe(true)
    expect(shouldRefreshSplitInlineChangeLayerAfterLiveMarkerLayoutChange(noOpTransaction)).toBe(false)
  })

  it('detects visible split markdown lines that are still in raw source form', () => {
    const createLine = (className: string, textContent: string) => ({
      classList: {
        contains: (name: string) => className.split(/\s+/).includes(name),
      },
      textContent,
    }) as HTMLElement

    const headingLine = createLine('cm-line', '## Raw heading')
    const renderedHeadingLine = createLine('cm-line meo-md-h2', '## Rendered heading')
    const listLine = createLine('cm-line', '- raw item')
    const renderedListLine = createLine('cm-line meo-md-list-line', '- rendered item')

    expect(__meoDiffSplitRenderHealthTestHooks.markdownLineLooksUnrendered(headingLine)).toBe(true)
    expect(__meoDiffSplitRenderHealthTestHooks.markdownLineLooksUnrendered(renderedHeadingLine)).toBe(false)
    expect(__meoDiffSplitRenderHealthTestHooks.markdownLineLooksUnrendered(listLine)).toBe(true)
    expect(__meoDiffSplitRenderHealthTestHooks.markdownLineLooksUnrendered(renderedListLine)).toBe(false)
  })

  it('uses one split render refresh bundle for markdown, chunk lines, and inline text overlays', () => {
    const effects = __meoDiffSplitRenderHealthTestHooks.splitRenderRefreshEffects()
    const state = EditorState.create({ doc: 'one' })
    const transaction = state.update({ effects })

    expect(effects).toHaveLength(4)
    expect(shouldRefreshLiveDecorationsForTransaction(transaction)).toBe(true)
  })

  it('keeps split render health recovery off live typing, deletion, and IME transactions', () => {
    const state = EditorState.create({ doc: 'abc' })
    const typing = state.update({
      changes: { from: state.doc.length, insert: 'x' },
      annotations: Transaction.userEvent.of('input.type'),
    })
    const deletion = state.update({
      changes: { from: 1, to: 2 },
      annotations: Transaction.userEvent.of('delete.backward'),
    })
    const composing = state.update({
      changes: { from: state.doc.length, insert: '咚' },
      annotations: Transaction.userEvent.of('input.type.compose'),
    })

    expect(__meoDiffSplitRenderHealthTestHooks.shouldSkipSplitRenderHealthForTransactions([typing])).toBe(true)
    expect(__meoDiffSplitRenderHealthTestHooks.shouldSkipSplitRenderHealthForTransactions([deletion])).toBe(true)
    expect(__meoDiffSplitRenderHealthTestHooks.shouldSkipSplitRenderHealthForTransactions([composing])).toBe(true)
    expect(__meoDiffSplitRenderHealthTestHooks.shouldSkipSplitRenderHealthForTransactions([state.update({})])).toBe(false)
  })

  it('builds split diff fallback line decorations from rendered gutter flags', () => {
    let state = EditorState.create({
      doc: ['one', 'two', 'three'].join('\n'),
      extensions: gitDiffGutterBaselineExtensions(),
    })
    state = state.update({
      effects: __gitDiffGutterTestHooks.setGitDiffLineFlagsEffect.of([
        undefined,
        { added: false, deleted: false, modified: false, removed: true, scope: 'unstaged' },
        undefined,
      ]),
    }).state

    const decorations = __meoDiffSplitRenderHealthTestHooks.buildSplitDiffFallbackDecorations(state)
    const ranges: Array<{ from: number, classes: string }> = []
    decorations.between(0, state.doc.length, (from: number, _to: number, value: any) => {
      ranges.push({ from, classes: value.spec?.class ?? '' })
    })

    expect(ranges).toEqual([
      { from: state.doc.line(2).from, classes: 'cm-changedLine' },
    ])
  })

  it('keeps split diff fallback text decorations out of the default render path', () => {
    const originalDoc = Text.of(['one', 'two', 'three'])
    const modifiedDoc = Text.of(['one', 'TWO', 'three'])
    const chunks = Chunk.build(originalDoc, modifiedDoc, {
      overrideChunks: buildCodeMirrorChunksFromVsCodeDiff,
      scanLimit: 1000,
      timeout: 200,
    })
    const [chunk] = chunks
    const collectClasses = (
      doc: Text,
      side: 'a' | 'b',
      flags: readonly ({ added: boolean, deleted: boolean, modified: boolean, removed?: boolean, scope: 'unstaged' } | undefined)[],
    ) => {
      const decorations = __meoDiffSplitRenderHealthTestHooks.buildSplitDiffFallbackDecorationsFromInputs(
        doc,
        flags,
        [chunk],
        side,
      )
      const ranges: Array<{ from: number, to: number, classes: string }> = []
      decorations.between(0, doc.length, (from: number, to: number, value: any) => {
        ranges.push({ from, to, classes: value.spec?.class ?? '' })
      })
      return ranges
    }

    const originalRanges = collectClasses(originalDoc, 'a', [
      undefined,
      { added: false, deleted: false, modified: false, removed: true, scope: 'unstaged' },
      undefined,
    ])
    const modifiedRanges = collectClasses(modifiedDoc, 'b', [
      undefined,
      { added: true, deleted: false, modified: false, removed: false, scope: 'unstaged' },
      undefined,
    ])

    expect(originalRanges).toEqual(expect.arrayContaining([
      { from: originalDoc.line(2).from, to: originalDoc.line(2).from, classes: 'cm-changedLine' },
      { from: originalDoc.line(2).from, to: originalDoc.line(3).from, classes: 'cm-deletedLine' },
    ]))
    expect(originalRanges.some((range) => range.classes.includes('cm-changedText'))).toBe(false)
    expect(modifiedRanges).toEqual(expect.arrayContaining([
      { from: modifiedDoc.line(2).from, to: modifiedDoc.line(2).from, classes: 'cm-changedLine' },
      { from: modifiedDoc.line(2).from, to: modifiedDoc.line(3).from, classes: 'cm-insertedLine' },
    ]))
    expect(modifiedRanges.some((range) => range.classes.includes('cm-changedText'))).toBe(false)
  })

  it('uses full-line fallback backgrounds for single-sided ranges inside replacement chunks', () => {
    const originalDoc = Text.of(['same', 'shared original', 'tail'])
    const modifiedDoc = Text.of(['same', 'inserted standalone', 'shared modified', 'tail', 'same'])
    const [chunk] = Chunk.build(originalDoc, modifiedDoc, {
      overrideChunks: buildCodeMirrorChunksFromVsCodeDiff,
      scanLimit: 1000,
      timeout: 200,
    })
    const collectClasses = (doc: Text, side: 'a' | 'b') => {
      const decorations = __meoDiffSplitRenderHealthTestHooks.buildSplitDiffFallbackDecorationsFromInputs(
        doc,
        [
          ...(side === 'a'
            ? [
              undefined,
              { added: false, deleted: false, modified: false, removed: true, scope: 'unstaged' } as const,
              undefined,
            ]
            : [
              undefined,
              { added: true, deleted: false, modified: true, removed: false, scope: 'unstaged' } as const,
              { added: true, deleted: false, modified: true, removed: false, scope: 'unstaged' } as const,
              undefined,
              { added: true, deleted: false, modified: true, removed: false, scope: 'unstaged' } as const,
            ]),
        ],
        [chunk],
        side,
        true,
      )
      const ranges: Array<{ from: number, to: number, classes: string }> = []
      decorations.between(0, doc.length, (from: number, to: number, value: any) => {
        ranges.push({ from, to, classes: value.spec?.class ?? '' })
      })
      return ranges
    }

    const originalRanges = collectClasses(originalDoc, 'a')
    const modifiedRanges = collectClasses(modifiedDoc, 'b')

    expect(originalRanges.some((range) => range.classes.includes('cm-deletedLineFull'))).toBe(false)
    expect(modifiedRanges.some((range) => range.classes.includes('cm-insertedLineFull'))).toBe(false)
    expect(originalRanges.some((range) => range.classes.includes('meo-diff-split-fallback-changedText'))).toBe(true)
    expect(modifiedRanges).toEqual(expect.arrayContaining([
      { from: modifiedDoc.line(2).from, to: modifiedDoc.line(2).from, classes: 'cm-changedLine' },
      {
        from: modifiedDoc.line(2).from,
        to: modifiedDoc.line(2).to,
        classes: 'cm-changedText cm-changedTextFullLine meo-diff-split-fallback-changedText',
      },
    ]))
  })

  it('treats non-empty full-line changes as text render health requirements', () => {
    const originalDoc = Text.of(['same', 'shared original', 'tail'])
    const modifiedDoc = Text.of(['same', 'inserted standalone', 'shared modified', 'tail', 'same'])
    const [chunk] = Chunk.build(originalDoc, modifiedDoc, {
      overrideChunks: buildCodeMirrorChunksFromVsCodeDiff,
      scanLimit: 1000,
      timeout: 200,
    })

    expect(__meoDiffSplitRenderHealthTestHooks.chunkHasInlineChangeOnLine(
      chunk,
      modifiedDoc.line(2),
      'b',
    )).toBe(true)
    expect(__meoDiffSplitRenderHealthTestHooks.chunkHasInlineChangeOnLine(
      chunk,
      Text.of(['same', '', 'shared modified', 'tail']).line(2),
      'b',
    )).toBe(false)
  })

  it('can make split diff fallback text decorations visible after render health retries fail', () => {
    const originalDoc = Text.of(['one', 'two', 'three'])
    const modifiedDoc = Text.of(['one', 'TWO', 'three'])
    const [chunk] = Chunk.build(originalDoc, modifiedDoc, {
      overrideChunks: buildCodeMirrorChunksFromVsCodeDiff,
      scanLimit: 1000,
      timeout: 200,
    })
    const decorations = __meoDiffSplitRenderHealthTestHooks.buildSplitDiffFallbackDecorationsFromInputs(
      originalDoc,
      [
        undefined,
        { added: false, deleted: false, modified: false, removed: true, scope: 'unstaged' },
        undefined,
      ],
      [chunk],
      'a',
      true,
    )
    const ranges: Array<{ from: number, to: number, classes: string }> = []
    decorations.between(0, originalDoc.length, (from: number, to: number, value: any) => {
      ranges.push({ from, to, classes: value.spec?.class ?? '' })
    })

    expect(ranges).toEqual(expect.arrayContaining([
      { from: originalDoc.line(2).from, to: originalDoc.line(2).to, classes: 'cm-changedText meo-diff-split-fallback-changedText' },
    ]))
  })

  it('keeps split merge deletion chunks bounded to the edited line on the incremental path', () => {
    const originalDoc = Text.of([
      '# Notes',
      'Markdown supports LaTeX formulas.',
      '',
      '## Inline formula',
      'Use one dollar pair, for example: E = mc^2.',
    ])
    const modifiedDoc = Text.of([
      '# Notes',
      'Markdown supports LaTeX formulas. skyrim typing typing typing',
      '',
      '## Inline formula',
      'Use one dollar pair, for example: E = mc^2.',
    ])
    const initialChunks = Chunk.build(originalDoc, modifiedDoc, {
      overrideChunks: buildCodeMirrorChunksFromVsCodeDiff,
      scanLimit: 1000,
      timeout: 200,
    })
    const changedLine = modifiedDoc.line(2)
    const changes = ChangeSet.of([{
      from: changedLine.to - ' typing'.length,
      to: changedLine.to,
    }], modifiedDoc.length)
    const nextModifiedDoc = changes.apply(modifiedDoc)

    const nextChunks = Chunk.updateB(initialChunks, originalDoc, nextModifiedDoc, changes, {
      incrementalUpdates: true,
      overrideChunks: () => {
        throw new Error('split deletion should stay on the local incremental chunk path')
      },
      scanLimit: 1000,
      timeout: 200,
    })
    const nextChangedLine = nextModifiedDoc.line(2)
    const unrelatedHeading = nextModifiedDoc.line(4)

    expect(nextChunks.some(chunk => chunk.fromB <= nextChangedLine.from && chunk.toB > nextChangedLine.from)).toBe(true)
    expect(nextChunks.some(chunk => chunk.fromB <= unrelatedHeading.from && chunk.toB > unrelatedHeading.from)).toBe(false)
  })

  it('derives split gutter flags from existing merge chunks', () => {
    const originalDoc = Text.of(['one', 'two', 'three', 'four'])
    const modifiedDoc = Text.of(['one', 'TWO', 'three', 'four', 'five'])
    const chunks = Chunk.build(originalDoc, modifiedDoc, {
      overrideChunks: buildCodeMirrorChunksFromVsCodeDiff,
      scanLimit: 1000,
      timeout: 200,
    })

    const originalFlags = buildDiffSplitGutterFlagsFromChunks(originalDoc, modifiedDoc, chunks, 'original')
    const modifiedFlags = buildDiffSplitGutterFlagsFromChunks(originalDoc, modifiedDoc, chunks, 'modified')

    expect(originalFlags).toHaveLength(originalDoc.lines)
    expect(modifiedFlags).toHaveLength(modifiedDoc.lines)
    expect(originalFlags[1]).toMatchObject({
      added: false,
      modified: false,
      removed: true,
      scope: 'unstaged',
    })
    expect(modifiedFlags[1]).toMatchObject({
      added: true,
      modified: false,
      removed: false,
      scope: 'unstaged',
    })
    expect(modifiedFlags[4]).toMatchObject({
      added: true,
      scope: 'unstaged',
    })

    const deletionDoc = Text.of(['one', 'three', 'four'])
    const deletionChunks = Chunk.build(originalDoc, deletionDoc, {
      overrideChunks: buildCodeMirrorChunksFromVsCodeDiff,
      scanLimit: 1000,
      timeout: 200,
    })
    const deletionOriginalFlags = buildDiffSplitGutterFlagsFromChunks(originalDoc, deletionDoc, deletionChunks, 'original')
    const deletionModifiedFlags = buildDiffSplitGutterFlagsFromChunks(originalDoc, deletionDoc, deletionChunks, 'modified')

    expect(deletionOriginalFlags[1]).toMatchObject({
      removed: true,
      scope: 'unstaged',
    })
    expect(deletionModifiedFlags.some(Boolean)).toBe(false)
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

    const nextChunks = Chunk.updateB(initialChunks, originalDoc, nextModifiedDoc, changes, {
      incrementalUpdates: true,
      overrideChunks: () => {
        throw new Error('split typing should not rebuild full VS Code-style chunks')
      },
      scanLimit: 1000,
      timeout: 200,
    })

    expect(initialChunks).toHaveLength(1)
    expect(nextChunks.length).toBeGreaterThan(0)
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
