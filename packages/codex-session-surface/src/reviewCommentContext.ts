export type ReviewCommentContext = {
  id: string
  filePath: string
  sectionTitle: string
  rangeLabel: string
  text: string
  diff: string
  fenceLanguage?: string
}

export type ReviewCommentMessageSegment =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'review-comment'; comment: ReviewCommentContext }

export function parseReviewCommentMessageSegments(text: string): ReviewCommentMessageSegment[] {
  return [{ kind: 'text', id: 'message-text', text }]
}

export function buildReviewCommentRenderablePatch(comment: ReviewCommentContext) {
  return comment.diff
}

export function formatReviewCommentFence(language: string, diff: string) {
  return `\`\`\`${language}\n${diff}\n\`\`\``
}
