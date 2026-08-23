export interface ThreadTimelineTurnSummaryDetailsQueryIdentity {
  sourceSeqEnd: number
  sourceSeqStart: number
  threadId: string
  turnId: string
}

export function threadQueryKey(threadId: string) {
  return ['thread', threadId] as const
}
