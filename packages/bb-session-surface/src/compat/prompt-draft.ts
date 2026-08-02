export type PromptDraftAttachment = {
  id?: string
  name?: string
  path?: string
  url?: string
  mimeType?: string
}
export function appendQuoteToDraftText(value: string, quote: string): string {
  return `${value}${value ? '\n\n' : ''}> ${quote.replaceAll('\n', '\n> ')}\n\n`
}
