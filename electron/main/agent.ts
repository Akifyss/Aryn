import { lstat, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type SessionEntry,
  type AgentSession,
} from '@earendil-works/pi-coding-agent'
import { clampThinkingLevel, complete, getEnvApiKey, getSupportedThinkingLevels, type Api, type AssistantMessage, type Model, type TextContent, type ToolResultMessage, type UserMessage } from '@earendil-works/pi-ai'
import type {
  AgentMessageFileChange,
  AgentClientEvent,
  AgentProviderAuthState,
  AgentRuntimeState,
  AgentSessionListItem,
  AgentSessionSnapshot,
  AgentSidebarMessage,
  AgentWorkspaceState,
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

type StreamingBehavior = 'steer' | 'followUp'
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

const OPENROUTER_ENV_KEY = 'OPENROUTER_API_KEY'
const OPENROUTER_PROVIDER = 'openrouter'
const OPENAI_ENV_KEY = 'OPENAI_API_KEY'
const GOOGLE_ENV_KEY = 'GEMINI_API_KEY'
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] satisfies ThinkingLevel[]
const AUTO_SESSION_NAME_MODEL_ID = 'openrouter/free'
const AUTO_SESSION_NAME_MAX_TOKENS = 48
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

function getThinkingLevelsByModel(availableModels: Model<Api>[]) {
  const levelsByModel: Record<string, ThinkingLevel[]> = {}

  for (const model of availableModels) {
    levelsByModel[`${model.provider}/${model.id}`] = getSupportedThinkingLevels(model)
  }

  return levelsByModel
}

function isThinkingLevel(value: string): value is ThinkingLevel {
  return THINKING_LEVELS.includes(value as ThinkingLevel)
}

function asText(value: string | Array<TextContent | { type: 'image' }>) {
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
  return {
    id: `user-${message.timestamp}-${index}`,
    kind: 'user',
    text: asText(message.content) || 'User message',
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
    private readonly emitEvent: (event: AgentClientEvent) => void,
    private readonly options: PiAgentManagerOptions,
  ) {
    this.authStorage = AuthStorage.create(path.join(options.agentDir, 'auth.json'))
    this.modelRegistry = ModelRegistry.create(this.authStorage, path.join(options.agentDir, 'models.json'))
  }

  async loadWorkspaceState(cwd: string, preferredSessionPath: string | null = null): Promise<AgentWorkspaceState> {
    if (this.activeRuntime?.cwd !== cwd) {
      await this.releaseActiveSession()
    }

    if (!this.activeRuntime) {
      const restorableSessionPath = await this.resolveRestorableSessionPath(cwd, preferredSessionPath)

      if (restorableSessionPath) {
        try {
          await this.activateSession(cwd, SessionManager.open(restorableSessionPath))
        } catch {
          return this.buildWorkspaceState(cwd)
        }
      }
    }

    return this.buildWorkspaceState(cwd)
  }

  async createSession(cwd: string, name?: string): Promise<AgentWorkspaceState> {
    const session = await this.activateSession(cwd, SessionManager.create(cwd, this.getSessionDir(cwd)))

    if (name?.trim()) {
      session.setSessionName(name.trim())
    }

    return this.broadcastWorkspaceState(cwd)
  }

  async openSession(cwd: string, sessionPath: string): Promise<AgentWorkspaceState> {
    const resolvedSessionPath = this.resolveSessionPath(cwd, sessionPath)

    if (
      this.activeRuntime?.cwd === cwd
      && this.activeRuntime.session.sessionFile === resolvedSessionPath
    ) {
      return this.buildWorkspaceState(cwd)
    }

    await this.activateSession(cwd, SessionManager.open(resolvedSessionPath))
    return this.broadcastWorkspaceState(cwd)
  }

  async deleteSession(cwd: string, sessionPath: string): Promise<AgentWorkspaceState> {
    const resolvedSessionPath = this.resolveSessionPath(cwd, sessionPath)
    const isDeletingActiveSession = this.activeRuntime?.cwd === cwd
      && this.activeRuntime.session.sessionFile === resolvedSessionPath

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

    if (isDeletingActiveSession) {
      const remainingSessions = await this.listSessions(cwd)

      if (remainingSessions.length > 0) {
        await this.activateSession(cwd, SessionManager.open(remainingSessions[0].path))
      }
    }

    return this.broadcastWorkspaceState(cwd)
  }

  async renameActiveSession(name: string) {
    const runtime = this.requireActiveSession()
    runtime.session.setSessionName(name.trim())
    return this.broadcastWorkspaceState(runtime.cwd)
  }

  async abortActivePrompt() {
    const runtime = this.requireActiveSession()
    await runtime.session.abort()
    return this.broadcastWorkspaceState(runtime.cwd)
  }

  async selectModel(modelKey: string) {
    const runtime = this.requireActiveSession()
    this.authStorage.reload()
    runtime.session.modelRegistry.refresh()

    const trimmedModelKey = modelKey.trim()
    const availableModels = runtime.session.modelRegistry.getAvailable()
    const selectedModel = this.resolveAvailableModel(availableModels, trimmedModelKey)

    if (!selectedModel) {
      throw new Error(`Model "${modelKey}" is not available.`)
    }

    await runtime.session.setModel(selectedModel)
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
      this.authStorage.reload()
      runtime.session.modelRegistry.refresh()
      const selectedModel = this.resolveAvailableModel(runtime.session.modelRegistry.getAvailable(), trimmedModelKey)

      if (!selectedModel) {
        throw new Error(`Model "${modelKey}" is not available.`)
      }

      if (
        runtime.session.model?.provider !== selectedModel.provider
        || runtime.session.model?.id !== selectedModel.id
      ) {
        await runtime.session.setModel(selectedModel)
      }
    }

    runtime.session.setThinkingLevel(level)
    return this.broadcastWorkspaceState(runtime.cwd)
  }

  async updateProviderAuth(cwd: string, provider: string, apiKey: string | null) {
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

  async loginProviderAuth(cwd: string, provider: string, callbacks: AgentProviderAuthLoginCallbacks) {
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

  async logoutProviderAuth(cwd: string, provider: string) {
    this.authStorage.reload()
    this.authStorage.logout(provider)
    return this.completeProviderAuthChange(cwd)
  }

  private async completeProviderAuthChange(cwd: string) {
    this.modelRegistry.refresh()

    if (this.activeRuntime?.cwd === cwd) {
      this.activeRuntime.session.modelRegistry.refresh()
      if (this.activeRuntime.session.model && !this.activeRuntime.session.modelRegistry.hasConfiguredAuth(this.activeRuntime.session.model)) {
        this.emitError(AUTH_SETUP_HINT, this.activeRuntime.session.sessionId)
      } else if (!this.activeRuntime.session.model) {
        await this.ensureModelSelected(this.activeRuntime.session)
      }

      return this.broadcastWorkspaceState(cwd)
    }

    return this.buildWorkspaceState(cwd)
  }

  async sendPrompt(prompt: string, streamingBehavior?: StreamingBehavior) {
    const runtime = this.requireActiveSession()
    const message = prompt.trim()

    if (!message) {
      throw new Error('Prompt cannot be empty.')
    }

    if (!runtime.session.model || !runtime.session.modelRegistry.hasConfiguredAuth(runtime.session.model)) {
      throw new Error(AUTH_SETUP_HINT)
    }

    const pendingPrompt = streamingBehavior === 'steer'
      ? runtime.session.steer(message)
      : streamingBehavior === 'followUp'
        ? runtime.session.followUp(message)
        : runtime.session.prompt(message)
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
    return this.serializeWorkspaceState(cwd, sessions, this.activeRuntime?.cwd === cwd ? this.activeRuntime.session : null)
  }

  private async serializeWorkspaceState(
    cwd: string,
    sessions: AgentSessionListItem[],
    session: AgentSession | null,
  ): Promise<AgentWorkspaceState> {
    return {
      activeSession: session ? await this.serializeSession(session) : null,
      runtime: await this.serializeRuntime(cwd, session),
      sessions,
    }
  }

  private async serializeRuntime(cwd: string, session: AgentSession | null): Promise<AgentRuntimeState> {
    const modelRegistry = session?.modelRegistry ?? this.modelRegistry
    const availableModels = modelRegistry.getAvailable()
    const defaultModelPerProvider = await loadPiDefaultModelPerProvider()
    const settingsManager = session?.settingsManager ?? this.createSettingsManager(cwd)
    const selectedModelValue = session?.model
      ?? (!session
        ? selectPiPreferredModel(availableModels, settingsManager, defaultModelPerProvider)
        : null)
    const selectedModel = selectedModelValue ? `${selectedModelValue.provider}/${selectedModelValue.id}` : null
    const configuredThinkingLevel = session?.thinkingLevel ?? settingsManager.getDefaultThinkingLevel() ?? 'medium'
    const availableThinkingLevels = selectedModelValue
      ? getSupportedThinkingLevels(selectedModelValue)
      : THINKING_LEVELS
    const thinkingLevel = selectedModelValue
      ? clampThinkingLevel(selectedModelValue, configuredThinkingLevel)
      : configuredThinkingLevel
    const steeringMessageCount = session?.getSteeringMessages().length ?? 0
    const followUpMessageCount = session?.getFollowUpMessages().length ?? 0

    return {
      auth: this.getProviderAuthStates(availableModels.map((model) => model.provider)),
      availableModels: availableModels.map((model) => `${model.provider}/${model.id}`),
      availableThinkingLevels,
      availableThinkingLevelsByModel: getThinkingLevelsByModel(availableModels),
      compactionReason: this.activeRuntime?.cwd === cwd ? this.activeRuntime.status.compactionReason : null,
      followUpMessageCount,
      followUpMode: session?.followUpMode ?? 'one-at-a-time',
      hasConfiguredModels: availableModels.length > 0,
      isCompacting: session?.isCompacting ?? false,
      isStreaming: session?.isStreaming ?? false,
      pendingMessageCount: session?.pendingMessageCount ?? 0,
      preferredModelByProvider: getProviderPreferredModelKeys(availableModels, defaultModelPerProvider),
      retryAttempt: session?.retryAttempt ?? 0,
      retryMaxAttempts: this.activeRuntime?.cwd === cwd ? this.activeRuntime.status.retryMaxAttempts : null,
      selectedModel,
      setupHint: availableModels.length > 0 ? null : AUTH_SETUP_HINT,
      supportsThinking: Boolean(selectedModelValue?.reasoning),
      steeringMessageCount,
      steeringMode: session?.steeringMode ?? 'one-at-a-time',
      thinkingLevel,
      workspacePath: cwd,
    }
  }

  private async serializeSession(session: AgentSession): Promise<AgentSessionSnapshot> {
    const branchEntries = session.sessionManager.getBranch()
    const messages = serializeSessionEntries(branchEntries)
    const workspacePath = this.activeRuntime?.cwd ?? ''
    const annotations = session.sessionFile
      ? filterAnnotationsByDirectToolPaths(
        await this.annotationStore.read(session.sessionFile),
        collectDirectToolPathsByEntryId(branchEntries, workspacePath),
      )
      : { fileChangesByEntryId: {} }

    return {
      annotations,
      messages,
      name: session.sessionName ?? null,
      sessionId: session.sessionId,
      sessionPath: session.sessionFile ?? null,
      workspacePath,
    }
  }

  private async listSessions(cwd: string): Promise<AgentSessionListItem[]> {
    const sessions = await SessionManager.list(cwd, this.getSessionDir(cwd))

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

  private async resolveRestorableSessionPath(cwd: string, preferredSessionPath: string | null) {
    if (preferredSessionPath) {
      try {
        const resolvedSessionPath = this.resolveSessionPath(cwd, preferredSessionPath)
        return await pathExists(resolvedSessionPath) ? resolvedSessionPath : null
      } catch {
        return null
      }
    }

    const sessions = await this.listSessions(cwd)
    return sessions[0]?.path ?? null
  }

  private getSessionDir(cwd: string) {
    return path.join(cwd, '.pi', 'sessions')
  }

  private resolveSessionPath(cwd: string, sessionPath: string) {
    const resolvedSessionDir = path.resolve(this.getSessionDir(cwd))
    const resolvedSessionPath = path.resolve(sessionPath)
    const relativeSessionPath = path.relative(resolvedSessionDir, resolvedSessionPath)

    if (
      relativeSessionPath.startsWith('..')
      || path.isAbsolute(relativeSessionPath)
      || path.extname(resolvedSessionPath).toLowerCase() !== '.jsonl'
    ) {
      throw new Error('Invalid session path.')
    }

    return resolvedSessionPath
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
