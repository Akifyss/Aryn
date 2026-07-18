import type { ParsedTerminalContextEntry } from '../../lib/terminalContext'

export function formatInlineTerminalContextLabel(header: string) {
  return `[${header}]`
}

export function buildInlineTerminalContextText(contexts: ParsedTerminalContextEntry[]) {
  return contexts.map((context) => formatInlineTerminalContextLabel(context.header)).join(' ')
}

export function textContainsInlineTerminalContextLabels(text: string, contexts: ParsedTerminalContextEntry[]) {
  return contexts.every((context) => text.includes(formatInlineTerminalContextLabel(context.header)))
}
