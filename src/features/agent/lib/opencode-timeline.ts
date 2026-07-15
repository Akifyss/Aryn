import type { Part as OpenCodePart } from '@opencode-ai/sdk/v2'
import type {
  OpenCodeNativeMessageRecord,
  OpenCodeNativeSessionSnapshot,
} from '@/features/agent/types'

/**
 * Compatibility helpers for Aryn's composer and outer scroll container.
 *
 * OpenCode message grouping, tool presentation, diffs, errors, and status are
 * deliberately not projected here. Those behaviors live in the vendored
 * official OpenCode session surface under packages/opencode-session-surface.
 */
export function getOpenCodeUserTextPart(record: OpenCodeNativeMessageRecord) {
  if (record.info.role !== 'user') return null
  return record.parts.find((part): part is Extract<OpenCodePart, { type: 'text' }> => (
    part.type === 'text' && !part.synthetic
  )) ?? null
}

export function getOpenCodeUserMessageText(record: OpenCodeNativeMessageRecord) {
  return getOpenCodeUserTextPart(record)?.text.trim() ?? ''
}

/**
 * The official Solid surface owns rendering, but it is hosted inside Aryn's
 * existing scroll area. This compact key lets the React shell perform its
 * established stick-to-bottom behavior after native OpenCode updates.
 */
export function getOpenCodeNativeRenderKey(snapshot: OpenCodeNativeSessionSnapshot | null | undefined) {
  if (!snapshot) return 'none'
  const tail = snapshot.messages.at(-1)
  const partKey = tail?.parts.map((part) => {
    if (part.type === 'text' || part.type === 'reasoning') return `${part.id}:${part.text.length}`
    if (part.type === 'tool') return `${part.id}:${part.state.status}`
    return `${part.id}:${part.type}`
  }).join(',') ?? ''
  return `${snapshot.status.type}:${snapshot.messages.length}:${tail?.info.id ?? ''}:${partKey}:${snapshot.diffs.length}`
}
