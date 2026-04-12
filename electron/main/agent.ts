import { lstat, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import {
  AuthStorage,
  createAgentSession,
  createCodingTools,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type SessionEntry,
  type AgentSession,
} from '@mariozechner/pi-coding-agent'
import { complete, type Api, type AssistantMessage, type Model, type TextContent, type ToolResultMessage, type UserMessage } from '@mariozechner/pi-ai'
import type {
  AgentMessageFileChange,
  AgentClientEvent,
  AgentProviderAuthState,
  AgentRuntimeState,
  AgentSessionListItem,
  AgentSessionAnnotations,
  AgentSessionSnapshot,
  AgentSidebarMessage,
  AgentWorkspaceState,
} from '../../src/features/agent/types'
import type { WorkspaceChangeEvent } from '../../src/features/workspace/types'
import { AgentSessionAnnotationStore } from './agent-session-annotations'

type ActiveSessionRuntime = {
  activity: {
    activeToolOwnerEntryId: string | null
    lastToolExecutionAt: number | null
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

const OPENROUTER_ENV_KEY = 'OPENROUTER_API_KEY'
const OPENROUTER_PROVIDER = 'openrouter'
const OPENAI_ENV_KEY = 'OPENAI_API_KEY'
const OPENAI_PROVIDER = 'openai'
const GOOGLE_ENV_KEY = 'GEMINI_API_KEY'
const GOOGLE_PROVIDER = 'google'
const AUTO_SESSION_NAME_MODEL_ID = 'openrouter/free'
const AUTO_SESSION_NAME_MAX_TOKENS = 48
const AUTH_SETUP_HINT = `No authenticated models are available. Add an API key in Agent Auth or set ${OPENROUTER_ENV_KEY}, ${OPENAI_ENV_KEY}, or ${GOOGLE_ENV_KEY}.`
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

function extractWritableToolFilePath(cwd: string, toolName: string, args: unknown) {
  if (!args || typeof args !== 'object') {
    return null
  }

  if (toolName !== 'write' && toolName !== 'edit') {
    return null
  }

  const candidate = (args as { path?: unknown }).path
  if (typeof candidate !== 'string' || !candidate.trim()) {
    return null
  }

  return path.resolve(cwd, candidate)
}

function unquoteShellToken(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith('\'') && value.endsWith('\''))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function tokenizeShellCommand(command: string) {
  const matches = command.match(/"[^"]*"|'[^']*'|[^\s]+/g)
  return matches?.map((token) => token.trim()).filter(Boolean) ?? []
}

function getOptionValue(tokens: string[], names: string[]) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]?.toLowerCase()

    if (!token || !names.includes(token)) {
      continue
    }

    const nextToken = tokens[index + 1]
    if (!nextToken || nextToken.startsWith('-')) {
      return null
    }

    return unquoteShellToken(nextToken)
  }

  return null
}

function resolveShellPath(cwd: string, candidate: string | null, relativeBasePath?: string) {
  if (!candidate) {
    return null
  }

  const normalizedCandidate = unquoteShellToken(candidate).trim()
  if (!normalizedCandidate || normalizedCandidate.startsWith('-')) {
    return null
  }

  if (relativeBasePath && !/[\\/]/.test(normalizedCandidate) && !path.isAbsolute(normalizedCandidate)) {
    return path.resolve(path.dirname(relativeBasePath), normalizedCandidate)
  }

  return path.resolve(cwd, normalizedCandidate)
}

function extractBashFileChanges(cwd: string, args: unknown): AgentMessageFileChange[] {
  if (!args || typeof args !== 'object') {
    return []
  }

  const command = (args as { command?: unknown }).command
  if (typeof command !== 'string' || !command.trim()) {
    return []
  }

  const changes: AgentMessageFileChange[] = []
  const segments = command
    .split(/\r?\n|&&|\|\||;/)
    .map((segment) => segment.trim())
    .filter(Boolean)

  for (const segment of segments) {
    const tokens = tokenizeShellCommand(segment)
    if (tokens.length === 0) {
      continue
    }

    const commandName = unquoteShellToken(tokens[0]).toLowerCase()

    if (commandName === 'rm' || commandName === 'del' || commandName === 'erase' || commandName === 'unlink') {
      tokens
        .slice(1)
        .filter((token) => token && !token.startsWith('-'))
        .forEach((token) => {
          const filePath = resolveShellPath(cwd, token)
          if (filePath) {
            changes.push({ filePath, kind: 'deleted' })
          }
        })
      continue
    }

    if (commandName === 'remove-item') {
      const candidate = getOptionValue(tokens, ['-path', '-literalpath'])
      const filePath = resolveShellPath(cwd, candidate)

      if (filePath) {
        changes.push({ filePath, kind: 'deleted' })
      }

      continue
    }

    if (commandName === 'mv' || commandName === 'move' || commandName === 'ren') {
      const positionalArgs = tokens.slice(1).filter((token) => token && !token.startsWith('-'))
      if (positionalArgs.length >= 2) {
        const sourcePath = resolveShellPath(cwd, positionalArgs[0])
        const targetPath = resolveShellPath(cwd, positionalArgs[1], sourcePath ?? undefined)

        if (sourcePath && targetPath) {
          changes.push({ filePath: sourcePath, kind: 'deleted' })
          changes.push({ filePath: targetPath, kind: 'created' })
        }
      }

      continue
    }

    if (commandName === 'move-item' || commandName === 'rename-item') {
      const sourcePath = resolveShellPath(cwd, getOptionValue(tokens, ['-path', '-literalpath']))
      const targetToken = getOptionValue(tokens, ['-destination', '-newname'])
      const targetPath = resolveShellPath(cwd, targetToken, sourcePath ?? undefined)

      if (sourcePath && targetPath) {
        changes.push({ filePath: sourcePath, kind: 'deleted' })
        changes.push({ filePath: targetPath, kind: 'created' })
      }
    }
  }

  return changes
}

function resolveDirectToolFileChangeKind(
  toolName: string,
  existedBeforeWrite: boolean | null,
): 'created' | 'updated' | null {
  if (toolName === 'edit') {
    return 'updated'
  }

  if (toolName === 'write') {
    return existedBeforeWrite === false ? 'created' : 'updated'
  }

  return null
}

function collectDirectToolPathsByEntryId(entries: SessionEntry[], cwd: string) {
  const filePathsByEntryId = new Map<string, Set<string>>()

  for (const entry of entries) {
    if (entry.type !== 'message' || !('role' in entry.message) || entry.message.role !== 'assistant') {
      continue
    }

    const toolCalls = entry.message.content.filter((block) => block.type === 'toolCall')
    if (toolCalls.length === 0) {
      continue
    }

    const entryPaths = filePathsByEntryId.get(entry.id) ?? new Set<string>()

    for (const toolCall of toolCalls) {
      const directFilePath = extractWritableToolFilePath(cwd, toolCall.name, toolCall.arguments)
      if (directFilePath) {
        entryPaths.add(directFilePath)
      }

      if (toolCall.name === 'bash') {
        extractBashFileChanges(cwd, toolCall.arguments).forEach((change) => {
          entryPaths.add(change.filePath)
        })
      }
    }

    if (entryPaths.size > 0) {
      filePathsByEntryId.set(entry.id, entryPaths)
    }
  }

  return filePathsByEntryId
}

function filterAnnotationsByDirectToolPaths(
  annotations: AgentSessionAnnotations,
  directToolPathsByEntryId: Map<string, Set<string>>,
): AgentSessionAnnotations {
  return {
    fileChangesByEntryId: Object.fromEntries(
      Object.entries(annotations.fileChangesByEntryId)
        .map(([entryId, changes]) => {
          const allowedPaths = directToolPathsByEntryId.get(entryId)

          if (!allowedPaths) {
            return null
          }

          const filteredChanges = changes.filter((change) => allowedPaths.has(change.filePath))
          return filteredChanges.length > 0 ? [entryId, filteredChanges] : null
        })
        .filter((entry): entry is [string, AgentMessageFileChange[]] => entry !== null),
    ),
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
                status: 'done',
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
    this.modelRegistry = new ModelRegistry(this.authStorage, path.join(options.agentDir, 'models.json'))
  }

  async loadWorkspaceState(cwd: string, preferredSessionPath: string | null = null): Promise<AgentWorkspaceState> {
    if (this.activeRuntime?.cwd !== cwd) {
      await this.releaseActiveSession()
    }

    if (!this.activeRuntime) {
      const nextSessionManager = preferredSessionPath
        ? SessionManager.open(preferredSessionPath)
        : SessionManager.continueRecent(cwd, this.getSessionDir(cwd))

      try {
        await this.activateSession(cwd, nextSessionManager)
      } catch {
        return this.buildWorkspaceState(cwd)
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
    await this.activateSession(cwd, SessionManager.open(sessionPath))
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
    const selectedModel = availableModels.find((model) => `${model.provider}/${model.id}` === trimmedModelKey)
      ?? availableModels.find((model) => `${model.provider}/${model.id}` === `${OPENROUTER_PROVIDER}/${trimmedModelKey}`)
      ?? availableModels.find((model) => model.provider === OPENROUTER_PROVIDER && model.id === trimmedModelKey)

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

  async updateProviderAuth(cwd: string, provider: string, apiKey: string | null) {
    this.authStorage.reload()

    const trimmedApiKey = apiKey?.trim()
    if (trimmedApiKey) {
      this.authStorage.set(provider, {
        type: 'api_key',
        key: trimmedApiKey,
      })
    } else {
      this.authStorage.remove(provider)
    }

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

  async handleWorkspaceChange(event: WorkspaceChangeEvent) {
    void event
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
      tools: createCodingTools(cwd),
    })

    await this.ensureModelSelected(session)
    this.emitSetupDiagnostics(session, extensionsResult.errors, modelFallbackMessage)

    const unsubscribe = session.subscribe((event) => {
      void this.handleSessionEvent(session, event)
    })

    this.activeRuntime = {
      activity: {
        activeToolOwnerEntryId: null,
        lastToolExecutionAt: null,
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

  private async ensureModelSelected(session: AgentSession) {
    if (session.model) {
      return
    }

    const availableModels = session.modelRegistry.getAvailable()

    if (availableModels.length === 0) {
      return
    }

    const preferredProvider = session.settingsManager.getDefaultProvider()
    const preferredModel = session.settingsManager.getDefaultModel()
    const preferredSelection = preferredProvider && preferredModel
      ? availableModels.find((model) => model.provider === preferredProvider && model.id === preferredModel)
      : null

    await session.setModel(preferredSelection ?? availableModels[0])
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
      if (runtime.activity.runningToolCalls.size === 0) {
        runtime.activity.activeToolOwnerEntryId = this.findLatestAssistantEntryId(session) ?? runtime.activity.pendingAssistantEntryId
      }

      const directFilePath = extractWritableToolFilePath(runtime.cwd, event.toolName, event.args)
      const existedBeforeWrite = event.toolName === 'write' && directFilePath
        ? await pathExists(directFilePath)
        : null

      runtime.activity.runningToolCalls.set(event.toolCallId, {
        existedBeforeWrite,
        filePath: directFilePath,
        ownerEntryId: runtime.activity.activeToolOwnerEntryId,
        parsedFileChanges: event.toolName === 'bash' ? extractBashFileChanges(runtime.cwd, event.args) : [],
        toolName: event.toolName,
      })
      runtime.activity.lastToolExecutionAt = Date.now()
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
      runtime.activity.lastToolExecutionAt = Date.now()

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
      runtime: this.serializeRuntime(cwd, session),
      sessions,
    }
  }

  private serializeRuntime(cwd: string, session: AgentSession | null): AgentRuntimeState {
    const availableModels = (session?.modelRegistry ?? this.modelRegistry).getAvailable()
    const selectedModel = session?.model ? `${session.model.provider}/${session.model.id}` : null
    const steeringMessageCount = session?.getSteeringMessages().length ?? 0
    const followUpMessageCount = session?.getFollowUpMessages().length ?? 0

    return {
      auth: {
        google: this.getProviderAuthState(GOOGLE_PROVIDER, GOOGLE_ENV_KEY),
        openai: this.getProviderAuthState(OPENAI_PROVIDER, OPENAI_ENV_KEY),
        openrouter: this.getOpenRouterAuthState(),
      },
      availableModels: availableModels.map((model) => `${model.provider}/${model.id}`),
      compactionReason: this.activeRuntime?.cwd === cwd ? this.activeRuntime.status.compactionReason : null,
      followUpMessageCount,
      followUpMode: session?.followUpMode ?? 'one-at-a-time',
      hasConfiguredModels: availableModels.length > 0,
      isCompacting: session?.isCompacting ?? false,
      isStreaming: session?.isStreaming ?? false,
      pendingMessageCount: session?.pendingMessageCount ?? 0,
      retryAttempt: session?.retryAttempt ?? 0,
      retryMaxAttempts: this.activeRuntime?.cwd === cwd ? this.activeRuntime.status.retryMaxAttempts : null,
      selectedModel,
      setupHint: availableModels.length > 0 ? null : AUTH_SETUP_HINT,
      steeringMessageCount,
      steeringMode: session?.steeringMode ?? 'one-at-a-time',
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

  private getOpenRouterAuthState(): AgentProviderAuthState {
    return this.getProviderAuthState(OPENROUTER_PROVIDER, OPENROUTER_ENV_KEY)
  }

  private getProviderAuthState(provider: string, envVarName: string): AgentProviderAuthState {
    const hasEnvironmentCredential = Boolean(process.env[envVarName]?.trim())
    const hasStoredCredential = this.authStorage.has(provider)
    const source = hasStoredCredential
      ? 'stored'
      : hasEnvironmentCredential
        ? 'env'
        : 'none'

    return {
      envVarName,
      hasStoredCredential,
      source,
      usesEnvironmentCredential: source === 'env',
    }
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
