export function normalizeMarkdownForComparison(markdown: string) {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/&nbsp;|&#160;|\u00A0/g, ' ')
}
