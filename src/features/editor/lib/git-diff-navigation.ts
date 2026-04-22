import { Text } from '@codemirror/state'
import type { GitDiffSelection } from '@/features/git/types'
import {
  buildCodeMirrorChunksFromVsCodeDiff,
  getVsCodeStyleChangeLineRange,
} from '@/vendor/meo/shared/gitDiffLineFlags'

export type CodeMirrorDiffChunk = {
  fromA: number
  toA: number
  fromB: number
  toB: number
  endA: number
  endB: number
  vscodeModifiedEndLineExclusive?: number
  vscodeModifiedStartLine?: number
  vscodeOriginalEndLineExclusive?: number
  vscodeOriginalStartLine?: number
  changes: readonly {
    fromA: number
    toA: number
    fromB: number
    toB: number
  }[]
}

export function createSelectionFromCodeMirrorChunk(
  originalDoc: Text,
  modifiedDoc: Text,
  chunk: CodeMirrorDiffChunk,
): GitDiffSelection {
  if (originalDoc.length === 0 && modifiedDoc.length > 0) {
    return {
      modifiedLineCount: modifiedDoc.lines,
      modifiedStartLine: 1,
      originalLineCount: 0,
      originalStartLine: 0,
    }
  }

  const vscodeOriginalStartLine = chunk.vscodeOriginalStartLine
  const vscodeOriginalEndLineExclusive = chunk.vscodeOriginalEndLineExclusive
  const vscodeModifiedStartLine = chunk.vscodeModifiedStartLine
  const vscodeModifiedEndLineExclusive = chunk.vscodeModifiedEndLineExclusive

  if (
    typeof vscodeOriginalStartLine === 'number'
    && typeof vscodeOriginalEndLineExclusive === 'number'
    && typeof vscodeModifiedStartLine === 'number'
    && typeof vscodeModifiedEndLineExclusive === 'number'
    && Number.isInteger(vscodeOriginalStartLine)
    && Number.isInteger(vscodeOriginalEndLineExclusive)
    && Number.isInteger(vscodeModifiedStartLine)
    && Number.isInteger(vscodeModifiedEndLineExclusive)
  ) {
    const originalStartLine = Math.max(1, vscodeOriginalStartLine)
    const originalEndLineExclusive = Math.max(originalStartLine, vscodeOriginalEndLineExclusive)
    const modifiedStartLine = Math.max(1, vscodeModifiedStartLine)
    const modifiedEndLineExclusive = Math.max(modifiedStartLine, vscodeModifiedEndLineExclusive)
    const originalLineCount = Math.max(0, originalEndLineExclusive - originalStartLine)
    const modifiedLineCount = Math.max(0, modifiedEndLineExclusive - modifiedStartLine)

    return {
      modifiedLineCount,
      modifiedStartLine: modifiedLineCount === 0 ? Math.max(0, modifiedStartLine - 1) : modifiedStartLine,
      originalLineCount,
      originalStartLine: originalLineCount === 0 ? Math.max(0, originalStartLine - 1) : originalStartLine,
    }
  }

  let originalStartLine = Number.POSITIVE_INFINITY
  let originalEndLineExclusive = 0
  let modifiedStartLine = Number.POSITIVE_INFINITY
  let modifiedEndLineExclusive = 0

  for (const change of chunk.changes) {
    const range = getVsCodeStyleChangeLineRange(originalDoc, modifiedDoc, {
      fromA: chunk.fromA + change.fromA,
      toA: chunk.fromA + change.toA,
      fromB: chunk.fromB + change.fromB,
      toB: chunk.fromB + change.toB,
    })
    originalStartLine = Math.min(originalStartLine, range.originalStartLine)
    originalEndLineExclusive = Math.max(originalEndLineExclusive, range.originalEndLineExclusive)
    modifiedStartLine = Math.min(modifiedStartLine, range.modifiedStartLine)
    modifiedEndLineExclusive = Math.max(modifiedEndLineExclusive, range.modifiedEndLineExclusive)
  }

  if (!Number.isFinite(originalStartLine) || !Number.isFinite(modifiedStartLine)) {
    originalStartLine = originalDoc.lineAt(Math.min(chunk.fromA, originalDoc.length)).number
    originalEndLineExclusive = originalStartLine
    modifiedStartLine = modifiedDoc.lineAt(Math.min(chunk.fromB, modifiedDoc.length)).number
    modifiedEndLineExclusive = modifiedStartLine
  }

  const originalLineCount = Math.max(0, originalEndLineExclusive - originalStartLine)
  const modifiedLineCount = Math.max(0, modifiedEndLineExclusive - modifiedStartLine)

  return {
    modifiedLineCount,
    modifiedStartLine: modifiedLineCount === 0 ? Math.max(0, modifiedStartLine - 1) : modifiedStartLine,
    originalLineCount,
    originalStartLine: originalLineCount === 0 ? Math.max(0, originalStartLine - 1) : originalStartLine,
  }
}

function createTextDocFromContent(content: string) {
  return Text.of(content.split('\n'))
}

export function createVisualDiffSelections(originalContent: string, modifiedContent: string): GitDiffSelection[] {
  const originalDoc = createTextDocFromContent(originalContent)
  const modifiedDoc = createTextDocFromContent(modifiedContent)
  const chunks = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc)

  return chunks.map((chunk) => createSelectionFromCodeMirrorChunk(originalDoc, modifiedDoc, chunk))
}

function isLineWithinSelection(
  selection: GitDiffSelection,
  source: 'revision' | 'worktree',
  lineNumber: number,
) {
  const normalizedLineNumber = Math.max(1, Math.floor(lineNumber))
  const startLine = source === 'revision' ? selection.originalStartLine : selection.modifiedStartLine
  const lineCount = source === 'revision' ? selection.originalLineCount : selection.modifiedLineCount

  if (!Number.isInteger(startLine) || startLine < 1 || lineCount <= 0) {
    return false
  }

  return normalizedLineNumber >= startLine && normalizedLineNumber < startLine + lineCount
}

export function isLineWithinVisualDiff(
  originalContent: string,
  modifiedContent: string,
  source: 'revision' | 'worktree',
  lineNumber: number,
) {
  return createVisualDiffSelections(originalContent, modifiedContent)
    .some((selection) => isLineWithinSelection(selection, source, lineNumber))
}
