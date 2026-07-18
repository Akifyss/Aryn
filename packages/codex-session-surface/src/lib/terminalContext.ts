export type ParsedTerminalContextEntry = { header: string; body: string }

export function deriveDisplayedUserMessageState(text: string) {
  return {
    contexts: [] as ParsedTerminalContextEntry[],
    elementContexts: [] as Array<{ header: string; body: string }>,
    visibleText: text,
    copyText: text,
  }
}
