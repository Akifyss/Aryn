import type { ActiveThinking, ThreadRuntimeDisplayStatus, ThreadStatus } from '@bb/domain'
import type { ThreadEventWithMeta } from '@bb/thread-view'
import type { TimelineRow } from '../compat/server-contract'

export type CanonicalSessionProjection = {
  contextWindowEvents: ThreadEventWithMeta[]
  events: ThreadEventWithMeta[]
  providerDisplayName: string
  providerId: string
  runtimeStatus: ThreadRuntimeDisplayStatus
  threadName: string
  threadStatus: ThreadStatus
}

export type TimelineProjection = {
  activeThinking: ActiveThinking | null
  isStopping: boolean
  ongoingIndicatorLabel?: string
  rows: TimelineRow[]
  runtimeStatus: ThreadRuntimeDisplayStatus
  stoppingAnchorAt?: number
}
