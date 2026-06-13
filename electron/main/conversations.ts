import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type {
  ConversationRecord,
  ConversationState,
  ConversationStatus,
  ConversationTitleSource,
  CreateConversationWorkspaceRequest,
  UpdateConversationRequest,
} from '../../src/features/conversations/types'
import { AtomicJsonStore } from './json-file-store'
import { ensureUsableFolderName } from './path-names'

const CONVERSATION_INDEX_SCHEMA_VERSION = 2
const DEFAULT_CONVERSATION_TITLE = '新对话'
const DEFAULT_CONVERSATION_SLUG = 'conversation'

const DEFAULT_CONVERSATION_STATE: ConversationState = {
  version: CONVERSATION_INDEX_SCHEMA_VERSION,
  conversations: [],
}

export type ConversationDraftCleanupResult = {
  removedDrafts: ConversationRecord[]
  state: ConversationState
}

function cloneState(state: ConversationState) {
  return structuredClone(state)
}

function readNullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function readDateString(value: unknown, fallback: string) {
  const dateString = readNullableString(value)
  return dateString && Number.isFinite(Date.parse(dateString)) ? dateString : fallback
}

function readConversationStatus(value: unknown): ConversationStatus {
  return value === 'draft' || value === 'active' ? value : 'active'
}

function isConversationTitleSource(value: unknown): value is ConversationTitleSource {
  return value === 'default' || value === 'prompt' || value === 'agent' || value === 'user'
}

function readConversationTitleSource(
  value: unknown,
  title: string,
  lastMessagePreview: string | null,
): ConversationTitleSource {
  if (isConversationTitleSource(value)) {
    return value
  }

  if (title === DEFAULT_CONVERSATION_TITLE) {
    return 'default'
  }

  if (lastMessagePreview && title.trim() === lastMessagePreview.trim()) {
    return 'prompt'
  }

  return 'user'
}

function readConversationTitleSourcePatch(value: unknown): ConversationTitleSource | null {
  return isConversationTitleSource(value) ? value : null
}

function readConversationRecord(value: unknown): ConversationRecord | null {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  const id = readNullableString(candidate.id)

  if (!id) {
    return null
  }

  const fallbackDate = new Date(0).toISOString()
  const createdAt = readDateString(candidate.createdAt, fallbackDate)
  const title = readNullableString(candidate.title) ?? DEFAULT_CONVERSATION_TITLE
  const lastMessagePreview = readNullableString(candidate.lastMessagePreview)

  return {
    id,
    title,
    titleSource: readConversationTitleSource(candidate.titleSource, title, lastMessagePreview),
    createdAt,
    updatedAt: readDateString(candidate.updatedAt, createdAt),
    status: readConversationStatus(candidate.status),
    workspacePath: readNullableString(candidate.workspacePath),
    agentSessionPath: readNullableString(candidate.agentSessionPath),
    lastMessagePreview,
  }
}

function normalizeConversationState(value: unknown): ConversationState {
  if (!value || typeof value !== 'object') {
    return cloneState(DEFAULT_CONVERSATION_STATE)
  }

  const candidate = value as Record<string, unknown>
  const conversations = Array.isArray(candidate.conversations)
    ? candidate.conversations
      .map(readConversationRecord)
      .filter((record): record is ConversationRecord => Boolean(record))
    : []
  const recordsById = new Map<string, ConversationRecord>()

  for (const record of conversations) {
    recordsById.set(record.id, record)
  }

  return {
    version: CONVERSATION_INDEX_SCHEMA_VERSION,
    conversations: [...recordsById.values()].sort((left, right) => (
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    )),
  }
}

function getLocalDateStamp(date = new Date()) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizePromptTitle(value: unknown) {
  const raw = typeof value === 'string' ? value : ''
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)

  if (!firstLine) {
    return DEFAULT_CONVERSATION_TITLE
  }

  return firstLine.replace(/\s+/g, ' ').slice(0, 48)
}

function sanitizeConversationFolderName(value: string) {
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+$/, '')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 64)
    .trim()

  return ensureUsableFolderName(sanitized, DEFAULT_CONVERSATION_SLUG)
}

function isAlreadyExistsError(error: unknown) {
  return error && typeof error === 'object' && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'EEXIST'
}

async function createUniqueConversationPath(parentPath: string, folderName: string) {
  const basePath = path.join(parentPath, folderName)

  for (let index = 0; index < 1000; index += 1) {
    const candidatePath = index === 0 ? basePath : `${basePath}-${index + 1}`

    try {
      await mkdir(candidatePath)
      return candidatePath
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error
      }
    }
  }

  throw new Error('Unable to find an available conversation folder name.')
}

function normalizeConversationPatch(patch: UpdateConversationRequest = {}) {
  const hasTitle = Object.prototype.hasOwnProperty.call(patch, 'title')
  const normalizedTitle = hasTitle
    ? readNullableString(patch.title) ?? DEFAULT_CONVERSATION_TITLE
    : undefined
  const normalizedTitleSource = readConversationTitleSourcePatch(patch.titleSource)

  return {
    ...(Object.prototype.hasOwnProperty.call(patch, 'agentSessionPath')
      ? { agentSessionPath: readNullableString(patch.agentSessionPath) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'lastMessagePreview')
      ? { lastMessagePreview: readNullableString(patch.lastMessagePreview) }
      : {}),
    ...(patch.status === 'draft' || patch.status === 'active' ? { status: patch.status } : {}),
    ...(hasTitle
      ? {
          title: normalizedTitle,
          titleSource: normalizedTitleSource ?? (normalizedTitle === DEFAULT_CONVERSATION_TITLE ? 'default' : 'user'),
        }
      : {}),
    ...(!hasTitle && normalizedTitleSource ? { titleSource: normalizedTitleSource } : {}),
  }
}

export class ConversationStore {
  private readonly store: AtomicJsonStore<ConversationState>

  constructor(
    private readonly indexPath: string,
    private readonly documentsPath: string,
  ) {
    this.store = new AtomicJsonStore({
      defaultState: () => cloneState(DEFAULT_CONVERSATION_STATE),
      filePath: this.indexPath,
      normalize: normalizeConversationState,
    })
  }

  async read(): Promise<ConversationState> {
    return this.store.read()
  }

  async createWorkspace(request: CreateConversationWorkspaceRequest = {}): Promise<ConversationRecord> {
    const title = normalizePromptTitle(request.initialPrompt)
    const createdAt = new Date().toISOString()
    const dateStamp = getLocalDateStamp(new Date())
    const parentPath = path.join(this.documentsPath, 'Aryn', dateStamp)
    const folderName = sanitizeConversationFolderName(title)
    await mkdir(parentPath, { recursive: true })
    const workspacePath = await createUniqueConversationPath(parentPath, folderName)

    const record: ConversationRecord = {
      id: randomUUID(),
      title,
      titleSource: title === DEFAULT_CONVERSATION_TITLE ? 'default' : 'prompt',
      createdAt,
      updatedAt: createdAt,
      status: 'draft',
      workspacePath,
      agentSessionPath: null,
      lastMessagePreview: title === DEFAULT_CONVERSATION_TITLE ? null : title,
    }

    await this.updateState((currentState) => ({
      ...currentState,
      conversations: [
        record,
        ...currentState.conversations.filter((conversation) => conversation.id !== record.id),
      ],
    }))

    return structuredClone(record)
  }

  async updateConversation(conversationId: string, patch: UpdateConversationRequest): Promise<ConversationRecord> {
    const normalizedId = typeof conversationId === 'string' ? conversationId : ''
    const patchValue = normalizeConversationPatch(patch)

    const nextState = await this.updateState((currentState) => {
      const conversations = currentState.conversations.map((conversation) => {
        if (conversation.id !== normalizedId) {
          return conversation
        }

        return {
          ...conversation,
          ...patchValue,
          updatedAt: new Date().toISOString(),
        }
      })

      return {
        ...currentState,
        conversations,
      }
    })

    const updatedRecord = nextState.conversations.find((conversation) => conversation.id === normalizedId) ?? null

    if (!updatedRecord) {
      throw new Error('Conversation not found.')
    }

    return structuredClone(updatedRecord)
  }

  async removeDraft(conversationId: string): Promise<ConversationState> {
    const normalizedId = typeof conversationId === 'string' ? conversationId : ''
    let removedDraft: ConversationRecord | null = null

    const nextState = await this.updateState((currentState) => ({
      ...currentState,
      conversations: currentState.conversations.filter((conversation) => {
        const shouldRemove = conversation.id === normalizedId && conversation.status === 'draft'

        if (shouldRemove) {
          removedDraft = conversation
        }

        return !shouldRemove
      }),
    }))

    const removedDraftRecord = removedDraft as ConversationRecord | null
    if (removedDraftRecord?.workspacePath) {
      await this.removeDisposableDraftWorkspace(removedDraftRecord.workspacePath)
    }

    return nextState
  }

  async removeConversation(conversationId: string): Promise<ConversationState> {
    const normalizedId = typeof conversationId === 'string' ? conversationId : ''

    return this.updateState((currentState) => {
      const conversations = currentState.conversations.filter((conversation) => (
        conversation.id !== normalizedId
      ))

      if (conversations.length === currentState.conversations.length) {
        throw new Error('Conversation not found.')
      }

      return {
        ...currentState,
        conversations,
      }
    })
  }

  async cleanupDrafts(): Promise<ConversationDraftCleanupResult> {
    const currentState = await this.read()
    const draftRecords = currentState.conversations.filter((conversation) => conversation.status === 'draft')

    if (draftRecords.length === 0) {
      return {
        removedDrafts: [],
        state: currentState,
      }
    }

    const nextState = await this.updateState((state) => ({
      ...state,
      conversations: state.conversations.filter((conversation) => conversation.status !== 'draft'),
    }))

    await Promise.all(draftRecords.map((conversation) => (
      conversation.workspacePath
        ? this.removeDisposableDraftWorkspace(conversation.workspacePath)
        : Promise.resolve()
    )))

    return {
      removedDrafts: draftRecords,
      state: nextState,
    }
  }

  private async removeDisposableDraftWorkspace(workspacePath: string) {
    const managedRootPath = path.resolve(this.documentsPath, 'Aryn')
    const resolvedWorkspacePath = path.resolve(workspacePath)
    const relativeWorkspacePath = path.relative(managedRootPath, resolvedWorkspacePath)

    if (
      !relativeWorkspacePath
      || relativeWorkspacePath.startsWith('..')
      || path.isAbsolute(relativeWorkspacePath)
    ) {
      return
    }

    try {
      const entries = await readdir(resolvedWorkspacePath, { withFileTypes: true })
      const containsUserContent = entries.some((entry) => entry.name !== '.pi')

      if (!containsUserContent) {
        await rm(resolvedWorkspacePath, { recursive: true, force: true })
      }
    } catch {
      // Draft cleanup is best effort. Never fail index cleanup because a workspace
      // contains concurrent user changes or is temporarily inaccessible.
    }
  }

  private async updateState(updater: (currentState: ConversationState) => ConversationState) {
    return this.store.update(updater)
  }
}
