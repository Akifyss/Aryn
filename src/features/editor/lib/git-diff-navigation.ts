import type { Text } from '@codemirror/state'
import type { GitDiffSelection } from '@/features/git/types'

export type CodeMirrorDiffChunk = {
  fromA: number
  toA: number
  fromB: number
  toB: number
  endA: number
  endB: number
}

function getChangedTextLineCount(doc: Text, from: number, to: number) {
  if (from === to || doc.length === 0) {
    return 0
  }

  const startLine = doc.lineAt(Math.min(from, doc.length)).number
  const endLine = doc.lineAt(Math.max(0, Math.min(doc.length, to) - 1)).number
  return Math.max(0, endLine - startLine + 1)
}

export function createSelectionFromCodeMirrorChunk(
  originalDoc: Text,
  modifiedDoc: Text,
  chunk: CodeMirrorDiffChunk,
): GitDiffSelection {
  const originalStartLine = originalDoc.lineAt(Math.min(chunk.fromA, originalDoc.length)).number
  const modifiedStartLine = modifiedDoc.lineAt(Math.min(chunk.fromB, modifiedDoc.length)).number
  const originalLineCount = chunk.fromA === chunk.toA ? 0 : getChangedTextLineCount(originalDoc, chunk.fromA, chunk.toA)
  const modifiedLineCount = chunk.fromB === chunk.toB ? 0 : getChangedTextLineCount(modifiedDoc, chunk.fromB, chunk.toB)

  return {
    modifiedLineCount,
    modifiedStartLine: modifiedLineCount === 0 ? Math.max(0, modifiedStartLine - 1) : modifiedStartLine,
    originalLineCount,
    originalStartLine: originalLineCount === 0 ? Math.max(0, originalStartLine - 1) : originalStartLine,
  }
}
