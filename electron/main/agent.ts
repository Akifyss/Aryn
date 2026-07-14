import { createHash } from 'node:crypto'
import { lstat, open as openFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import {
  AuthStorage,
  createAgentSession,
  formatDimensionNote,
  ModelRegistry,
  resizeImage,
  SessionManager,
  SettingsManager,
  type SessionEntry,
  type AgentSession,
} from '@earendil-works/pi-coding-agent'
import { clampThinkingLevel, complete, getEnvApiKey, getSupportedThinkingLevels, type Api, type AssistantMessage, type ImageContent, type Model, type TextContent, type ToolResultMessage, type UserMessage } from '@earendil-works/pi-ai'
import type {
  AgentMessageAttachment,
  AgentMessageFileChange,
  AgentClientEventPayload,
  AgentPromptAttachment,
  AgentProviderAuthState,
  AgentQueuedMessageUpdate,
  AgentRunningPromptBehavior,
  AgentSessionCreateOptions,
  AgentRuntimeState,
  AgentSessionListItem,
  AgentSessionSnapshot,
  AgentSidebarMessage,
  AgentWorkspaceState,
  PiWebAgentMessage,
} from '../../src/features/agent/types'
import {
  AGENT_PROVIDER_AUTH_CONFIGS,
  getAgentProviderAuthConfig,
  getAgentProviderOrder,
  type AgentProviderAuthConfig,
} from '../../src/features/agent/provider-auth'
import { AgentSessionAnnotationStore } from './agent-session-annotations'
import {
  collectDirectToolPathsByEntryId,
  extractExplicitBashFileChanges,
  extractWritableToolFilePath,
  filterAnnotationsByDirectToolPaths,
  resolveDirectToolFileChangeKind,
} from './agent-file-change-extractor'

type ActiveSessionRuntime = {
  activity: {
    pendingAssistantEntryId: string | null
    runningToolCalls: Map<string, {
      existedBeforeWrite: boolean | null
      filePath: string | null
      ownerEntryId: string | null
      parsedFileChanges: AgentMessageFileChange[]
      toolName: string
    }>
  }
  cwd: string
  session: AgentSession
  status: {
    compactionReason: 'manual' | 'overflow' | 'threshold' | null
    retryMaxAttempts: number | null
  }
  unsubscribe: () => void
}

type PiAgentManagerOptions = {
  agentDir: string
}

type LoadAgentWorkspaceStateOptions = {
  restoreSession?: boolean
}

const SESSION_HEADER_READ_CHUNK_BYTES = 4096
const SESSION_HEADER_READ_LIMIT_BYTES = 64 * 1024

function getWorkspacePathIdentity(workspacePath: string) {
  const normalizedPath = path.resolve(workspacePath)
  return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath
}

function areSameWorkspacePath(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && getWorkspacePathIdentity(left) === getWorkspacePathIdentity(right))
}

export function getArynPiSessionDir(cwd: string, agentDir: string) {
  const workspaceIdentity = getWorkspacePathIdentity(cwd)
  const workspaceName = path.basename(workspaceIdentity) || 'workspace'
  const safeWorkspaceName = workspaceName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/[. ]+$/, '')
    .replace(/^\.+$/, '')
    .trim()
    .slice(0, 48) || 'workspace'
  const workspaceHash = createHash('sha256')
    .update(workspaceIdentity)
    .digest('hex')
    .slice(0, 16)

  return path.join(agentDir, 'sessions', `${safeWorkspaceName}-${workspaceHash}`)
}

function getLegacyArynPiSessionDir(cwd: string, agentDir: string) {
  const workspaceIdentity = getWorkspacePathIdentity(cwd)
  const safePath = `--${workspaceIdentity.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  return path.join(agentDir, 'sessions', safePath)
}

type PreparedPromptAttachments = {
  images: ImageContent[]
  text: string
}
type AgentQueuedMessageKind = AgentRunningPromptBehavior
type AgentQueueSnapshot = {
  followUp: string[]
  steering: string[]
}
type NormalizedCreateSessionOptions = {
  modelKey: string | null
  name: string | null
  thinkingLevel: ThinkingLevel | null
}
type AgentProviderAuthPrompt = {
  allowEmpty?: boolean
  message: string
  placeholder?: string
}
type AgentProviderAuthLoginCallbacks = {
  emitAuth: (provider: string, info: { instructions?: string, url: string }) => void
  emitComplete: (provider: string, ok: boolean, message?: string) => void
  emitProgress: (provider: string, message: string) => void
  openExternal: (url: string) => Promise<void>
  requestInput: (provider: string, prompt: AgentProviderAuthPrompt) => Promise<string>
  signal?: AbortSignal
}

export function applyAgentQueuedMessageUpdate(
  queue: AgentQueueSnapshot,
  update: AgentQueuedMessageUpdate,
): AgentQueueSnapshot {
  validateAgentQueuedMessageUpdate(update, queue)

  const nextQueue: AgentQueueSnapshot = {
    followUp: [...queue.followUp],
    steering: [...queue.steering],
  }
  const sourceQueue = getAgentQueueMessages(nextQueue, update.kind)
  const [message] = sourceQueue.splice(update.index, 1)

  if (!message) {
    throw new Error('Queued message has already been processed.')
  }

  if (update.action === 'edit') {
    sourceQueue.splice(update.index, 0, update.text.trim())
  } else if (update.action === 'move') {
    getAgentQueueMessages(nextQueue, update.targetKind).push(message)
  }

  return nextQueue
}

function getAgentQueueMessages(queue: AgentQueueSnapshot, kind: AgentQueuedMessageKind) {
  return kind === 'steer' ? queue.steering : queue.followUp
}

function validateAgentQueuedMessageUpdate(update: AgentQueuedMessageUpdate, queue: AgentQueueSnapshot) {
  if (update.kind !== 'steer' && update.kind !== 'followUp') {
    throw new Error('Unknown queued message type.')
  }

  if (update.action !== 'delete' && update.action !== 'edit' && update.action !== 'move') {
    throw new Error('Unknown queued message action.')
  }

  if (!Number.isInteger(update.index) || update.index < 0) {
    throw new Error('Queued message index is invalid.')
  }

  if (!update.expectedText.trim()) {
    throw new Error('Queued message text is empty.')
  }

  if (update.action === 'edit' && !update.text.trim()) {
    throw new Error('Queued message cannot be empty.')
  }

  if (update.action === 'move' && update.targetKind !== 'steer' && update.targetKind !== 'followUp') {
    throw new Error('Unknown queued message target.')
  }

  const messages = getAgentQueueMessages(queue, update.kind)

  if (messages[update.index] !== update.expectedText) {
    throw new Error('Queued message changed before this action completed. Please try again.')
  }
}

const OPENROUTER_ENV_KEY = 'OPENROUTER_API_KEY'
const OPENROUTER_PROVIDER = 'openrouter'
const OPENAI_ENV_KEY = 'OPENAI_API_KEY'
const GOOGLE_ENV_KEY = 'GEMINI_API_KEY'
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] satisfies ThinkingLevel[]
const AUTO_SESSION_NAME_MODEL_ID = 'openrouter/free'
const AUTO_SESSION_NAME_MAX_TOKENS = 48
const AGENT_PROMPT_ATTACHMENT_PREFIX = 'Attachments:'
const MAX_PROMPT_ATTACHMENTS = 12
const MAX_IMAGE_ATTACHMENT_BYTES = 12 * 1024 * 1024
const AUTH_SETUP_HINT = `No authenticated models are available. Add a provider credential in Settings > Providers, log in to a subscription provider, or set a supported Pi provider environment variable such as ${OPENROUTER_ENV_KEY}, ${OPENAI_ENV_KEY}, or ${GOOGLE_ENV_KEY}.`
const AUTO_SESSION_NAME_SYSTEM_PROMPT = [
  'You generate short chat session titles.',
  'Reply with title text only.',
  'Use the same language as the user when possible.',
  'Do not use quotes, markdown, labels, prefixes, numbering, or ending punctuation.',
  'Keep it compact and specific.',
].join(' ')
const AUTO_SESSION_NAME_MODEL: Model<Api> = {
  api: 'openai-completions',
  baseUrl: 'https://openrouter.ai/api/v1',
  contextWindow: 200000,
  cost: {
    cacheRead: 0,
    cacheWrite: 0,
    input: 0,
    output: 0,
  },
  id: AUTO_SESSION_NAME_MODEL_ID,
  input: ['text'],
  maxTokens: 256,
  name: 'OpenRouter Free Router',
  provider: OPENROUTER_PROVIDER,
  reasoning: false,
}

let piDefaultModelPerProviderPromise: Promise<Record<string, string>> | null = null

function loadPiDefaultModelPerProvider() {
  piDefaultModelPerProviderPromise ??= (async () => {
    try {
      const piEntryPath = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))
      const resolverPath = path.join(path.dirname(piEntryPath), 'core', 'model-resolver.js')
      const resolverModule = await import(pathToFileURL(resolverPath).href) as {
        defaultModelPerProvider?: Record<string, string>
      }

      return resolverModule.defaultModelPerProvider ?? {}
    } catch {
      return {}
    }
  })()

  return piDefaultModelPerProviderPromise
}

function selectProviderPreferredModel(
  availableModels: Model<Api>[],
  defaultModelPerProvider: Record<string, string>,
  provider: string,
) {
  const providerModels = availableModels.filter((model) => model.provider === provider)

  if (providerModels.length === 0) {
    return null
  }

  const defaultModelId = defaultModelPerProvider[provider]
  return providerModels.find((model) => model.id === defaultModelId) ?? providerModels[0]
}

function selectPiPreferredModel(
  availableModels: Model<Api>[],
  settingsManager: SettingsManager,
  defaultModelPerProvider: Record<string, string>,
) {
  const preferredProvider = settingsManager.getDefaultProvider()
  const preferredModel = settingsManager.getDefaultModel()

  if (preferredProvider && preferredModel) {
    const preferredSelection = availableModels.find((model) => model.provider === preferredProvider && model.id === preferredModel)

    if (preferredSelection) {
      return preferredSelection
    }
  }

  for (const [provider, modelId] of Object.entries(defaultModelPerProvider)) {
    const defaultSelection = availableModels.find((model) => model.provider === provider && model.id === modelId)

    if (defaultSelection) {
      return defaultSelection
    }
  }

  return availableModels[0] ?? null
}

function getProviderPreferredModelKeys(
  availableModels: Model<Api>[],
  defaultModelPerProvider: Record<string, string>,
) {
  const modelKeys: Record<string, string> = {}
  const providers = Array.from(new Set(availableModels.map((model) => model.provider)))

  for (const provider of providers) {
    const selectedModel = selectProviderPreferredModel(availableModels, defaultModelPerProvider, provider)

    if (selectedModel) {
      modelKeys[provider] = `${selectedModel.provider}/${selectedModel.id}`
    }
  }

  return modelKeys
}

export function getThinkingLevelsByModel(availableModels: Model<Api>[]) {
  const levelsByModel: Record<string, ThinkingLevel[]> = {}

  for (const model of availableModels) {
    levelsByModel[`${model.provider}/${model.id}`] = getSupportedThinkingLevels(model)
  }

  return levelsByModel
}

function getInputsByModel(availableModels: Model<Api>[]) {
  const inputsByModel: Record<string, Array<'text' | 'image'>> = {}

  for (const model of availableModels) {
    inputsByModel[`${model.provider}/${model.id}`] = [...model.input]
  }

  return inputsByModel
}

function isThinkingLevel(value: string): value is ThinkingLevel {
  return THINKING_LEVELS.includes(value as ThinkingLevel)
}

function asText(value: string | Array<TextContent | ImageContent>) {
  if (typeof value === 'string') {
    return value.trim()
  }

  return value
    .map((block) => {
      if (block.type === 'text') {
        return block.text
      }

      return '[Image attachment]'
    })
    .join('\n')
    .trim()
}

function stripDataUrlPrefix(value: string) {
  const trimmedValue = value.trim()
  const dataUrlMatch = trimmedValue.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/is)

  if (!dataUrlMatch) {
    return trimmedValue
  }

  return dataUrlMatch[2]?.trim() ?? ''
}

function getDataUrlMimeType(value: string) {
  return value.trim().match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,/i)?.[1]?.toLowerCase() ?? null
}

function normalizePromptAttachment(value: unknown): AgentPromptAttachment | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const attachment = value as Partial<AgentPromptAttachment>
  const fileName = typeof attachment.fileName === 'string' ? attachment.fileName.trim() : ''
  const pathValue = typeof attachment.path === 'string' ? attachment.path.trim() : undefined
  const dataValue = typeof attachment.data === 'string' ? attachment.data.trim() : undefined

  if (!fileName && !pathValue) {
    return null
  }

  const mimeType = typeof attachment.mimeType === 'string' && attachment.mimeType.trim()
    ? attachment.mimeType.trim().toLowerCase()
    : dataValue
      ? getDataUrlMimeType(dataValue) ?? undefined
      : undefined
  const kind = attachment.kind === 'image' || mimeType?.startsWith('image/')
    ? 'image'
    : 'file'
  const normalizedSize = typeof attachment.size === 'number' && Number.isFinite(attachment.size) && attachment.size >= 0
    ? attachment.size
    : undefined

  return {
    ...(dataValue ? { data: dataValue } : {}),
    fileName: fileName || path.basename(pathValue ?? 'attachment'),
    kind,
    ...(mimeType ? { mimeType } : {}),
    ...(pathValue ? { path: pathValue } : {}),
    ...(normalizedSize !== undefined ? { size: normalizedSize } : {}),
  }
}

function normalizePromptAttachments(attachments: unknown): AgentPromptAttachment[] {
  if (!Array.isArray(attachments)) {
    return []
  }

  return attachments
    .map(normalizePromptAttachment)
    .filter((attachment): attachment is AgentPromptAttachment => Boolean(attachment))
    .slice(0, MAX_PROMPT_ATTACHMENTS)
}

function serializeAttachmentReference(attachment: AgentMessageAttachment) {
  const reference = {
    fileName: attachment.fileName,
    kind: attachment.kind,
    ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    ...(attachment.path ? { path: attachment.path } : {}),
    ...(attachment.size !== undefined ? { size: attachment.size } : {}),
    ...(attachment.status ? { status: attachment.status } : {}),
  }

  return `- ${JSON.stringify(reference)}`
}

function isJsonAttachmentReferenceLine(line: string) {
  return line.trim().slice(2).trim().startsWith('{')
}

function parseAttachmentReferenceLine(line: string): AgentMessageAttachment | null {
  const trimmedLine = line.trim()

  if (!trimmedLine.startsWith('- ')) {
    return null
  }

  const payload = trimmedLine.slice(2).trim()

  if (payload.startsWith('{')) {
    try {
      const parsed = JSON.parse(payload) as Partial<AgentMessageAttachment>
      const fileName = typeof parsed.fileName === 'string' ? parsed.fileName.trim() : ''
      const kind = parsed.kind === 'image' ? 'image' : 'file'
      const mimeType = typeof parsed.mimeType === 'string' ? parsed.mimeType.trim() : ''
      const pathValue = typeof parsed.path === 'string' ? parsed.path.trim() : ''
      const size = typeof parsed.size === 'number' && Number.isFinite(parsed.size) && parsed.size >= 0
        ? parsed.size
        : undefined
      const status = parsed.status === 'sent' || parsed.status === 'omitted' || parsed.status === 'referenced'
        ? parsed.status
        : 'referenced'

      if (!fileName) {
        return null
      }

      return {
        fileName,
        kind,
        ...(mimeType ? { mimeType } : {}),
        ...(pathValue ? { path: pathValue } : {}),
        ...(size !== undefined ? { size } : {}),
        status,
      }
    } catch {
      // Fall back to the legacy human-readable format below.
    }
  }

  const label = payload.split(' (')[0]?.trim()
  const pathMatch = line.match(/path:\s*([^,)]+)/)
  const isImage = /\bimage\b/i.test(line)
  const status = /not sent as image|too large/i.test(line)
    ? 'omitted'
    : 'referenced'

  return label
    ? {
        fileName: label,
        kind: isImage ? 'image' : 'file',
        ...(pathMatch?.[1] ? { path: pathMatch[1].trim() } : {}),
        status,
      }
    : null
}

function appendAttachmentText(prompt: string, attachmentText: string) {
  const trimmedAttachmentText = attachmentText.trim()

  if (!trimmedAttachmentText) {
    return prompt.trim()
  }

  return `${prompt.trim()}\n\n${AGENT_PROMPT_ATTACHMENT_PREFIX}\n${trimmedAttachmentText}`.trim()
}

async function preparePromptAttachments(
  attachments: AgentPromptAttachment[],
  model: Model<Api>,
): Promise<PreparedPromptAttachments> {
  const images: ImageContent[] = []
  const textLines: string[] = []
  const supportsImages = model.input.includes('image')

  for (const attachment of attachments) {
    if (attachment.kind !== 'image' && !attachment.path) {
      throw new Error(`Attachment "${attachment.fileName}" does not have a readable file path.`)
    }

    if (attachment.path && !(await pathExists(attachment.path))) {
      throw new Error(`Attachment "${attachment.fileName}" does not exist at ${attachment.path}.`)
    }

    const baseMetadata: AgentMessageAttachment = {
      fileName: attachment.fileName,
      kind: attachment.kind,
      ...(attachment.data ? { data: attachment.data } : {}),
      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
      ...(attachment.path ? { path: attachment.path } : {}),
      ...(attachment.size !== undefined ? { size: attachment.size } : {}),
    }

    if (attachment.kind === 'image' && attachment.data) {
      const imageData = stripDataUrlPrefix(attachment.data)
      const mimeType = attachment.mimeType ?? getDataUrlMimeType(attachment.data) ?? 'image/png'
      const encodedSize = Buffer.byteLength(imageData, 'utf-8')

      if (!supportsImages) {
        const omittedMetadata: AgentMessageAttachment = {
          ...baseMetadata,
          mimeType,
          status: 'omitted',
        }
        textLines.push(serializeAttachmentReference(omittedMetadata))
        continue
      }

      if (encodedSize > MAX_IMAGE_ATTACHMENT_BYTES) {
        const omittedMetadata: AgentMessageAttachment = {
          ...baseMetadata,
          mimeType,
          status: 'omitted',
        }
        textLines.push(serializeAttachmentReference(omittedMetadata))
        continue
      }

      const resizedImage = await resizeImage({ type: 'image', data: imageData, mimeType })
      const image = resizedImage
        ? { type: 'image' as const, data: resizedImage.data, mimeType: resizedImage.mimeType }
        : { type: 'image' as const, data: imageData, mimeType }
      const sentMetadata: AgentMessageAttachment = {
        ...baseMetadata,
        mimeType: image.mimeType,
        status: 'sent',
      }

      images.push(image)

      const dimensionNote = resizedImage ? formatDimensionNote(resizedImage) : undefined
      textLines.push(serializeAttachmentReference(sentMetadata))
      if (dimensionNote) {
        textLines.push(`  ${dimensionNote}`)
      }
      continue
    }

    const referencedMetadata: AgentMessageAttachment = {
      ...baseMetadata,
      status: 'referenced',
    }
    textLines.push(serializeAttachmentReference(referencedMetadata))
  }

  return {
    images,
    text: textLines.join('\n'),
  }
}

function extractPromptAttachmentsFromMessage(message: UserMessage): AgentMessageAttachment[] {
  const text = asText(message.content)
  const attachmentStart = text.indexOf(`\n\n${AGENT_PROMPT_ATTACHMENT_PREFIX}\n`)
  const attachmentSection = attachmentStart >= 0
    ? text.slice(attachmentStart + AGENT_PROMPT_ATTACHMENT_PREFIX.length + 3)
    : text.startsWith(`${AGENT_PROMPT_ATTACHMENT_PREFIX}\n`)
      ? text.slice(AGENT_PROMPT_ATTACHMENT_PREFIX.length + 1)
      : ''
  const contentImages = typeof message.content === 'string'
    ? []
    : message.content.filter((block): block is ImageContent => block.type === 'image')
  let parsedImageIndex = 0
  const textAttachments: AgentMessageAttachment[] = []

  for (const line of attachmentSection.split('\n')) {
    if (!line.trim().startsWith('- ')) {
      continue
    }

    const isJsonReference = isJsonAttachmentReferenceLine(line)
    const attachment = parseAttachmentReferenceLine(line)

    if (!attachment) {
      continue
    }

    const shouldConsumeImageBlock = attachment.kind === 'image'
      && (
        attachment.status === 'sent'
        || (!isJsonReference && attachment.status !== 'omitted')
      )
      && Boolean(contentImages[parsedImageIndex])

    if (shouldConsumeImageBlock) {
      const matchedImage = contentImages[parsedImageIndex]
      parsedImageIndex += 1
      textAttachments.push({
        ...attachment,
        data: `data:${matchedImage.mimeType};base64,${matchedImage.data}`,
        mimeType: attachment.mimeType ?? matchedImage.mimeType,
        status: 'sent',
      })
      continue
    }

    textAttachments.push(attachment)
  }

  if (typeof message.content === 'string') {
    return textAttachments
  }

  const imageAttachments = contentImages
    .slice(parsedImageIndex)
    .map((block, index): AgentMessageAttachment => ({
      data: `data:${block.mimeType};base64,${block.data}`,
      fileName: `Image ${parsedImageIndex + index + 1}`,
      kind: 'image',
      mimeType: block.mimeType,
      status: 'sent',
    }))

  return [...textAttachments, ...imageAttachments]
}

function clampText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1)}...`
}

function stringifyForDisplay(value: unknown) {
  if (value == null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function summarizeToolPayload(value: unknown, maxLength: number, fallback: string) {
  const summary = clampText(stringifyForDisplay(value), maxLength)
  return summary || fallback
}

function extractAssistantText(message: AssistantMessage) {
  return message.content
    .filter((block): block is Extract<AssistantMessage['content'][number], { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

function stripMarkdownNoise(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[>\-*+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function trimSessionTitleLength(value: string) {
  const normalizedValue = value.trim()
  const maxLength = /[\u4e00-\u9fff]/u.test(normalizedValue) ? 18 : 48
  return normalizedValue.length > maxLength ? normalizedValue.slice(0, maxLength).trim() : normalizedValue
}

function normalizeSessionTitle(value: string) {
  const normalizedLine = value
    .replace(/^\s*["'`]+/, '')
    .replace(/["'`]+$/, '')
    .replace(/^\s*(title|session title|标题)\s*[:：-]\s*/i, '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)

  if (!normalizedLine) {
    return null
  }

  const compactTitle = trimSessionTitleLength(
    normalizedLine
      .replace(/[。！？!?;；:：,，、]+$/u, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )

  if (!compactTitle) {
    return null
  }

  const lowerTitle = compactTitle.toLowerCase()

  if (
    lowerTitle === 'untitled'
    || lowerTitle === 'untitled session'
    || lowerTitle === 'new session'
  ) {
    return null
  }

  return compactTitle
}

function buildFallbackSessionTitle(sourceText: string) {
  const normalizedSource = stripMarkdownNoise(sourceText)

  if (!normalizedSource) {
    return null
  }

  const firstSegment = normalizedSource
    .split(/[\n。！？!?]/u)
    .map((segment) => segment.trim())
    .find(Boolean)
    ?? normalizedSource

  const simplifiedSegment = firstSegment
    .replace(/^(请|帮我|我想|想要|希望|需要|麻烦|能否|可以|怎么|如何)\s*/u, '')
    .trim()

  return normalizeSessionTitle(simplifiedSegment || normalizedSource)
}

function getAutoNamingContext(entries: SessionEntry[]) {
  let firstUserText: string | null = null
  let firstAssistantText: string | null = null
  let userMessageCount = 0

  for (const entry of entries) {
    if (entry.type !== 'message') {
      continue
    }

    const { message } = entry

    if ('role' in message && message.role === 'user') {
      userMessageCount += 1

      if (!firstUserText) {
        firstUserText = asText(message.content)
      }

      continue
    }

    if ('role' in message && message.role === 'assistant' && !firstAssistantText) {
      firstAssistantText = extractAssistantText(message)
    }
  }

  if (!firstUserText?.trim()) {
    return null
  }

  return {
    firstAssistantText: firstAssistantText?.trim() || null,
    firstUserText: firstUserText.trim(),
    userMessageCount,
  }
}

type SerializedBranchMessage = AgentSidebarMessage & {
  entryId?: string
}

function formatToolPayloadSection(label: string, value: string) {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return ''
  }

  return `**${label}**\n\`\`\`\n${trimmedValue}\n\`\`\``
}

function formatToolMessageText(argumentsValue: unknown, resultText?: string) {
  const sections: string[] = []
  const argumentText = stringifyForDisplay(argumentsValue).trim()
  const normalizedResultText = resultText?.trim() ?? ''

  if (argumentText) {
    sections.push(formatToolPayloadSection('Arguments', argumentText))
  }

  if (normalizedResultText) {
    sections.push(argumentText ? `**Result**\n${normalizedResultText}` : normalizedResultText)
  }

  return sections.join('\n\n').trim()
}

function serializeAssistantMessage(message: AssistantMessage, index: number): AgentSidebarMessage | null {
  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()

  const thinkingText = message.content
    .filter((block) => block.type === 'thinking')
    .map((block) => block.thinking)
    .join('\n')
    .trim()

  const toolCalls = message.content
    .filter((block) => block.type === 'toolCall')
    .map((block) => block.name)

  if (!text && toolCalls.length > 0 && !message.errorMessage) {
    return null
  }

  const fallbackText = message.errorMessage ?? (thinkingText ? '' : 'Assistant response')

  return {
    id: `assistant-${message.timestamp}-${index}`,
    kind: 'assistant',
    thinkingText: thinkingText || undefined,
    text: text || fallbackText,
    timestamp: message.timestamp,
    isError: message.stopReason === 'error',
  }
}

async function pathExists(targetPath: string) {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

function serializeUserMessage(message: UserMessage, index: number): AgentSidebarMessage {
  const attachments = extractPromptAttachmentsFromMessage(message)

  return {
    id: `user-${message.timestamp}-${index}`,
    kind: 'user',
    ...(attachments.length > 0 ? { attachments } : {}),
    text: asText(message.content).split(`\n\n${AGENT_PROMPT_ATTACHMENT_PREFIX}\n`)[0]?.trim() || 'User message',
    timestamp: message.timestamp,
  }
}

function serializeToolResult(message: ToolResultMessage, index: number): AgentSidebarMessage {
  const text = asText(message.content) || stringifyForDisplay(message.details) || 'Tool finished without output.'

  return {
    id: message.toolCallId || `tool-${message.timestamp}-${index}`,
    kind: 'tool',
    status: message.isError ? 'error' : 'done',
    title: message.toolName,
    text,
    timestamp: message.timestamp,
    isError: message.isError,
  }
}

function serializeCustomMessage(message: Extract<AgentMessage, { role: 'bashExecution' | 'branchSummary' | 'compactionSummary' | 'custom' }>, index: number): AgentSidebarMessage | null {
  if (message.role === 'custom' && !message.display) {
    return null
  }

  if (message.role === 'bashExecution') {
    const output = message.output.trim() || 'Command completed without output.'
    return {
      id: `bash-${message.timestamp}-${index}`,
      kind: 'system',
      title: message.command,
      text: output,
      timestamp: message.timestamp,
      isError: typeof message.exitCode === 'number' ? message.exitCode !== 0 : false,
    }
  }

  if (message.role === 'branchSummary') {
    return {
      id: `branch-summary-${message.timestamp}-${index}`,
      kind: 'system',
      title: 'Branch summary',
      text: message.summary,
      timestamp: message.timestamp,
    }
  }

  if (message.role === 'compactionSummary') {
    return {
      id: `compaction-summary-${message.timestamp}-${index}`,
      kind: 'system',
      title: 'Context summary',
      text: message.summary,
      timestamp: message.timestamp,
    }
  }

  return {
    id: `custom-${message.timestamp}-${index}`,
    kind: 'custom',
    title: message.customType,
    text: asText(message.content) || message.customType,
    timestamp: message.timestamp,
  }
}

function serializeMessage(message: AgentMessage, index: number): AgentSidebarMessage | null {
  if ('role' in message && message.role === 'user') {
    return serializeUserMessage(message, index)
  }

  if ('role' in message && message.role === 'assistant') {
    return serializeAssistantMessage(message, index)
  }

  if ('role' in message && message.role === 'toolResult') {
    return serializeToolResult(message, index)
  }

  if (
    'role' in message
    && (
      message.role === 'bashExecution'
      || message.role === 'branchSummary'
      || message.role === 'compactionSummary'
      || message.role === 'custom'
    )
  ) {
    return serializeCustomMessage(message, index)
  }

  return null
}

function parseEntryTimestamp(value: string) {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Date.now() : parsed
}

/**
 * Preserve pi's native message model for the vendored pi-web renderer. This is
 * the same full-branch UI conversion used by pi-web's session-reader: unlike
 * buildSessionContext it intentionally keeps history before compaction.
 */
export function serializePiWebSessionEntries(entries: SessionEntry[]) {
  const messages: PiWebAgentMessage[] = []
  const entryIds: string[] = []

  for (const entry of entries) {
    let message: PiWebAgentMessage | null = null
    if (entry.type === 'message') {
      message = entry.message as unknown as PiWebAgentMessage
    } else if (entry.type === 'compaction') {
      message = {
        role: 'custom',
        customType: 'compaction',
        content: entry.summary,
        display: true,
        details: {
          tokensBefore: entry.tokensBefore,
          firstKeptEntryId: entry.firstKeptEntryId,
        },
        timestamp: parseEntryTimestamp(entry.timestamp),
      }
    } else if (entry.type === 'branch_summary' && entry.summary) {
      message = {
        role: 'user',
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
        timestamp: parseEntryTimestamp(entry.timestamp),
      }
    } else if (entry.type === 'custom_message') {
      message = {
        role: 'custom',
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        timestamp: parseEntryTimestamp(entry.timestamp),
      }
    }

    if (message) {
      messages.push(message)
      entryIds.push(entry.id)
    }
  }

  return { entryIds, messages }
}

function pushSerializedMessage(
  messages: SerializedBranchMessage[],
  entryMessages: Map<string, SerializedBranchMessage>,
  message: SerializedBranchMessage,
) {
  messages.push(message)

  if (message.entryId) {
    entryMessages.set(message.entryId, message)
  }
}

export function serializeSessionEntries(entries: SessionEntry[]) {
  const messages: SerializedBranchMessage[] = []
  const entryMessages = new Map<string, SerializedBranchMessage>()
  const toolArguments = new Map<string, unknown>()
  const toolMessages = new Map<string, SerializedBranchMessage>()

  entries.forEach((entry, index) => {
    const timestamp = parseEntryTimestamp(entry.timestamp)

    switch (entry.type) {
      case 'message': {
        const message = entry.message

        if ('role' in message && message.role === 'user') {
          pushSerializedMessage(messages, entryMessages, {
            ...serializeUserMessage(message, index),
            entryId: entry.id,
          })
          return
        }

        if ('role' in message && message.role === 'assistant') {
          const assistantMessage = serializeAssistantMessage(message, index)
          let labelTarget: SerializedBranchMessage | null = assistantMessage
            ? {
                ...assistantMessage,
                entryId: entry.id,
              }
            : null

          if (labelTarget) {
            pushSerializedMessage(messages, entryMessages, labelTarget)
          }

          message.content
            .filter((block) => block.type === 'toolCall')
            .forEach((toolCall, toolIndex) => {
              const toolMessage: SerializedBranchMessage = {
                id: toolCall.id || `tool-call-${entry.id}-${toolIndex}`,
                kind: 'tool',
                status: 'running',
                text: formatToolMessageText(toolCall.arguments) || 'Tool was called without arguments.',
                timestamp,
                title: toolCall.name,
              }

              if (!labelTarget) {
                toolMessage.entryId = entry.id
                labelTarget = toolMessage
              }

              pushSerializedMessage(messages, entryMessages, toolMessage)

              if (toolCall.id) {
                toolArguments.set(toolCall.id, toolCall.arguments)
                toolMessages.set(toolCall.id, toolMessage)
              }
            })

          return
        }

        if ('role' in message && message.role === 'toolResult') {
          const resultText = asText(message.content) || stringifyForDisplay(message.details) || 'Tool finished without output.'
          const existingToolMessage = message.toolCallId ? toolMessages.get(message.toolCallId) : undefined

          if (existingToolMessage) {
            entryMessages.set(entry.id, existingToolMessage)
            existingToolMessage.status = message.isError ? 'error' : 'done'
            existingToolMessage.isError = message.isError
            existingToolMessage.text = formatToolMessageText(
              toolArguments.get(message.toolCallId),
              resultText,
            ) || resultText
            return
          }

          pushSerializedMessage(messages, entryMessages, {
            ...serializeToolResult(message, index),
            entryId: entry.id,
          })
          return
        }

        const serializedMessage = serializeMessage(message, index)

        if (serializedMessage) {
          pushSerializedMessage(messages, entryMessages, {
            ...serializedMessage,
            entryId: entry.id,
          })
        }

        return
      }
      case 'model_change':
      case 'thinking_level_change':
        return
      case 'compaction':
        pushSerializedMessage(messages, entryMessages, {
          id: `${entry.type}-${entry.id}`,
          entryId: entry.id,
          kind: 'system',
          text: entry.summary || 'Session context was compacted.',
          timestamp,
          title: 'Compaction summary',
        })
        return
      case 'branch_summary':
        pushSerializedMessage(messages, entryMessages, {
          id: `${entry.type}-${entry.id}`,
          entryId: entry.id,
          kind: 'system',
          text: entry.summary,
          timestamp,
          title: 'Branch summary',
        })
        return
      case 'custom_message':
        if (!entry.display) {
          return
        }

        pushSerializedMessage(messages, entryMessages, {
          id: `${entry.type}-${entry.id}`,
          entryId: entry.id,
          kind: 'custom',
          text: asText(entry.content) || entry.customType,
          timestamp,
          title: entry.customType,
        })
        return
      case 'label': {
        const targetMessage = entryMessages.get(entry.targetId)

        if (targetMessage) {
          targetMessage.label = entry.label?.trim() || undefined
        }

        return
      }
      case 'session_info':
      case 'custom':
        return
      default:
        return
    }
  })

  return messages.map(({ entryId, ...message }) => ({
    ...message,
    ...(entryId ? { sessionEntryId: entryId } : {}),
  }))
}

export class PiAgentManager {
  private activeRuntime: ActiveSessionRuntime | null = null
  private readonly autoNamingSessions = new Set<string>()
  private readonly annotationStore = new AgentSessionAnnotationStore()
  private readonly authStorage: AuthStorage
  private readonly modelRegistry: ModelRegistry

  constructor(
    private readonly emitEvent: (event: AgentClientEventPayload) => void,
    private readonly options: PiAgentManagerOptions,
  ) {
    this.authStorage = AuthStorage.create(path.join(options.agentDir, 'auth.json'))
    this.modelRegistry = ModelRegistry.create(this.authStorage, path.join(options.agentDir, 'models.json'))
  }

  async loadWorkspaceState(
    cwd: string,
    preferredSessionPath: string | null = null,
    options: LoadAgentWorkspaceStateOptions = {},
  ): Promise<AgentWorkspaceState> {
    if (!areSameWorkspacePath(this.activeRuntime?.cwd, cwd)) {
      await this.releaseActiveSession()
    }

    if (options.restoreSession === false) {
      if (this.activeRuntime) {
        await this.releaseActiveSession()
      }

      return this.buildWorkspaceState(cwd)
    }

    if (!this.activeRuntime) {
      const restorableSessionPath = await this.resolveRestorableSessionPath(cwd, preferredSessionPath)

      if (restorableSessionPath) {
        try {
          await this.activateSession(cwd, this.openSessionManager(cwd, restorableSessionPath))
        } catch {
          return this.buildWorkspaceState(cwd)
        }
      }
    }

    return this.buildWorkspaceState(cwd)
  }

  async loadDraftState(): Promise<AgentWorkspaceState> {
    await this.releaseActiveSession()
    this.authStorage.reload()
    this.modelRegistry.refresh()

    return {
      activeSession: null,
      runtime: await this.serializeRuntime(null, null),
      sessions: [],
    }
  }

  async releaseWorkspaceRuntime(cwd: string) {
    if (areSameWorkspacePath(this.activeRuntime?.cwd, cwd)) {
      await this.releaseActiveSession()
    }
  }

  async discardWorkspaceSessions(cwd: string) {
    await this.releaseWorkspaceRuntime(cwd)
    await Promise.all([
      rm(this.getSessionDir(cwd), { force: true, recursive: true }),
      this.discardMatchingSessionFiles(cwd, this.getLegacyArynAppSessionDir(cwd)),
      rm(this.getLegacySessionDir(cwd), { force: true, recursive: true }),
    ])
  }

  async listSessionItems(cwd: string): Promise<AgentSessionListItem[]> {
    return this.listSessions(cwd)
  }

  async readSession(cwd: string, sessionPath: string): Promise<AgentSessionSnapshot> {
    const resolvedSessionPath = await this.resolveSessionFileForCwd(cwd, sessionPath)
    const sessionManager = this.openSessionManager(cwd, resolvedSessionPath)

    return this.serializeSessionManager(cwd, sessionManager)
  }

  async createSession(cwd: string, options?: string | AgentSessionCreateOptions): Promise<AgentWorkspaceState> {
    const createOptions = this.normalizeCreateSessionOptions(options)
    const session = await this.activateSession(cwd, SessionManager.create(cwd, this.getSessionDir(cwd)))

    if (createOptions.name) {
      session.setSessionName(createOptions.name)
    }

    if (createOptions.modelKey) {
      await this.applySessionModel(session, createOptions.modelKey)
    }

    if (createOptions.thinkingLevel) {
      session.setThinkingLevel(createOptions.thinkingLevel)
    }

    return this.broadcastWorkspaceState(cwd)
  }

  async openSession(cwd: string, sessionPath: string): Promise<AgentWorkspaceState> {
    const resolvedSessionPath = await this.resolveSessionFileForCwd(cwd, sessionPath)
    const runtime = this.activeRuntime

    if (
      runtime
      && areSameWorkspacePath(runtime.cwd, cwd)
      && runtime.session.sessionFile === resolvedSessionPath
    ) {
      return this.buildWorkspaceState(cwd)
    }

    await this.activateSession(cwd, this.openSessionManager(cwd, resolvedSessionPath))
    return this.broadcastWorkspaceState(cwd)
  }

  async deleteSession(
    cwd: string,
    sessionPath: string,
    options: { restoreFallback?: boolean } = {},
  ): Promise<AgentWorkspaceState> {
    const resolvedSessionPath = await this.resolveSessionFileForCwd(cwd, sessionPath)
    const runtime = this.activeRuntime
    const isDeletingActiveSession = Boolean(
      runtime
      && areSameWorkspacePath(runtime.cwd, cwd)
      && runtime.session.sessionFile === resolvedSessionPath,
    )

    if (isDeletingActiveSession) {
      await this.releaseActiveSession()
    }

    try {
      const sessionStats = await lstat(resolvedSessionPath)
      await rm(resolvedSessionPath, {
        force: true,
        recursive: sessionStats.isDirectory(),
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    await this.annotationStore.delete(resolvedSessionPath)

    if (isDeletingActiveSession && options.restoreFallback !== false) {
      const remainingSessions = await this.listSessions(cwd)

      if (remainingSessions.length > 0) {
        await this.activateSession(cwd, this.openSessionManager(cwd, remainingSessions[0].path))
      }
    }

    return this.broadcastWorkspaceState(cwd)
  }

  async renameSession(cwd: string, sessionPath: string, name: string) {
    const resolvedSessionPath = await this.resolveSessionFileForCwd(cwd, sessionPath)
    const nextName = name.trim()
    const runtime = this.activeRuntime
    const isRenamingActiveSession = Boolean(
      runtime
      && areSameWorkspacePath(runtime.cwd, cwd)
      && runtime.session.sessionFile === resolvedSessionPath,
    )

    if (runtime && isRenamingActiveSession) {
      runtime.session.setSessionName(nextName)
    } else {
      const sessionManager = this.openSessionManager(cwd, resolvedSessionPath)
      sessionManager.appendSessionInfo(nextName)
    }

    return this.broadcastWorkspaceState(cwd)
  }

  async abortActivePrompt() {
    const runtime = this.requireActiveSession()
    await runtime.session.abort()
    return this.broadcastWorkspaceState(runtime.cwd)
  }

  async updateQueuedMessage(update: AgentQueuedMessageUpdate) {
    const runtime = this.requireActiveSession()
    const queue = this.readQueueSnapshot(runtime.session)
    const nextQueue = applyAgentQueuedMessageUpdate(queue, update)

    await this.rebuildQueue(runtime.session, nextQueue)
    return this.broadcastWorkspaceState(runtime.cwd)
  }

  private normalizeCreateSessionOptions(options?: string | AgentSessionCreateOptions): NormalizedCreateSessionOptions {
    if (typeof options === 'string') {
      return {
        modelKey: null,
        name: options.trim() || null,
        thinkingLevel: null,
      }
    }

    const thinkingLevel = options?.thinkingLevel
    if (thinkingLevel && !isThinkingLevel(thinkingLevel)) {
      throw new Error(`Thinking level "${thinkingLevel}" is not supported.`)
    }

    return {
      modelKey: options?.modelKey?.trim() || null,
      name: options?.name?.trim() || null,
      thinkingLevel: thinkingLevel ?? null,
    }
  }

  private async applySessionModel(session: AgentSession, modelKey: string) {
    this.authStorage.reload()
    session.modelRegistry.refresh()

    const selectedModel = this.resolveAvailableModel(session.modelRegistry.getAvailable(), modelKey)

    if (!selectedModel) {
      throw new Error(`Model "${modelKey}" is not available.`)
    }

    if (
      session.model?.provider !== selectedModel.provider
      || session.model?.id !== selectedModel.id
    ) {
      await session.setModel(selectedModel)
    }

    return selectedModel
  }

  async selectModel(modelKey: string) {
    const runtime = this.requireActiveSession()

    const trimmedModelKey = modelKey.trim()
    const selectedModel = await this.applySessionModel(runtime.session, trimmedModelKey)
    runtime.session.settingsManager.setDefaultModelAndProvider(selectedModel.provider, selectedModel.id)
    await runtime.session.settingsManager.flush()

    const settingsErrors = runtime.session.settingsManager.drainErrors()
    if (settingsErrors.length > 0) {
      const firstError = settingsErrors[0]
      this.emitError(firstError.error.message, runtime.session.sessionId)
    }

    return this.broadcastWorkspaceState(runtime.cwd)
  }

  async selectThinkingLevel(level: string, modelKey?: string) {
    const runtime = this.requireActiveSession()

    if (!isThinkingLevel(level)) {
      throw new Error(`Thinking level "${level}" is not supported.`)
    }

    const trimmedModelKey = modelKey?.trim()

    if (trimmedModelKey) {
      await this.applySessionModel(runtime.session, trimmedModelKey)
    }

    runtime.session.setThinkingLevel(level)
    return this.broadcastWorkspaceState(runtime.cwd)
  }

  async updateProviderAuth(cwd: string | null, provider: string, apiKey: string | null) {
    this.authStorage.reload()
    const config = getAgentProviderAuthConfig(provider)

    if (!config.supportsApiKey && apiKey?.trim()) {
      throw new Error(`${config.label} does not support API key authentication.`)
    }

    const trimmedApiKey = apiKey?.trim()
    if (trimmedApiKey) {
      this.authStorage.set(provider, {
        type: 'api_key',
        key: trimmedApiKey,
      })
    } else {
      this.authStorage.remove(provider)
    }

    return this.completeProviderAuthChange(cwd)
  }

  async loginProviderAuth(cwd: string | null, provider: string, callbacks: AgentProviderAuthLoginCallbacks) {
    const oauthProvider = this.authStorage.getOAuthProviders().find((candidate) => candidate.id === provider)
    const config = getAgentProviderAuthConfig(provider)

    if (!oauthProvider || !config.supportsOAuth) {
      throw new Error(`${config.label} does not support subscription login.`)
    }

    const manualCodePrompt = {
      message: '如果浏览器登录没有自动完成，请粘贴最终 redirect URL 或授权码。',
      placeholder: 'Redirect URL 或授权码',
    }

    try {
      this.authStorage.reload()
      callbacks.emitProgress(provider, `正在启动 ${config.label} 登录...`)

      await this.authStorage.login(provider, {
        onAuth: (info) => {
          callbacks.emitAuth(provider, info)
          callbacks.openExternal(info.url).catch((error) => {
            callbacks.emitProgress(
              provider,
              `无法自动打开浏览器：${error instanceof Error ? error.message : String(error)}`,
            )
          })
        },
        onManualCodeInput: oauthProvider.usesCallbackServer
          ? () => callbacks.requestInput(provider, manualCodePrompt)
          : undefined,
        onProgress: (message) => callbacks.emitProgress(provider, message),
        onPrompt: (prompt) => callbacks.requestInput(provider, prompt),
        signal: callbacks.signal,
      })

      callbacks.emitComplete(provider, true)
      return this.completeProviderAuthChange(cwd)
    } catch (error) {
      callbacks.emitComplete(provider, false, error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  async logoutProviderAuth(cwd: string | null, provider: string) {
    this.authStorage.reload()
    this.authStorage.logout(provider)
    return this.completeProviderAuthChange(cwd)
  }

  private async completeProviderAuthChange(cwd: string | null) {
    this.modelRegistry.refresh()
    const runtime = this.activeRuntime

    if (runtime) {
      runtime.session.modelRegistry.refresh()
    }

    if (cwd && runtime && areSameWorkspacePath(runtime.cwd, cwd)) {
      if (runtime.session.model && !runtime.session.modelRegistry.hasConfiguredAuth(runtime.session.model)) {
        this.emitError(AUTH_SETUP_HINT, runtime.session.sessionId)
      } else if (!runtime.session.model) {
        await this.ensureModelSelected(runtime.session)
      }

      return this.broadcastWorkspaceState(cwd)
    }

    return cwd ? this.buildWorkspaceState(cwd) : this.loadDraftState()
  }

  async sendPrompt(prompt: string, streamingBehavior?: AgentRunningPromptBehavior, rawAttachments?: unknown) {
    const runtime = this.requireActiveSession()
    const message = prompt.trim()
    const attachments = normalizePromptAttachments(rawAttachments)

    if (!message && attachments.length === 0) {
      throw new Error('Prompt cannot be empty.')
    }

    if (!runtime.session.model || !runtime.session.modelRegistry.hasConfiguredAuth(runtime.session.model)) {
      throw new Error(AUTH_SETUP_HINT)
    }

    const preparedAttachments = attachments.length > 0
      ? await preparePromptAttachments(attachments, runtime.session.model)
      : { images: [], text: '' }
    const messageWithAttachments = appendAttachmentText(
      message || 'Please inspect the attached file(s).',
      preparedAttachments.text,
    )

    const pendingPrompt = streamingBehavior === 'steer'
      ? runtime.session.steer(messageWithAttachments, preparedAttachments.images)
      : streamingBehavior === 'followUp'
        ? runtime.session.followUp(messageWithAttachments, preparedAttachments.images)
        : runtime.session.prompt(messageWithAttachments, {
            images: preparedAttachments.images,
          })
    this.emitEvent({
      type: 'workspace_state',
      state: await this.serializeWorkspaceState(
        runtime.cwd,
        await this.listSessions(runtime.cwd),
        runtime.session,
      ),
    })

    void pendingPrompt.catch((error) => {
      this.emitError(error instanceof Error ? error.message : 'Pi Agent failed to process the request.', runtime.session.sessionId)
      void this.broadcastWorkspaceState(runtime.cwd)
    })

    return { ok: true }
  }

  async sessionExists(cwd: string, sessionPath: string) {
    try {
      const resolvedSessionPath = await this.resolveSessionFileForCwd(cwd, sessionPath)
      const sessionStats = await lstat(resolvedSessionPath)
      return sessionStats.isFile()
    } catch {
      return false
    }
  }

  private readQueueSnapshot(session: AgentSession): AgentQueueSnapshot {
    return {
      followUp: [...session.getFollowUpMessages()],
      steering: [...session.getSteeringMessages()],
    }
  }

  private async rebuildQueue(session: AgentSession, queue: AgentQueueSnapshot) {
    const previousQueue = session.clearQueue()

    try {
      for (const message of queue.steering) {
        await session.steer(message)
      }

      for (const message of queue.followUp) {
        await session.followUp(message)
      }
    } catch (error) {
      session.clearQueue()

      for (const message of previousQueue.steering) {
        await session.steer(message)
      }

      for (const message of previousQueue.followUp) {
        await session.followUp(message)
      }

      throw error
    }
  }

  dispose() {
    void this.releaseActiveSession()
  }

  private async activateSession(cwd: string, sessionManager: SessionManager) {
    await this.releaseActiveSession()
    this.authStorage.reload()
    this.modelRegistry.refresh()
    const settingsManager = this.createSettingsManager(cwd)

    const {
      extensionsResult,
      modelFallbackMessage,
      session,
    } = await createAgentSession({
      agentDir: this.options.agentDir,
      authStorage: this.authStorage,
      cwd,
      modelRegistry: this.modelRegistry,
      sessionManager,
      settingsManager,
      tools: ['read', 'bash', 'edit', 'write'],
    })

    await this.ensureModelSelected(session)
    this.emitSetupDiagnostics(session, extensionsResult.errors, modelFallbackMessage)

    const unsubscribe = session.subscribe((event) => {
      void this.handleSessionEvent(session, event)
    })

    this.activeRuntime = {
      activity: {
        pendingAssistantEntryId: null,
        runningToolCalls: new Map(),
      },
      cwd,
      session,
      status: {
        compactionReason: null,
        retryMaxAttempts: null,
      },
      unsubscribe,
    }

    return session
  }

  private createSettingsManager(cwd: string) {
    const settingsManager = SettingsManager.create(cwd, this.options.agentDir)
    settingsManager.applyOverrides({
      sessionDir: this.getSessionDir(cwd),
    })
    return settingsManager
  }

  private createDraftSettingsManager() {
    const globalSettings = SettingsManager.create(this.options.agentDir, this.options.agentDir).getGlobalSettings()
    return SettingsManager.inMemory(globalSettings)
  }

  private resolveAvailableModel(availableModels: Model<Api>[], modelKey: string) {
    return availableModels.find((model) => `${model.provider}/${model.id}` === modelKey)
      ?? availableModels.find((model) => `${model.provider}/${model.id}` === `${OPENROUTER_PROVIDER}/${modelKey}`)
      ?? availableModels.find((model) => model.provider === OPENROUTER_PROVIDER && model.id === modelKey)
  }

  private async ensureModelSelected(session: AgentSession) {
    if (session.model) {
      return
    }

    const availableModels = session.modelRegistry.getAvailable()

    if (availableModels.length === 0) {
      return
    }

    const defaultModelPerProvider = await loadPiDefaultModelPerProvider()
    const preferredSelection = selectPiPreferredModel(
      availableModels,
      session.settingsManager,
      defaultModelPerProvider,
    )

    if (!preferredSelection) {
      return
    }

    await session.setModel(preferredSelection)
  }

  private getAutoNamingModels(session: AgentSession) {
    const models: Model<Api>[] = []
    const preferredNamingModel = session.modelRegistry.find(OPENROUTER_PROVIDER, AUTO_SESSION_NAME_MODEL_ID) ?? AUTO_SESSION_NAME_MODEL

    if (
      session.model
      && session.modelRegistry.hasConfiguredAuth(session.model)
      && !models.some((model) => model.provider === session.model?.provider && model.id === session.model?.id)
    ) {
      models.push(session.model)
    }

    if (
      session.modelRegistry.hasConfiguredAuth(preferredNamingModel)
      && !models.some((model) => model.provider === preferredNamingModel.provider && model.id === preferredNamingModel.id)
    ) {
      models.push(preferredNamingModel)
    }

    return models
  }

  private async generateSessionNameWithModel(session: AgentSession, model: Model<Api>, sourceText: string) {
    const auth = await session.modelRegistry.getApiKeyAndHeaders(model)

    if (!auth.ok) {
      return null
    }

    const response = await complete(
      model,
      {
        messages: [
          {
            content: [{ type: 'text', text: sourceText }],
            role: 'user',
            timestamp: Date.now(),
          } satisfies UserMessage,
        ],
        systemPrompt: AUTO_SESSION_NAME_SYSTEM_PROMPT,
      },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        maxTokens: AUTO_SESSION_NAME_MAX_TOKENS,
      },
    )

    if (response.stopReason === 'aborted' || response.stopReason === 'error') {
      return null
    }

    const text = response.content
      .filter((block): block is Extract<AssistantMessage['content'][number], { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n')

    return normalizeSessionTitle(text)
  }

  private async generateSessionName(session: AgentSession, context: NonNullable<ReturnType<typeof getAutoNamingContext>>) {
    const namingSource = [
      `First user message:\n${context.firstUserText}`,
      context.firstAssistantText ? `\nFirst assistant reply:\n${context.firstAssistantText}` : '',
    ]
      .join('\n')
      .trim()

    for (const model of this.getAutoNamingModels(session)) {
      try {
        const title = await this.generateSessionNameWithModel(session, model, namingSource)

        if (title) {
          return title
        }
      } catch {
        // Fall through to the next model or the local fallback.
      }
    }

    return buildFallbackSessionTitle(context.firstUserText)
  }

  private async maybeAutoNameSession(session: AgentSession) {
    if (session.sessionName?.trim() || this.autoNamingSessions.has(session.sessionId)) {
      return
    }

    const namingContext = getAutoNamingContext(session.sessionManager.getBranch())

    if (!namingContext || namingContext.userMessageCount !== 1) {
      return
    }

    this.autoNamingSessions.add(session.sessionId)

    try {
      const title = await this.generateSessionName(session, namingContext)

      if (!title || session.sessionName?.trim()) {
        return
      }

      session.setSessionName(title)

      if (this.activeRuntime?.session === session) {
        await this.broadcastWorkspaceState(this.activeRuntime.cwd)
      }
    } finally {
      this.autoNamingSessions.delete(session.sessionId)
    }
  }

  private async handleSessionEvent(session: AgentSession, event: AgentSessionEvent) {
    if (!this.activeRuntime || this.activeRuntime.session !== session) {
      return
    }

    const runtime = this.activeRuntime

    this.emitEvent({
      type: 'pi_native_event',
      event: event as unknown as { type: string; [key: string]: unknown },
      sessionId: session.sessionId,
    })

    if (event.type === 'compaction_start') {
      runtime.status.compactionReason = event.reason
    }

    if (event.type === 'compaction_end') {
      runtime.status.compactionReason = null
    }

    if (event.type === 'auto_retry_start') {
      runtime.status.retryMaxAttempts = event.maxAttempts
    }

    if (event.type === 'auto_retry_end') {
      runtime.status.retryMaxAttempts = null
    }

    if (event.type === 'message_start' && 'role' in event.message && event.message.role === 'assistant') {
      runtime.activity.pendingAssistantEntryId = null
      this.emitEvent({
        type: 'assistant_message_started',
        sessionId: session.sessionId,
      })
      return
    }

    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      this.emitEvent({
        type: 'assistant_message_delta',
        delta: event.assistantMessageEvent.delta,
        sessionId: session.sessionId,
      })
      return
    }

    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'thinking_delta') {
      this.emitEvent({
        type: 'assistant_thinking_delta',
        delta: event.assistantMessageEvent.delta,
        sessionId: session.sessionId,
      })
      return
    }

    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'thinking_end') {
      this.emitEvent({
        type: 'assistant_thinking_finished',
        sessionId: session.sessionId,
      })
      return
    }

    if (event.type === 'tool_execution_start') {
      const ownerEntryId = this.findLatestAssistantEntryId(session) ?? runtime.activity.pendingAssistantEntryId

      const directFilePath = extractWritableToolFilePath(runtime.cwd, event.toolName, event.args)
      const existedBeforeWrite = event.toolName === 'write' && directFilePath
        ? await pathExists(directFilePath)
        : null

      runtime.activity.runningToolCalls.set(event.toolCallId, {
        existedBeforeWrite,
        filePath: directFilePath,
        ownerEntryId,
        parsedFileChanges: event.toolName === 'bash' ? extractExplicitBashFileChanges(runtime.cwd, event.args) : [],
        toolName: event.toolName,
      })
      this.emitEvent({
        type: 'tool_execution_started',
        sessionId: session.sessionId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        summary: summarizeToolPayload(event.args, 240, 'Running tool...'),
      })
      return
    }

    if (event.type === 'tool_execution_update') {
      this.emitEvent({
        type: 'tool_execution_updated',
        sessionId: session.sessionId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        summary: summarizeToolPayload(
          event.partialResult?.content ?? event.partialResult?.details ?? event.partialResult,
          320,
          `${event.toolName} is running...`,
        ),
      })
      return
    }

    if (event.type === 'tool_execution_end') {
      const finishedTool = runtime.activity.runningToolCalls.get(event.toolCallId) ?? null
      runtime.activity.runningToolCalls.delete(event.toolCallId)

      if (
        finishedTool
        && !event.isError
        && runtime.session.sessionFile
        && finishedTool.ownerEntryId
      ) {
        const nextFileChanges = [...finishedTool.parsedFileChanges]

        if (finishedTool.filePath) {
          const directChangeKind = resolveDirectToolFileChangeKind(
            finishedTool.toolName,
            finishedTool.existedBeforeWrite,
          )

          if (directChangeKind) {
            nextFileChanges.push({
              filePath: finishedTool.filePath,
              kind: directChangeKind,
            })
          }
        }

        let nextAnnotations = null

        for (const change of nextFileChanges) {
          nextAnnotations = await this.annotationStore.recordFileChange(
            runtime.session.sessionFile,
            finishedTool.ownerEntryId,
            change,
          )
        }

        if (nextAnnotations) {
          this.emitEvent({
            type: 'session_annotations_updated',
            sessionId: runtime.session.sessionId,
            annotations: nextAnnotations,
          })
        }
      }

      this.emitEvent({
        type: 'tool_execution_finished',
        sessionId: session.sessionId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        summary: summarizeToolPayload(
          event.result?.content ?? event.result?.details ?? event.result,
          320,
          `${event.toolName} finished.`,
        ),
        isError: event.isError,
      })
      return
    }

    if (event.type === 'message_end' && 'role' in event.message && event.message.role === 'assistant') {
      runtime.activity.pendingAssistantEntryId = this.findEntryIdForMessage(session, event.message)
    }

    if (
      event.type === 'compaction_start'
      || event.type === 'compaction_end'
      || event.type === 'auto_retry_start'
      || event.type === 'auto_retry_end'
      || event.type === 'agent_start'
      || event.type === 'turn_start'
      || event.type === 'turn_end'
      || event.type === 'thinking_level_changed'
    ) {
      await this.broadcastWorkspaceState(runtime.cwd)

      if (event.type === 'turn_end') {
        void this.maybeAutoNameSession(session)
      }

      return
    }

    if (event.type === 'message_end' || event.type === 'agent_end') {
      await this.broadcastWorkspaceState(runtime.cwd)
    }
  }

  private async broadcastWorkspaceState(cwd: string) {
    const state = await this.buildWorkspaceState(cwd)
    this.emitEvent({
      type: 'workspace_state',
      state,
    })
    return state
  }

  private async buildWorkspaceState(cwd: string): Promise<AgentWorkspaceState> {
    const sessions = await this.listSessions(cwd)
    const runtime = this.activeRuntime
    return this.serializeWorkspaceState(cwd, sessions, runtime && areSameWorkspacePath(runtime.cwd, cwd) ? runtime.session : null)
  }

  private async serializeWorkspaceState(
    cwd: string,
    sessions: AgentSessionListItem[],
    session: AgentSession | null,
  ): Promise<AgentWorkspaceState> {
    const resolvedSessions = session ? this.mergeActiveSessionListItem(sessions, session) : sessions

    return {
      activeSession: session ? await this.serializeSession(session) : null,
      runtime: await this.serializeRuntime(cwd, session),
      sessions: resolvedSessions,
    }
  }

  private mergeActiveSessionListItem(sessions: AgentSessionListItem[], session: AgentSession) {
    const activeSessionItem = this.serializeActiveSessionListItem(session)

    if (!activeSessionItem) {
      return sessions
    }

    const existingIndex = sessions.findIndex((candidate) => candidate.path === activeSessionItem.path)
    const nextSessions = existingIndex >= 0
      ? sessions.map((candidate, index) => index === existingIndex ? activeSessionItem : candidate)
      : [activeSessionItem, ...sessions]

    return nextSessions.sort((left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt))
  }

  private serializeActiveSessionListItem(session: AgentSession): AgentSessionListItem | null {
    const sessionPath = session.sessionFile

    if (!sessionPath) {
      return null
    }

    const header = session.sessionManager.getHeader()
    const branchEntries = session.sessionManager.getBranch()
    const messages = serializeSessionEntries(branchEntries)
    const runtimeMessages = session.messages
      .map((message, index) => serializeMessage(message, index))
      .filter((message): message is AgentSidebarMessage => Boolean(message))
    const visibleMessages = runtimeMessages.length > messages.length ? runtimeMessages : messages
    const firstUserMessage = messages.find((message) => message.kind === 'user')
      ?? runtimeMessages.find((message) => message.kind === 'user')
    const name = session.sessionName ?? null

    if (!name && !firstUserMessage) {
      return null
    }

    const createdTimestamp = header ? parseEntryTimestamp(header.timestamp) : Date.now()
    const modifiedAt = visibleMessages.reduce(
      (latestTimestamp, message) => Math.max(latestTimestamp, message.timestamp),
      createdTimestamp,
    )
    const preview = clampText(name || firstUserMessage?.text || 'New session', 72)

    return {
      createdAt: new Date(createdTimestamp).toISOString(),
      id: session.sessionId,
      messageCount: branchEntries.filter((entry) => entry.type === 'message').length,
      modifiedAt: new Date(modifiedAt).toISOString(),
      name,
      path: sessionPath,
      preview,
    }
  }

  private async serializeRuntime(cwd: string | null, session: AgentSession | null): Promise<AgentRuntimeState> {
    const activeRuntimeForCwd = this.activeRuntime && areSameWorkspacePath(this.activeRuntime.cwd, cwd)
      ? this.activeRuntime
      : null
    const modelRegistry = session?.modelRegistry ?? this.modelRegistry
    const availableModels = modelRegistry.getAvailable()
    const defaultModelPerProvider = await loadPiDefaultModelPerProvider()
    const settingsManager = session?.settingsManager
      ?? (cwd ? this.createSettingsManager(cwd) : this.createDraftSettingsManager())
    const defaultModelValue = selectPiPreferredModel(availableModels, settingsManager, defaultModelPerProvider)
    const defaultModel = defaultModelValue ? `${defaultModelValue.provider}/${defaultModelValue.id}` : null
    const defaultThinkingLevel = settingsManager.getDefaultThinkingLevel() ?? 'medium'
    const selectedModelValue = session?.model
      ?? (!session ? defaultModelValue : null)
    const selectedModel = selectedModelValue ? `${selectedModelValue.provider}/${selectedModelValue.id}` : null
    const configuredThinkingLevel = session?.thinkingLevel ?? defaultThinkingLevel
    const availableThinkingLevels = selectedModelValue
      ? getSupportedThinkingLevels(selectedModelValue)
      : THINKING_LEVELS
    const thinkingLevel = selectedModelValue
      ? clampThinkingLevel(selectedModelValue, configuredThinkingLevel)
      : configuredThinkingLevel
    const steeringMessages = session ? [...session.getSteeringMessages()] : []
    const followUpMessages = session ? [...session.getFollowUpMessages()] : []
    const steeringMessageCount = steeringMessages.length
    const followUpMessageCount = followUpMessages.length

    return {
      agentId: 'builtin-pi',
      auth: this.getProviderAuthStates(availableModels.map((model) => model.provider)),
      availableModels: availableModels.map((model) => `${model.provider}/${model.id}`),
      availableModelInputs: getInputsByModel(availableModels),
      availableThinkingLevels,
      availableThinkingLevelsByModel: getThinkingLevelsByModel(availableModels),
      compactionReason: activeRuntimeForCwd?.status.compactionReason ?? null,
      followUpMessageCount,
      followUpMessages,
      followUpMode: session?.followUpMode ?? 'one-at-a-time',
      hasConfiguredModels: availableModels.length > 0,
      isCompacting: session?.isCompacting ?? false,
      isStreaming: session?.isStreaming ?? false,
      defaultModel,
      defaultThinkingLevel,
      pendingMessageCount: session?.pendingMessageCount ?? 0,
      preferredModelByProvider: getProviderPreferredModelKeys(availableModels, defaultModelPerProvider),
      retryAttempt: session?.retryAttempt ?? 0,
      retryMaxAttempts: activeRuntimeForCwd?.status.retryMaxAttempts ?? null,
      selectedModel,
      setupHint: availableModels.length > 0 ? null : AUTH_SETUP_HINT,
      supportedRunningPromptBehaviors: ['steer', 'followUp'],
      supportsQueuedMessageEditing: true,
      supportsThinking: Boolean(selectedModelValue?.reasoning),
      steeringMessageCount,
      steeringMessages,
      steeringMode: session?.steeringMode ?? 'one-at-a-time',
      thinkingLevel,
      workspacePath: cwd,
    }
  }

  private async serializeSession(session: AgentSession): Promise<AgentSessionSnapshot> {
    const workspacePath = this.activeRuntime?.cwd ?? session.sessionManager.getCwd()

    return this.serializeSessionManager(
      workspacePath,
      session.sessionManager,
      session.sessionId,
      session.isStreaming,
    )
  }

  private async serializeSessionManager(
    cwd: string,
    sessionManager: SessionManager,
    sessionId = sessionManager.getSessionId(),
    isStreaming = false,
  ): Promise<AgentSessionSnapshot> {
    const branchEntries = sessionManager.getBranch()
    const messages = serializeSessionEntries(branchEntries)
    const nativeMessages = serializePiWebSessionEntries(branchEntries)
    const sessionPath = sessionManager.getSessionFile() ?? null
    const annotations = sessionPath
      ? filterAnnotationsByDirectToolPaths(
        await this.annotationStore.read(sessionPath),
        collectDirectToolPathsByEntryId(branchEntries, cwd),
      )
      : { fileChangesByEntryId: {} }

    return {
      annotations,
      // Keep the legacy projection during the renderer migration so this
      // backend commit remains compatible with clients that do not consume
      // the native PI snapshot yet.
      messages,
      native: {
        agentId: 'builtin-pi',
        entryIds: nativeMessages.entryIds,
        isStreaming,
        messages: nativeMessages.messages,
        modelNames: {},
        sessionId,
      },
      name: sessionManager.getSessionName() ?? null,
      sessionId,
      sessionPath,
      workspacePath: cwd,
    }
  }

  private async listSessions(cwd: string): Promise<AgentSessionListItem[]> {
    const sessions = (
      await Promise.all(this.getReadableSessionDirs(cwd).map((sessionDir) => (
        SessionManager.list(cwd, sessionDir)
      )))
    )
      .flat()
      .filter((session) => !session.cwd || areSameWorkspacePath(session.cwd, cwd))

    return sessions
      .slice()
      .filter((session) => session.messageCount > 0)
      .sort((left, right) => right.modified.getTime() - left.modified.getTime())
      .map((session) => ({
        createdAt: session.created.toISOString(),
        id: session.id,
        messageCount: session.messageCount,
        modifiedAt: session.modified.toISOString(),
        name: session.name ?? null,
        path: session.path,
        preview: clampText(session.name || session.firstMessage || 'New session', 72),
      }))
  }

  private async discardMatchingSessionFiles(cwd: string, sessionDir: string) {
    const sessions = await SessionManager.list(cwd, sessionDir)

    await Promise.all(sessions.map(async (session) => {
      const sessionCwd = await this.readSessionFileCwd(session.path)

      if (!sessionCwd || !areSameWorkspacePath(sessionCwd, cwd)) {
        return
      }

      await rm(session.path, { force: true })
      await this.annotationStore.delete(session.path)
    }))
  }

  private async resolveRestorableSessionPath(cwd: string, preferredSessionPath: string | null) {
    if (preferredSessionPath) {
      try {
        const resolvedSessionPath = await this.resolveSessionFileForCwd(cwd, preferredSessionPath)
        return await pathExists(resolvedSessionPath) ? resolvedSessionPath : null
      } catch {
        return null
      }
    }

    const sessions = await this.listSessions(cwd)
    return sessions[0]?.path ?? null
  }

  private getSessionDir(cwd: string) {
    return getArynPiSessionDir(cwd, this.options.agentDir)
  }

  private getLegacyArynAppSessionDir(cwd: string) {
    return getLegacyArynPiSessionDir(cwd, this.options.agentDir)
  }

  private getLegacySessionDir(cwd: string) {
    return path.join(cwd, '.pi', 'sessions')
  }

  private getReadableSessionDirs(cwd: string) {
    const primarySessionDir = this.getSessionDir(cwd)
    const legacyAppSessionDir = this.getLegacyArynAppSessionDir(cwd)
    const legacyWorkspaceSessionDir = this.getLegacySessionDir(cwd)

    return [primarySessionDir, legacyAppSessionDir, legacyWorkspaceSessionDir]
      .filter((sessionDir, index, sessionDirs) => (
        sessionDirs.findIndex((candidate) => areSameWorkspacePath(candidate, sessionDir)) === index
      ))
  }

  private openSessionManager(cwd: string, sessionPath: string) {
    return SessionManager.open(sessionPath, this.getSessionDirForPath(cwd, sessionPath), cwd)
  }

  private getSessionDirForPath(cwd: string, sessionPath: string) {
    const resolvedSessionPath = path.resolve(sessionPath)
    const matchingSessionDir = this.getReadableSessionDirs(cwd)
      .map((sessionDir) => path.resolve(sessionDir))
      .find((sessionDir) => this.isPathInsideSessionDir(sessionDir, resolvedSessionPath))

    if (!matchingSessionDir) {
      throw new Error('Invalid session path.')
    }

    return matchingSessionDir
  }

  private async resolveSessionFileForCwd(cwd: string, sessionPath: string) {
    const resolvedSessionPath = this.resolveSessionPath(cwd, sessionPath)
    const sessionCwd = await this.readSessionFileCwd(resolvedSessionPath)

    if (!sessionCwd || !areSameWorkspacePath(sessionCwd, cwd)) {
      throw new Error('Invalid session path.')
    }

    return resolvedSessionPath
  }

  private resolveSessionPath(cwd: string, sessionPath: string) {
    const resolvedSessionPath = path.resolve(sessionPath)

    if (
      path.extname(resolvedSessionPath).toLowerCase() !== '.jsonl'
      || !this.getReadableSessionDirs(cwd)
        .map((sessionDir) => path.resolve(sessionDir))
        .some((sessionDir) => this.isPathInsideSessionDir(sessionDir, resolvedSessionPath))
    ) {
      throw new Error('Invalid session path.')
    }

    return resolvedSessionPath
  }

  private readSessionHeaderCwd(firstLine: string) {
    const line = firstLine.trim()

    if (!line) {
      return null
    }

    try {
      const header = JSON.parse(line) as { cwd?: unknown; type?: unknown }
      return header.type === 'session' && typeof header.cwd === 'string' && header.cwd.trim()
        ? header.cwd
        : null
    } catch {
      return null
    }
  }

  private async readSessionFileCwd(sessionPath: string) {
    let file: Awaited<ReturnType<typeof openFile>> | null = null

    try {
      file = await openFile(sessionPath, 'r')
      const chunks: string[] = []
      const buffer = Buffer.alloc(SESSION_HEADER_READ_CHUNK_BYTES)
      let position = 0

      while (position < SESSION_HEADER_READ_LIMIT_BYTES) {
        const bytesToRead = Math.min(buffer.length, SESSION_HEADER_READ_LIMIT_BYTES - position)
        const { bytesRead } = await file.read(buffer, 0, bytesToRead, position)

        if (bytesRead === 0) {
          break
        }

        chunks.push(buffer.toString('utf8', 0, bytesRead))
        const content = chunks.join('')
        const newlineMatch = content.match(/\r?\n/)

        if (newlineMatch?.index !== undefined) {
          return this.readSessionHeaderCwd(content.slice(0, newlineMatch.index))
        }

        position += bytesRead
      }

      return this.readSessionHeaderCwd(chunks.join(''))
    } catch {
      return null
    } finally {
      await file?.close().catch(() => undefined)
    }
  }

  private isPathInsideSessionDir(sessionDir: string, sessionPath: string) {
    const relativeSessionPath = path.relative(sessionDir, sessionPath)

    return Boolean(relativeSessionPath)
      && !relativeSessionPath.startsWith('..')
      && !path.isAbsolute(relativeSessionPath)
  }

  private findEntryIdForMessage(session: AgentSession, message: AgentMessage) {
    if (!('role' in message) || typeof message.timestamp !== 'number') {
      return null
    }

    const branchEntries = session.sessionManager.getBranch()

    for (let index = branchEntries.length - 1; index >= 0; index -= 1) {
      const entry = branchEntries[index]

      if (entry.type !== 'message' || !('role' in entry.message)) {
        continue
      }

      if (entry.message.role === message.role && entry.message.timestamp === message.timestamp) {
        return entry.id
      }
    }

    return null
  }

  private findLatestAssistantEntryId(session: AgentSession) {
    const branchEntries = session.sessionManager.getBranch()

    for (let index = branchEntries.length - 1; index >= 0; index -= 1) {
      const entry = branchEntries[index]

      if (entry.type === 'message' && 'role' in entry.message && entry.message.role === 'assistant') {
        return entry.id
      }
    }

    return null
  }

  private getProviderAuthStates(modelProviders: string[]): Record<string, AgentProviderAuthState> {
    const providers = new Set([
      ...AGENT_PROVIDER_AUTH_CONFIGS.map((config) => config.provider),
      ...this.authStorage.list(),
      ...modelProviders,
    ])

    return Object.fromEntries(
      Array.from(providers)
        .sort((left, right) => {
          const orderDelta = getAgentProviderOrder(left) - getAgentProviderOrder(right)
          return orderDelta !== 0 ? orderDelta : left.localeCompare(right)
        })
        .map((provider) => [provider, this.getProviderAuthState(getAgentProviderAuthConfig(provider))]),
    )
  }

  private getProviderAuthState(config: AgentProviderAuthConfig): AgentProviderAuthState {
    const credential = this.authStorage.get(config.provider)
    const environmentCredentialLabel = this.getEnvironmentCredentialLabel(config)
    const hasEnvironmentCredential = Boolean(environmentCredentialLabel)
    const hasStoredCredential = Boolean(credential)
    const source = hasStoredCredential
      ? 'stored'
      : hasEnvironmentCredential
        ? 'env'
        : 'none'

    return {
      category: config.category,
      environmentCredentialLabel,
      envVarName: config.envVarNames[0] ?? '',
      envVarNames: config.envVarNames,
      hasStoredCredential,
      label: config.label,
      source,
      storedCredentialType: credential?.type ?? null,
      supportsApiKey: config.supportsApiKey,
      supportsOAuth: config.supportsOAuth,
      usesEnvironmentCredential: source === 'env',
    }
  }

  private getEnvironmentCredentialLabel(config: AgentProviderAuthConfig) {
    const envCredential = getEnvApiKey(config.provider)

    if (!envCredential?.trim()) {
      return null
    }

    const foundEnvVarNames = config.envVarNames.filter((envVarName) => Boolean(process.env[envVarName]?.trim()))

    if (config.provider === 'google-vertex' && envCredential === '<authenticated>') {
      return foundEnvVarNames.length > 0
        ? `Google ADC (${foundEnvVarNames.join(', ')})`
        : 'Google ADC'
    }

    if (config.provider === 'amazon-bedrock' && envCredential === '<authenticated>') {
      return foundEnvVarNames.join(', ') || 'AWS credentials'
    }

    if (foundEnvVarNames.length > 0) {
      return foundEnvVarNames.join(', ')
    }

    return config.envVarNames.join(', ') || 'environment'
  }

  private emitSetupDiagnostics(
    session: AgentSession,
    extensionErrors: Array<{ path: string, error: string }>,
    modelFallbackMessage?: string,
  ) {
    if (modelFallbackMessage) {
      this.emitError(modelFallbackMessage, session.sessionId)
    }

    const modelRegistryError = session.modelRegistry.getError()
    if (modelRegistryError) {
      this.emitError(modelRegistryError, session.sessionId)
    }

    const authErrors = this.authStorage.drainErrors()
    for (const error of authErrors) {
      this.emitError(error.message, session.sessionId)
    }

    const settingsErrors = session.settingsManager.drainErrors()
    for (const settingsError of settingsErrors) {
      this.emitError(settingsError.error.message, session.sessionId)
    }

    for (const extensionError of extensionErrors) {
      this.emitError(
        `Failed to load extension "${path.basename(extensionError.path)}": ${extensionError.error}`,
        session.sessionId,
      )
    }
  }

  private requireActiveSession() {
    if (!this.activeRuntime) {
      throw new Error('Open or create an Agent session first.')
    }

    return this.activeRuntime
  }

  private async releaseActiveSession() {
    if (!this.activeRuntime) {
      return
    }

    const runtime = this.activeRuntime
    this.activeRuntime = null

    runtime.unsubscribe()

    if (runtime.session.isStreaming) {
      await runtime.session.abort().catch(() => undefined)
    }

    runtime.session.dispose()
  }

  private emitError(message: string, sessionId: string | null = null) {
    this.emitEvent({
      type: 'error',
      message,
      sessionId,
    })
  }
}
