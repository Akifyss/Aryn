import { describe, expect, it } from 'vitest'
import { createVisualDiffSelections } from '../src/features/editor/lib/git-diff-navigation'
import { __meoDiffSplitTextSyncTestHooks, createTextDocFromContent } from '../src/features/editor/lib/meo-native-diff-split'
import { __meoEditorTextSyncTestHooks } from '../src/vendor/meo/webview/editor'
import { buildCodeMirrorChunksFromVsCodeDiff } from '../src/vendor/meo/shared/gitDiffLineFlags'

describe('meo CodeMirror text sync', () => {
  it('treats CRLF-only external updates as unchanged editor text', () => {
    const currentDocumentText = 'alpha\nbeta\ngamma'
    const incomingFileText = 'alpha\r\nbeta\r\ngamma'
    const incomingDocumentText = __meoEditorTextSyncTestHooks.normalizeEditorText(incomingFileText)

    expect(incomingDocumentText).toBe(currentDocumentText)
    expect(__meoEditorTextSyncTestHooks.findSyncChange(currentDocumentText, incomingDocumentText)).toBeNull()
  })

  it('maps selections against the normalized next document length', () => {
    const currentDocumentText = 'alpha\nbeta\ngamma'
    const incomingFileText = 'alpha\r\nbeta changed\r\ngamma'
    const nextDocumentText = __meoEditorTextSyncTestHooks.normalizeEditorText(incomingFileText)
    const syncChange = __meoEditorTextSyncTestHooks.findSyncChange(currentDocumentText, nextDocumentText)

    expect(syncChange).not.toBeNull()
    expect(syncChange?.insert).not.toContain('\r')
    expect(incomingFileText.length).toBeGreaterThan(nextDocumentText.length)

    const mappedPosition = __meoEditorTextSyncTestHooks.clampDocumentPosition(
      __meoEditorTextSyncTestHooks.mapPositionThroughChange(currentDocumentText.length, syncChange!),
      nextDocumentText.length,
    )

    expect(mappedPosition).toBe(nextDocumentText.length)
  })

  it('uses the same normalized document boundary for diff-split sync', () => {
    const currentDocumentText = 'one\ntwo\nthree'
    const incomingFileText = 'one\r\ntwo plus\r\nthree'
    const nextDocumentText = __meoDiffSplitTextSyncTestHooks.normalizeCodeMirrorText(incomingFileText)
    const syncChange = __meoDiffSplitTextSyncTestHooks.findSyncChange(currentDocumentText, nextDocumentText)

    expect(syncChange).not.toBeNull()
    expect(syncChange?.insert).not.toContain('\r')
    expect(incomingFileText.length).toBeGreaterThan(nextDocumentText.length)

    const mappedPosition = Math.min(
      Math.max(0, __meoDiffSplitTextSyncTestHooks.mapPositionThroughChange(currentDocumentText.length, syncChange!)),
      nextDocumentText.length,
    )

    expect(mappedPosition).toBe(nextDocumentText.length)
  })

  it('builds diff documents from the same normalized text model as CodeMirror', () => {
    const document = createTextDocFromContent('one\r\ntwo\r\nthree')

    expect(document.toString()).toBe('one\ntwo\nthree')
    expect(document.length).toBe('one\ntwo\nthree'.length)
    expect(document.line(2).text).toBe('two')
  })

  it('does not treat line-ending-only changes as diff hunks', () => {
    const originalDoc = createTextDocFromContent('one\r\ntwo\r\nthree')
    const modifiedDoc = createTextDocFromContent('one\ntwo\nthree')

    expect(buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc)).toEqual([])
  })

  it('uses normalized documents for visual diff selections', () => {
    expect(createVisualDiffSelections('one\r\ntwo\r\nthree', 'one\ntwo\nthree')).toEqual([])
  })
})
