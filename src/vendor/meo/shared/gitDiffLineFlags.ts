import { Text } from '@codemirror/state'
import { Chunk, type DiffConfig } from '@codemirror/merge'

export type GitLineChangeFlags = {
  added: boolean
  modified: boolean
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
