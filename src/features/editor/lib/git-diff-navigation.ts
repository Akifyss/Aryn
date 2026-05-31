import { Text } from '@codemirror/state'
import type { GitDiffSelection } from '@/features/git/types'
import {
  buildCodeMirrorChunksFromVsCodeDiff,
  getVsCodeStyleChangeLineRange,
} from '@/vendor/meo/shared/gitDiffLineFlags'

export type DiffNavigationSide = 'modified' | 'original'

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
  actualFromA?: number
  actualFromB?: number
  actualToA?: number
  actualToB?: number
  changes: readonly {
    fromA: number
    toA: number
    fromB: number
    toB: number
  }[]
}

export type DiffNavigationTarget = {
  focusEditor: boolean
  lineNumber: number
  selectLine: boolean
  side: DiffNavigationSide
}

export type DiffNavigationMatch = {
  distance: number
  selection: GitDiffSelection
  target: DiffNavigationTarget
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

function normalizeCodeMirrorText(content: string) {
  return `${content ?? ''}`.replace(/\r\n?/g, '\n')
}

function createTextDocFromContent(content: string) {
  return Text.of(normalizeCodeMirrorText(content).split('\n'))
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
  const counterpartLineCount = source === 'revision' ? selection.modifiedLineCount : selection.originalLineCount

  if (!Number.isInteger(startLine)) {
    return false
  }

  if (lineCount <= 0) {
    if (counterpartLineCount <= 0) {
      return false
    }

    const boundaryLine = Math.max(1, startLine)
    return normalizedLineNumber === boundaryLine
  }

  if (startLine < 1) {
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

function getDistanceToLineRange(lineNumber: number, startLine: number, lineCount: number) {
  const normalizedStartLine = Math.max(1, startLine)

  if (lineCount <= 0) {
    return Math.abs(lineNumber - normalizedStartLine)
  }

  const endLine = normalizedStartLine + lineCount - 1

  if (lineNumber < normalizedStartLine) {
    return normalizedStartLine - lineNumber
  }

  if (lineNumber > endLine) {
    return lineNumber - endLine
  }

  return 0
}

function getNavigationSelectionLineStart(selection: GitDiffSelection, side: DiffNavigationSide) {
  return Math.max(1, side === 'modified' ? selection.modifiedStartLine : selection.originalStartLine)
}

function getNavigationSelectionLineCount(selection: GitDiffSelection, side: DiffNavigationSide) {
  return side === 'modified' ? selection.modifiedLineCount : selection.originalLineCount
}

function getNavigationHighlightRange(
  selection: GitDiffSelection,
  side: DiffNavigationSide,
) {
  const startLineNumber = getNavigationSelectionLineStart(selection, side)
  const lineCount = getNavigationSelectionLineCount(selection, side)

  return {
    endLineNumber: lineCount > 0 ? startLineNumber + lineCount - 1 : startLineNumber,
    startLineNumber,
  }
}

function clampRequestedLineToSelectionRange(
  selection: GitDiffSelection,
  side: DiffNavigationSide,
  requestedLineNumber: number,
) {
  const { endLineNumber, startLineNumber } = getNavigationHighlightRange(selection, side)
  return Math.max(startLineNumber, Math.min(requestedLineNumber, endLineNumber))
}

export function resolveChunkNavigationMatch(
  originalDoc: Text,
  modifiedDoc: Text,
  chunk: CodeMirrorDiffChunk,
  requestedLineNumber: number,
  preferredSide: DiffNavigationSide,
): DiffNavigationMatch {
  const selection = createSelectionFromCodeMirrorChunk(originalDoc, modifiedDoc, chunk)
  const fallbackSide = preferredSide === 'modified' ? 'original' : 'modified'
  const preferredSideLineCount = getNavigationSelectionLineCount(selection, preferredSide)
  const fallbackSideLineCount = getNavigationSelectionLineCount(selection, fallbackSide)
  const preferredDistance = getDistanceToLineRange(
    requestedLineNumber,
    getNavigationSelectionLineStart(selection, preferredSide),
    preferredSideLineCount,
  )
  const fallbackDistance = getDistanceToLineRange(
    requestedLineNumber,
    getNavigationSelectionLineStart(selection, fallbackSide),
    fallbackSideLineCount,
  )

  let side: DiffNavigationSide
  let distance: number
  let passiveBoundaryReveal = false

  if (preferredSideLineCount <= 0 && fallbackSideLineCount > 0) {
    side = fallbackSide
    distance = preferredDistance
    passiveBoundaryReveal = true
  } else if (fallbackSideLineCount <= 0 && preferredSideLineCount > 0) {
    side = preferredSide
    distance = preferredDistance
  } else if (preferredDistance < fallbackDistance) {
    side = preferredSide
    distance = preferredDistance
  } else if (fallbackDistance < preferredDistance) {
    side = fallbackSide
    distance = fallbackDistance
  } else {
    side = preferredSide
    distance = preferredDistance
  }

  return {
    distance,
    selection,
    target: {
      focusEditor: !passiveBoundaryReveal,
      lineNumber: clampRequestedLineToSelectionRange(selection, side, requestedLineNumber),
      selectLine: !passiveBoundaryReveal,
      side,
    },
  }
}

export function findBestNavigationTarget(
  originalDoc: Text,
  modifiedDoc: Text,
  chunks: readonly CodeMirrorDiffChunk[],
  requestedLineNumber: number,
  preferredSide: DiffNavigationSide,
) {
  let bestMatch: DiffNavigationMatch | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const chunk of chunks) {
    const nextMatch = resolveChunkNavigationMatch(
      originalDoc,
      modifiedDoc,
      chunk,
      requestedLineNumber,
      preferredSide,
    )
    const nextDistance = nextMatch.distance

    if (
      nextDistance < bestDistance
      || (
        nextDistance === bestDistance
        && nextMatch.target.side === preferredSide
        && bestMatch?.target.side !== preferredSide
      )
    ) {
      bestDistance = nextDistance
      bestMatch = nextMatch
    }
  }

  return bestMatch
}
