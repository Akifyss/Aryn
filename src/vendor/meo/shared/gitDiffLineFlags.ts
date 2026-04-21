import { Text } from '@codemirror/state'
import { Chunk, type DiffConfig } from '@codemirror/merge'

export type GitLineChangeFlags = {
  added: boolean
  modified: boolean
  scope?: 'staged' | 'unstaged'
}

function emptyLineChangeFlags(): GitLineChangeFlags {
  return {
    added: false,
    modified: false,
  }
}

const GIT_LINE_DIFF_CONFIG: DiffConfig = {
  scanLimit: 1000,
  timeout: 200,
}

function getChunkEndLine(doc: Text, to: number): number {
  return doc.lineAt(Math.max(0, Math.min(doc.length, to) - 1)).number
}

function getChangedTextLineCount(doc: Text, from: number, to: number) {
  if (from === to || doc.length === 0) {
    return 0
  }

  const startLine = doc.lineAt(Math.min(from, doc.length)).number
  const endLine = getChunkEndLine(doc, to)
  return Math.max(0, endLine - startLine + 1)
}

function buildSourceToTargetLineMap(sourceDoc: Text, targetDoc: Text) {
  const lineMap = new Array<number | undefined>(sourceDoc.lines + 1)
  let sourceLine = 1
  let targetLine = 1

  for (const chunk of Chunk.build(sourceDoc, targetDoc, GIT_LINE_DIFF_CONFIG)) {
    const chunkSourceStartLine = sourceDoc.lineAt(Math.min(chunk.fromA, sourceDoc.length)).number
    const chunkTargetStartLine = targetDoc.lineAt(Math.min(chunk.fromB, targetDoc.length)).number

    while (sourceLine < chunkSourceStartLine && targetLine < chunkTargetStartLine) {
      lineMap[sourceLine] = targetLine
      sourceLine += 1
      targetLine += 1
    }

    const sourceLineCount = getChangedTextLineCount(sourceDoc, chunk.fromA, chunk.toA)
    const targetLineCount = getChangedTextLineCount(targetDoc, chunk.fromB, chunk.toB)
    const pairedLineCount = Math.min(sourceLineCount, targetLineCount)
    for (let offset = 0; offset < pairedLineCount; offset += 1) {
      lineMap[chunkSourceStartLine + offset] = chunkTargetStartLine + offset
    }

    sourceLine = chunkSourceStartLine + sourceLineCount
    targetLine = chunkTargetStartLine + targetLineCount
  }

  while (sourceLine <= sourceDoc.lines && targetLine <= targetDoc.lines) {
    lineMap[sourceLine] = targetLine
    sourceLine += 1
    targetLine += 1
  }

  return lineMap
}

export function buildLineFlagsFromCodeMirrorChunks(
  baseLines: string[],
  currentDoc: Text,
): (GitLineChangeFlags | undefined)[] {
  const lineFlags: (GitLineChangeFlags | undefined)[] = new Array(currentDoc.lines)
  const baseDoc = Text.of(baseLines)

  for (const chunk of Chunk.build(baseDoc, currentDoc, GIT_LINE_DIFF_CONFIG)) {
    if (chunk.fromB === chunk.toB) {
      continue
    }

    const startLine = currentDoc.lineAt(Math.min(chunk.fromB, currentDoc.length)).number
    const endLine = getChunkEndLine(currentDoc, chunk.toB)
    const isPureInsert = chunk.fromA === chunk.toA || baseDoc.length === 0

    for (let lineNo = startLine; lineNo <= endLine; lineNo += 1) {
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

export function buildScopedLineFlagsFromCodeMirrorChunks(
  baseLines: string[],
  indexLines: string[],
  currentDoc: Text,
): (GitLineChangeFlags | undefined)[] {
  const indexDoc = Text.of(indexLines)
  const stagedFlags = buildLineFlagsFromCodeMirrorChunks(baseLines, indexDoc)
  const unstagedFlags = buildLineFlagsFromCodeMirrorChunks(indexLines, currentDoc)
  const indexToCurrentLineMap = buildSourceToTargetLineMap(indexDoc, currentDoc)
  const lineFlags: (GitLineChangeFlags | undefined)[] = new Array(currentDoc.lines)

  for (let lineNo = 1; lineNo <= currentDoc.lines; lineNo += 1) {
    const unstaged = unstagedFlags[lineNo - 1]
    if (unstaged?.added || unstaged?.modified) {
      lineFlags[lineNo - 1] = {
        added: !!unstaged.added,
        modified: !!unstaged.modified,
        scope: 'unstaged',
      }
    }
  }

  for (let indexLineNo = 1; indexLineNo <= stagedFlags.length; indexLineNo += 1) {
    const staged = stagedFlags[indexLineNo - 1]
    const mappedCurrentLineNo = indexToCurrentLineMap[indexLineNo]
    if (
      !(staged?.added || staged?.modified) ||
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
      modified: !!staged.modified,
      scope: 'staged',
    }
  }

  return lineFlags
}
