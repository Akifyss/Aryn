import type { TimelineRow } from './server-contract'
import type { ThreadTimelineTurnSummaryDetailsQueryIdentity } from './query-keys'

const EMPTY_ROWS: TimelineRow[] = []

export function useThreadTimelineTurnSummaryDetails(
  _identity: ThreadTimelineTurnSummaryDetailsQueryIdentity,
) {
  return {
    data: { rows: EMPTY_ROWS },
    isError: false,
    refetch: async () => ({ data: { rows: EMPTY_ROWS } }),
  }
}

export type ThreadQueryData = {
  projectId: string
  title: string | null
  titleFallback: string | null
}

export function useThread(
  _threadId: string,
  _options?: { enabled?: boolean },
): { data: ThreadQueryData | undefined } {
  return { data: undefined }
}
