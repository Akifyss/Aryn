import type { TimestampFormat } from './compat/contracts'

function date(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatShortTimestamp(value: string, _format: TimestampFormat) {
  const parsed = date(value)
  return parsed?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? ''
}

export function formatChatTimestampTooltip(value: string, _format: TimestampFormat) {
  return date(value)?.toLocaleString() ?? value
}
