export type ParsedElementContextEntry = { header: string; body: string }

export function extractTrailingElementContexts(text: string) {
  return { contexts: [] as ParsedElementContextEntry[], promptText: text }
}
