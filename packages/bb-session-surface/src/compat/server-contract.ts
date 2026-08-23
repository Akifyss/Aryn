import { z } from 'zod'

export * from '../upstream/bb/packages/server-contract/src/thread-timeline'

export type GitDiffFileChangeKind =
  | 'added'
  | 'copied'
  | 'deleted'
  | 'modified'
  | 'renamed'
  | 'type_changed'

export type ThreadContextWindowUsage = {
  estimated: boolean
  modelContextWindow: number
  usedTokens: number
}

export const THREAD_MENTION_RESOLVE_MAX_IDS = 32

export const uploadedPromptAttachmentSchema = z.object({
  type: z.enum(['localImage', 'localFile']),
  path: z.string(),
  name: z.string(),
  mimeType: z.string().optional(),
  sizeBytes: z.number(),
})

export type UploadedPromptAttachment = z.infer<typeof uploadedPromptAttachmentSchema>

export type ThreadResponse = {
  projectId: string
  title: string | null
  titleFallback: string | null
}
