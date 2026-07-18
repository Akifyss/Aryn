export type ParsedPreviewAnnotation = {
  id: string
  comment?: string
  targetSummary?: string
  styleChanges: ReadonlyArray<unknown>
}

export function extractTrailingPreviewAnnotation(text: string) {
  return { annotation: null as ParsedPreviewAnnotation | null, promptText: text }
}
