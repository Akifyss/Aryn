import { Text } from '@codemirror/state'
import { Change, Chunk } from '@codemirror/merge'
// @ts-expect-error Monaco exposes the VS Code diff implementation as ESM JS without declarations.
import { DefaultLinesDiffComputer } from 'monaco-editor/esm/vs/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.js'

export type GitLineChangeFlags = {
  added: boolean
  deleted: boolean
  modified: boolean
  scope?: 'staged' | 'unstaged'
}

function emptyLineChangeFlags(): GitLineChangeFlags {
  return {
    added: false,
    deleted: false,
    modified: false,
  }
}

const GIT_LINE_DIFF_TIMEOUT_MS = 200
const vsCodeLineDiffComputer = new DefaultLinesDiffComputer()

type VsCodePosition = {
  column: number
  lineNumber: number
}

type VsCodeRange = {
  endColumn: number
  endLineNumber: number
  startColumn: number
  startLineNumber: number
}

type VsCodeLineChange = {
  innerChanges?: {
    modifiedRange: VsCodeRange
    originalRange: VsCodeRange
  }[]
  modified: {
    endLineNumberExclusive: number
    startLineNumber: number
  }
  original: {
    endLineNumberExclusive: number
    startLineNumber: number
  }
}

function getPosition(doc: Text, offset: number) {
  const line = doc.lineAt(Math.max(0, Math.min(doc.length, offset)))
  return {
    lineNumber: line.number,
    column: Math.max(1, offset - line.from + 1),
  }
}

function getLineLength(doc: Text, lineNumber: number) {
  const normalizedLineNumber = Math.max(1, Math.min(doc.lines, lineNumber))
  const line = doc.line(normalizedLineNumber)
  return line.to - line.from
}

function positionToOffset(doc: Text, position: VsCodePosition) {
  const lineNumber = Math.max(1, Math.min(doc.lines, position.lineNumber))
  const line = doc.line(lineNumber)
  return Math.max(line.from, Math.min(line.to, line.from + position.column - 1))
}

function rangeStartToOffset(doc: Text, range: VsCodeRange) {
  return positionToOffset(doc, {
    column: range.startColumn,
    lineNumber: range.startLineNumber,
  })
}

function rangeEndToOffset(doc: Text, range: VsCodeRange) {
  return positionToOffset(doc, {
    column: range.endColumn,
    lineNumber: range.endLineNumber,
  })
}

function lineRangeBoundaryToOffset(doc: Text, lineNumber: number) {
  if (lineNumber <= 1) {
    return 0
  }
  if (lineNumber <= doc.lines) {
    return doc.line(lineNumber).from
  }

  return doc.length + (lineNumber - doc.lines)
}

function changedLineRangeToOffsets(
  doc: Text,
  startLineNumber: number,
  endLineNumberExclusive: number,
  fallbackOffset: number,
) {
  if (startLineNumber >= endLineNumberExclusive) {
    return {
      from: fallbackOffset,
      to: fallbackOffset,
    }
  }

  return {
    from: lineRangeBoundaryToOffset(doc, startLineNumber),
    to: lineRangeBoundaryToOffset(doc, endLineNumberExclusive),
  }
}

function getActualChangeOffsets(
  doc: Text,
  innerChanges: VsCodeLineChange['innerChanges'],
  side: 'modifiedRange' | 'originalRange',
  fallbackOffsets: { from: number, to: number },
) {
  if (!innerChanges?.length) {
    return fallbackOffsets
  }

  let from = Number.POSITIVE_INFINITY
  let to = Number.NEGATIVE_INFINITY
  for (const innerChange of innerChanges) {
    const range = innerChange[side]
    from = Math.min(from, rangeStartToOffset(doc, range))
    to = Math.max(to, rangeEndToOffset(doc, range))
  }

  return Number.isFinite(from) && Number.isFinite(to)
    ? { from, to }
    : fallbackOffsets
}

function createWholeChunkChange(
  originalDoc: Text,
  modifiedDoc: Text,
  originalOffsets: { from: number, to: number },
  modifiedOffsets: { from: number, to: number },
) {
  return new Change(
    0,
    Math.max(0, Math.min(originalDoc.length, originalOffsets.to) - Math.min(originalDoc.length, originalOffsets.from)),
    0,
    Math.max(0, Math.min(modifiedDoc.length, modifiedOffsets.to) - Math.min(modifiedDoc.length, modifiedOffsets.from)),
  )
}

function isRelativeChangeInsideChunk(
  change: Change,
  originalOffsets: { from: number, to: number },
  modifiedOffsets: { from: number, to: number },
) {
  const originalLength = Math.max(0, originalOffsets.to - originalOffsets.from)
  const modifiedLength = Math.max(0, modifiedOffsets.to - modifiedOffsets.from)

  return (
    change.fromA >= 0
    && change.toA >= change.fromA
    && change.toA <= originalLength
    && change.fromB >= 0
    && change.toB >= change.fromB
    && change.toB <= modifiedLength
  )
}

export function getVsCodeStyleChangeLineRange(
  originalDoc: Text,
  modifiedDoc: Text,
  change: { fromA: number, toA: number, fromB: number, toB: number },
) {
  const originalStart = getPosition(originalDoc, change.fromA)
  const originalEnd = getPosition(originalDoc, change.toA)
  const modifiedStart = getPosition(modifiedDoc, change.fromB)
  const modifiedEnd = getPosition(modifiedDoc, change.toB)
  let lineStartDelta = 0
  let lineEndDelta = 0

  // Mirrors VS Code's rangeMapping.getLineRangeMapping: if a character diff
  // starts at the end of an unchanged line, the changed line range starts on
  // the following visual line instead of marking the unchanged content line.
  if (
    modifiedEnd.column === 1 &&
    originalEnd.column === 1 &&
    originalStart.lineNumber + lineStartDelta <= originalEnd.lineNumber &&
    modifiedStart.lineNumber + lineStartDelta <= modifiedEnd.lineNumber
  ) {
    lineEndDelta = -1
  }

  if (
    modifiedStart.column - 1 >= getLineLength(modifiedDoc, modifiedStart.lineNumber) &&
    originalStart.column - 1 >= getLineLength(originalDoc, originalStart.lineNumber) &&
    originalStart.lineNumber <= originalEnd.lineNumber + lineEndDelta &&
    modifiedStart.lineNumber <= modifiedEnd.lineNumber + lineEndDelta
  ) {
    lineStartDelta = 1
  }

  return {
    originalStartLine: originalStart.lineNumber + lineStartDelta,
    originalEndLineExclusive: originalEnd.lineNumber + 1 + lineEndDelta,
    modifiedStartLine: modifiedStart.lineNumber + lineStartDelta,
    modifiedEndLineExclusive: modifiedEnd.lineNumber + 1 + lineEndDelta,
  }
}

function getTextLines(doc: Text) {
  const lines: string[] = []
  for (let lineNo = 1; lineNo <= doc.lines; lineNo += 1) {
    lines.push(doc.line(lineNo).text)
  }
  return lines
}

function computeVsCodeLineDiff(originalLines: string[], modifiedLines: string[]) {
  return vsCodeLineDiffComputer.computeDiff(originalLines, modifiedLines, {
    computeMoves: false,
    extendToSubwords: false,
    ignoreTrimWhitespace: false,
    maxComputationTimeMs: GIT_LINE_DIFF_TIMEOUT_MS,
  })
}

function hasLineChange(flags: GitLineChangeFlags | undefined) {
  return !!(flags?.added || flags?.deleted || flags?.modified)
}

function clampDeletedAnchorLine(modifiedStartLine: number, currentLineCount: number) {
  if (currentLineCount <= 1) {
    return 1
  }
  if (modifiedStartLine <= 1) {
    return 1
  }
  return Math.max(1, Math.min(currentLineCount, modifiedStartLine - 1))
}

export function buildCodeMirrorChunksFromVsCodeDiff(originalDoc: Text, modifiedDoc: Text) {
  const changes = computeVsCodeLineDiff(getTextLines(originalDoc), getTextLines(modifiedDoc)).changes as VsCodeLineChange[]

  return changes.map((change) => {
    const firstInnerChange = change.innerChanges?.[0]
    const fallbackFromA = firstInnerChange ? rangeStartToOffset(originalDoc, firstInnerChange.originalRange) : 0
    const fallbackFromB = firstInnerChange ? rangeStartToOffset(modifiedDoc, firstInnerChange.modifiedRange) : 0
    const originalOffsets = changedLineRangeToOffsets(
      originalDoc,
      change.original.startLineNumber,
      change.original.endLineNumberExclusive,
      fallbackFromA,
    )
    const modifiedOffsets = changedLineRangeToOffsets(
      modifiedDoc,
      change.modified.startLineNumber,
      change.modified.endLineNumberExclusive,
      fallbackFromB,
    )
    const relativeInnerChanges = change.innerChanges?.length
      ? change.innerChanges.map((innerChange) => new Change(
        rangeStartToOffset(originalDoc, innerChange.originalRange) - originalOffsets.from,
        rangeEndToOffset(originalDoc, innerChange.originalRange) - originalOffsets.from,
        rangeStartToOffset(modifiedDoc, innerChange.modifiedRange) - modifiedOffsets.from,
        rangeEndToOffset(modifiedDoc, innerChange.modifiedRange) - modifiedOffsets.from,
      ))
      : []
    const innerChanges = relativeInnerChanges.length > 0
      && relativeInnerChanges.every((innerChange) => (
        isRelativeChangeInsideChunk(innerChange, originalOffsets, modifiedOffsets)
      ))
      ? relativeInnerChanges
      : [createWholeChunkChange(originalDoc, modifiedDoc, originalOffsets, modifiedOffsets)]
    const actualOriginalOffsets = getActualChangeOffsets(originalDoc, change.innerChanges, 'originalRange', originalOffsets)
    const actualModifiedOffsets = getActualChangeOffsets(modifiedDoc, change.innerChanges, 'modifiedRange', modifiedOffsets)

    return Object.assign(new Chunk(
      innerChanges,
      originalOffsets.from,
      originalOffsets.to,
      modifiedOffsets.from,
      modifiedOffsets.to,
    ), {
      actualFromA: actualOriginalOffsets.from,
      actualFromB: actualModifiedOffsets.from,
      actualToA: actualOriginalOffsets.to,
      actualToB: actualModifiedOffsets.to,
      vscodeModifiedEndLineExclusive: change.modified.endLineNumberExclusive,
      vscodeModifiedStartLine: change.modified.startLineNumber,
      vscodeOriginalEndLineExclusive: change.original.endLineNumberExclusive,
      vscodeOriginalStartLine: change.original.startLineNumber,
    })
  })
}

export function buildSourceToTargetLineMap(sourceDoc: Text, targetDoc: Text) {
  const lineMap = new Array<number | undefined>(sourceDoc.lines + 1)
  let sourceLine = 1
  let targetLine = 1

  for (const change of computeVsCodeLineDiff(getTextLines(sourceDoc), getTextLines(targetDoc)).changes) {
    const sourceStartLine = change.original.startLineNumber
    const sourceEndLineExclusive = change.original.endLineNumberExclusive
    const targetStartLine = change.modified.startLineNumber
    const targetEndLineExclusive = change.modified.endLineNumberExclusive

    while (sourceLine < sourceStartLine && targetLine < targetStartLine) {
      lineMap[sourceLine] = targetLine
      sourceLine += 1
      targetLine += 1
    }

    const sourceLineCount = Math.max(0, sourceEndLineExclusive - sourceStartLine)
    const targetLineCount = Math.max(0, targetEndLineExclusive - targetStartLine)
    const pairedLineCount = Math.min(sourceLineCount, targetLineCount)
    for (let offset = 0; offset < pairedLineCount; offset += 1) {
      lineMap[sourceStartLine + offset] = targetStartLine + offset
    }

    sourceLine = sourceEndLineExclusive
    targetLine = targetEndLineExclusive
  }

  while (sourceLine <= sourceDoc.lines && targetLine <= targetDoc.lines) {
    lineMap[sourceLine] = targetLine
    sourceLine += 1
    targetLine += 1
  }

  return lineMap
}

export function buildLineFlagsFromVsCodeDiff(
  baseLines: string[],
  currentDoc: Text,
): (GitLineChangeFlags | undefined)[] {
  const lineFlags: (GitLineChangeFlags | undefined)[] = new Array(currentDoc.lines)
  const baseDoc = Text.of(baseLines)
  const currentLines = getTextLines(currentDoc)

  for (const change of computeVsCodeLineDiff(baseLines, currentLines).changes) {
    const modifiedStartLine = change.modified.startLineNumber
    const modifiedEndLineExclusive = change.modified.endLineNumberExclusive
    const originalLineCount = Math.max(0, change.original.endLineNumberExclusive - change.original.startLineNumber)
    if (modifiedStartLine >= modifiedEndLineExclusive) {
      if (originalLineCount > 0) {
        const anchorLine = clampDeletedAnchorLine(modifiedStartLine, currentDoc.lines)
        const flags = lineFlags[anchorLine - 1] ?? (lineFlags[anchorLine - 1] = emptyLineChangeFlags())
        flags.deleted = true
      }
      continue
    }
    const isPureInsert = originalLineCount === 0 || baseDoc.length === 0
    const startLine = Math.max(1, modifiedStartLine)
    const endLine = Math.min(currentDoc.lines + 1, modifiedEndLineExclusive)
    for (let lineNo = startLine; lineNo < endLine; lineNo += 1) {
      if (lineNo > currentDoc.lines) {
        continue
      }
      const flags = lineFlags[lineNo - 1] ?? (lineFlags[lineNo - 1] = emptyLineChangeFlags())
      if (isPureInsert) {
        flags.added = true
      } else {
        flags.modified = true
      }
    }
  }

  return lineFlags
}

export function buildScopedLineFlagsFromVsCodeDiff(
  baseLines: string[],
  indexLines: string[],
  currentDoc: Text,
): (GitLineChangeFlags | undefined)[] {
  const indexDoc = Text.of(indexLines)
  const stagedFlags = buildLineFlagsFromVsCodeDiff(baseLines, indexDoc)
  const unstagedFlags = buildLineFlagsFromVsCodeDiff(indexLines, currentDoc)
  const indexToCurrentLineMap = buildSourceToTargetLineMap(indexDoc, currentDoc)
  const lineFlags: (GitLineChangeFlags | undefined)[] = new Array(currentDoc.lines)

  for (let lineNo = 1; lineNo <= currentDoc.lines; lineNo += 1) {
    const unstaged = unstagedFlags[lineNo - 1]
    if (unstaged && hasLineChange(unstaged)) {
      lineFlags[lineNo - 1] = {
        added: !!unstaged.added,
        deleted: !!unstaged.deleted,
        modified: !!unstaged.modified,
        scope: 'unstaged',
      }
    }
  }

  for (let indexLineNo = 1; indexLineNo <= stagedFlags.length; indexLineNo += 1) {
    const staged = stagedFlags[indexLineNo - 1]
    const mappedCurrentLineNo = indexToCurrentLineMap[indexLineNo]
    if (
      !staged ||
      !hasLineChange(staged) ||
      typeof mappedCurrentLineNo !== 'number' ||
      !Number.isInteger(mappedCurrentLineNo) ||
      mappedCurrentLineNo < 1 ||
      mappedCurrentLineNo > currentDoc.lines ||
      lineFlags[mappedCurrentLineNo - 1]
    ) {
      continue
    }

    const currentLineNo = mappedCurrentLineNo
    lineFlags[currentLineNo - 1] = {
      added: !!staged.added,
      deleted: !!staged.deleted,
      modified: !!staged.modified,
      scope: 'staged',
    }
  }

  return lineFlags
}
