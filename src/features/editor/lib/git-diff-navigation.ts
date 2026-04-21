import type { Text } from '@codemirror/state'
import type { GitDiffSelection } from '@/features/git/types'
import { getVsCodeStyleChangeLineRange } from '@/vendor/meo/shared/gitDiffLineFlags'

export type CodeMirrorDiffChunk = {
  fromA: number
  toA: number
  fromB: number
  toB: number
  endA: number
  endB: number
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
