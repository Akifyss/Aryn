import type {
  OrchestrationCheckpointSummary,
  OrchestrationMessage,
  OrchestrationProposedPlan,
} from './compat/contracts'

export type ChatAttachment = {
  id: string
  name: string
  mimeType?: string
  previewUrl?: string
  type?: string
  url?: string
}

export interface ChatMessage extends Omit<OrchestrationMessage, 'attachments'> {
  readonly attachments?: ReadonlyArray<ChatAttachment>
}

export type ProposedPlan = OrchestrationProposedPlan
export type TurnDiffSummary = OrchestrationCheckpointSummary
export type TurnDiffFileChange = TurnDiffSummary['files'][number]
