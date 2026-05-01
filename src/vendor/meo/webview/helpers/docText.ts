import type { Text } from '@codemirror/state'

function normalizeNeedle(needle: string): string {
  return String(needle ?? '')
}

export function textIncludes(doc: Text, needle: string): boolean {
  const target = normalizeNeedle(needle)
  if (!target) {
    return true
  }

  const overlapLength = Math.max(0, target.length - 1)
  let tail = ''
  const cursor = doc.iter()

  while (!cursor.next().done) {
    const chunk = `${tail}${cursor.value}`
    if (chunk.includes(target)) {
      return true
    }
    tail = overlapLength > 0 ? chunk.slice(-overlapLength) : ''
  }

  return false
}
