import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from 'react'
import { getSystemFileManagerName } from '@/features/agent/lib/system-file-manager'
import { serializeComposerText, type ComposerMentionToken } from '@/features/agent/lib/composer-mentions'
import type { AgentPromptAttachment } from '@/features/agent/types'

const IMAGE_ATTACHMENT_EXTENSIONS = /\.(?:png|jpe?g|webp|gif)$/i
const IMAGE_ATTACHMENT_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MAX_COMPOSER_ATTACHMENTS = 12

export type AgentComposerState = {
  mentions: ComposerMentionToken[]
  value: string
}

export type AgentComposerAttachment = AgentPromptAttachment & {
  id: string
}

export type AgentComposerClearToken = {
  id: number
  revision: number
}

export type AgentComposerSnapshot = {
  attachments: AgentComposerAttachment[]
  state: AgentComposerState
}

export const EMPTY_AGENT_COMPOSER_STATE: AgentComposerState = {
  mentions: [],
  value: '',
}

export function hasAgentComposerPayload(
  composerState: AgentComposerState,
  composerAttachments: AgentComposerAttachment[],
) {
  return Boolean(
    serializeComposerText(composerState.value, composerState.mentions).trim()
    || composerAttachments.length > 0
  )
}

function isAgentComposerPristineEmpty(
  composerState: AgentComposerState,
  composerAttachments: AgentComposerAttachment[],
) {
  return (
    composerState.value === ''
    && composerState.mentions.length === 0
    && composerAttachments.length === 0
  )
}

function isImageAttachment(fileName: string, mimeType?: string) {
  return Boolean(
    mimeType
      ? IMAGE_ATTACHMENT_MIME_TYPES.has(mimeType.toLowerCase())
      : IMAGE_ATTACHMENT_EXTENSIONS.test(fileName),
  )
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => {
      reject(new Error(`Unable to read ${file.name}.`))
    }
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error(`Unable to read ${file.name}.`))
    }
    reader.readAsDataURL(file)
  })
}

async function buildComposerAttachmentFromFile(file: File): Promise<AgentComposerAttachment> {
  const kind = isImageAttachment(file.name, file.type) ? 'image' : 'file'
  const data = kind === 'image' ? await readFileAsDataUrl(file) : undefined
  const filePath = window.appApi.getFilePath(file).trim()

  if (kind !== 'image' && !filePath) {
    throw new Error(`普通文件需要来自本地磁盘路径。请使用附件按钮选择文件，或从${getSystemFileManagerName(window.appApi.platform)}拖入文件。`)
  }

  return {
    id: `${Date.now()}-${crypto.randomUUID()}`,
    ...(data ? { data } : {}),
    fileName: file.name,
    kind,
    ...(file.type ? { mimeType: file.type } : {}),
    ...(filePath ? { path: filePath } : {}),
    size: file.size,
  }
}

export function useAgentComposerDraft({
  onErrorChange,
}: {
  onErrorChange: (error: string | null) => void
}) {
  const [composerState, setComposerStateValue] = useState<AgentComposerState>(EMPTY_AGENT_COMPOSER_STATE)
  const [composerAttachments, setComposerAttachmentsValue] = useState<AgentComposerAttachment[]>([])
  const composerStateRef = useRef<AgentComposerState>(EMPTY_AGENT_COMPOSER_STATE)
  const composerAttachmentsRef = useRef<AgentComposerAttachment[]>([])
  const composerRevisionRef = useRef(0)
  const optimisticClearIdRef = useRef(0)

  const setComposerState = useCallback<Dispatch<SetStateAction<AgentComposerState>>>((nextState) => {
    const resolvedState = typeof nextState === 'function'
      ? nextState(composerStateRef.current)
      : nextState
    if (composerStateRef.current !== resolvedState) {
      composerRevisionRef.current += 1
    }
    composerStateRef.current = resolvedState
    setComposerStateValue(resolvedState)
  }, [])

  const setComposerAttachments = useCallback<Dispatch<SetStateAction<AgentComposerAttachment[]>>>((nextAttachments) => {
    const resolvedAttachments = typeof nextAttachments === 'function'
      ? nextAttachments(composerAttachmentsRef.current)
      : nextAttachments
    if (composerAttachmentsRef.current !== resolvedAttachments) {
      composerRevisionRef.current += 1
    }
    composerAttachmentsRef.current = resolvedAttachments
    setComposerAttachmentsValue(resolvedAttachments)
  }, [])

  function clearComposerOptimistically() {
    const clearId = optimisticClearIdRef.current + 1
    optimisticClearIdRef.current = clearId
    setComposerState(EMPTY_AGENT_COMPOSER_STATE)
    setComposerAttachments([])
    return {
      id: clearId,
      revision: composerRevisionRef.current,
    }
  }

  function invalidateOptimisticComposerClear(clearToken: AgentComposerClearToken | null) {
    if (clearToken !== null && optimisticClearIdRef.current === clearToken.id) {
      optimisticClearIdRef.current += 1
    }
  }

  function restoreOptimisticallyClearedComposer(
    clearToken: AgentComposerClearToken | null,
    snapshot: AgentComposerSnapshot,
  ) {
    if (
      clearToken === null
      || optimisticClearIdRef.current !== clearToken.id
      || composerRevisionRef.current !== clearToken.revision
      || !isAgentComposerPristineEmpty(composerStateRef.current, composerAttachmentsRef.current)
    ) {
      return
    }

    invalidateOptimisticComposerClear(clearToken)
    setComposerState(snapshot.state)
    setComposerAttachments(snapshot.attachments)
  }

  function appendComposerAttachments(nextAttachments: AgentComposerAttachment[]) {
    if (nextAttachments.length === 0) {
      return
    }

    setComposerAttachments((currentAttachments) => {
      const uniqueAttachments = nextAttachments.filter((attachment) => !currentAttachments.some((currentAttachment) => (
        currentAttachment.fileName === attachment.fileName
        && currentAttachment.size === attachment.size
        && currentAttachment.path === attachment.path
      )))

      return [...currentAttachments, ...uniqueAttachments].slice(0, MAX_COMPOSER_ATTACHMENTS)
    })
  }

  async function addComposerFiles(files: File[]) {
    if (files.length === 0) {
      return
    }

    try {
      onErrorChange(null)
      const nextAttachments = await Promise.all(
        files.slice(0, MAX_COMPOSER_ATTACHMENTS).map(buildComposerAttachmentFromFile),
      )
      appendComposerAttachments(nextAttachments)
    } catch (error) {
      onErrorChange(error instanceof Error ? error.message : 'Unable to attach the selected file.')
    }
  }

  async function handlePickComposerAttachments() {
    try {
      onErrorChange(null)
      const pickedAttachments = await window.appApi.pickAgentAttachments()
      appendComposerAttachments(pickedAttachments.map((attachment) => ({
        ...attachment,
        id: `${Date.now()}-${crypto.randomUUID()}`,
      })))
    } catch (error) {
      onErrorChange(error instanceof Error ? error.message : 'Unable to attach files.')
    }
  }

  function removeComposerAttachment(attachmentId: string) {
    setComposerAttachments((currentAttachments) => (
      currentAttachments.filter((attachment) => attachment.id !== attachmentId)
    ))
  }

  return {
    addComposerFiles,
    clearComposerOptimistically,
    composerAttachments,
    composerAttachmentsRef,
    composerState,
    composerStateRef,
    handlePickComposerAttachments,
    invalidateOptimisticComposerClear,
    removeComposerAttachment,
    restoreOptimisticallyClearedComposer,
    setComposerAttachments,
    setComposerState,
  }
}
