import { createReadStream } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import type { Thread } from '../../../../shared/agent-contracts/providers/codex/protocol/generated/v2/Thread'
import type { ThreadItem } from '../../../../shared/agent-contracts/providers/codex/protocol/generated/v2/ThreadItem'
import type { Turn } from '../../../../shared/agent-contracts/providers/codex/protocol/generated/v2/Turn'
import type { WebSearchAction } from '../../../../shared/agent-contracts/providers/codex/protocol/generated/v2/WebSearchAction'
import { createWorkspaceIdentity as workspaceIdentity } from '../../runtime/runtime-keys'
import type { CodexThreadRecord } from './session-model'

const MAX_FULL_ROLLOUT_BYTES = 16 * 1024 * 1024
const MAX_CACHED_ROLLOUTS = 8

type JsonRecord = Record<string, unknown>

type CachedRollout = {
  signature: string
  thread: Thread
}

function recordValue(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function timestampSeconds(value: unknown, fallback: number) {
  const parsed = Date.parse(stringValue(value))
  return Number.isFinite(parsed) ? parsed / 1_000 : fallback
}

function fileSignature(value: Awaited<ReturnType<typeof stat>>) {
  return `${value.size}:${value.mtimeMs}:${value.ctimeMs}`
}

function codexHome() {
  const configured = process.env.CODEX_HOME?.trim()
  return configured ? path.resolve(configured) : path.join(os.homedir(), '.codex')
}

function isPathInside(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function dateDirectoryParts(createdAt: string) {
  const created = new Date(createdAt)
  if (!Number.isFinite(created.getTime())) return []
  const values: string[][] = []
  for (let offset = -2; offset <= 2; offset += 1) {
    const candidate = new Date(created)
    candidate.setDate(candidate.getDate() + offset)
    values.push([
      String(candidate.getFullYear()),
      String(candidate.getMonth() + 1).padStart(2, '0'),
      String(candidate.getDate()).padStart(2, '0'),
    ])
  }
  return values
}

function responseTurnId(payload: JsonRecord, currentTurnId: string | null) {
  const metadata = recordValue(payload.internal_chat_message_metadata_passthrough)
  return stringValue(metadata?.turn_id)
    || stringValue(payload.turn_id)
    || stringValue(payload.turnId)
    || currentTurnId
}

function contentText(value: unknown) {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.flatMap((entry) => {
    const block = recordValue(entry)
    if (!block) return []
    const type = stringValue(block.type)
    return type === 'input_text' || type === 'output_text' || type === 'text'
      ? [stringValue(block.text)]
      : []
  }).filter(Boolean).join('\n')
}

function userContent(value: unknown): Extract<ThreadItem, { type: 'userMessage' }>['content'] {
  if (typeof value === 'string') {
    return value ? [{ text: value, text_elements: [], type: 'text' }] : []
  }
  if (!Array.isArray(value)) return []
  const content: Extract<ThreadItem, { type: 'userMessage' }>['content'] = []
  for (const entry of value) {
    const block = recordValue(entry)
    if (!block) continue
    const type = stringValue(block.type)
    const text = stringValue(block.text)
    if ((type === 'input_text' || type === 'text') && text) {
      content.push({ text, text_elements: [], type: 'text' })
      continue
    }
    const url = stringValue(block.image_url) || stringValue(block.url)
    if (type === 'input_image' && url) {
      content.push({ type: 'image', url })
    }
  }
  return content
}

function reasoningText(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry === 'string') return entry ? [entry] : []
    const summary = recordValue(entry)
    const text = stringValue(summary?.text)
    return text ? [text] : []
  })
}

function commandFromInput(value: unknown) {
  if (typeof value !== 'string') return ''
  try {
    const parsed = recordValue(JSON.parse(value))
    return stringValue(parsed?.cmd) || stringValue(parsed?.command) || value
  } catch {
    return value
  }
}

function toolCommand(name: string, input: unknown) {
  const parsedCommand = commandFromInput(input)
  if (!parsedCommand) return name || 'Tool call'
  if (!name || ['exec', 'exec_command', 'shell_command'].includes(name)) return parsedCommand
  return name
}

function commandStatus(value: unknown): Extract<ThreadItem, { type: 'commandExecution' }>['status'] {
  const status = stringValue(value).toLowerCase()
  if (status === 'completed') return 'completed'
  if (status === 'failed' || status === 'incomplete') return 'failed'
  if (status === 'declined') return 'declined'
  return 'inProgress'
}

function webSearchDetails(value: unknown): { action: WebSearchAction | null; query: string } {
  const action = recordValue(value)
  if (!action) return { action: null, query: '' }
  const type = stringValue(action.type)
  if (type === 'search') {
    const queries = Array.isArray(action.queries)
      ? action.queries.filter((entry): entry is string => typeof entry === 'string')
      : []
    const query = stringValue(action.query) || queries[0] || ''
    return {
      action: {
        type: 'search',
        query: query || null,
        queries: queries.length > 0 ? queries : null,
      },
      query,
    }
  }
  if (type === 'open_page') {
    const url = stringValue(action.url)
    return { action: { type: 'openPage', url: url || null }, query: url }
  }
  if (type === 'find_in_page') {
    const pattern = stringValue(action.pattern)
    const url = stringValue(action.url)
    return {
      action: {
        type: 'findInPage',
        pattern: pattern || null,
        url: url || null,
      },
      query: pattern || url,
    }
  }
  return { action: { type: 'other' }, query: '' }
}

function normalizeSource(value: unknown): Thread['source'] {
  const source = stringValue(value)
  return source === 'cli'
    || source === 'vscode'
    || source === 'exec'
    || source === 'appServer'
    || source === 'unknown'
    ? source
    : source
      ? { custom: source }
      : 'vscode'
}

async function buildThread(
  record: CodexThreadRecord,
  rolloutPath: string,
  lines: Iterable<string> | AsyncIterable<string>,
): Promise<Thread> {
  const createdAt = Date.parse(record.createdAt) / 1_000
  const updatedAt = Date.parse(record.updatedAt) / 1_000
  const fallbackCreatedAt = Number.isFinite(createdAt) ? createdAt : 0
  let header: JsonRecord | null = null
  let currentTurnId: string | null = null
  let latestTimestamp = Number.isFinite(updatedAt) ? updatedAt : fallbackCreatedAt
  let sequence = 0
  const turns: Turn[] = []
  const turnsById = new Map<string, Turn>()
  const itemsById = new Map<string, ThreadItem>()

  const ensureTurn = (turnId: string | null, timestamp: number) => {
    const id = turnId || `local-turn-${sequence}`
    const existing = turnsById.get(id)
    if (existing) return existing
    const turn: Turn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id,
      items: [],
      itemsView: 'full',
      startedAt: timestamp,
      status: 'inProgress',
    }
    turnsById.set(id, turn)
    turns.push(turn)
    return turn
  }

  for await (const line of lines) {
    if (!line.trim()) continue
    let row: JsonRecord
    try {
      const parsed = recordValue(JSON.parse(line))
      if (!parsed) continue
      row = parsed
    } catch {
      continue
    }
    sequence += 1
    const payload = recordValue(row.payload) ?? {}
    const rowTimestamp = timestampSeconds(row.timestamp, latestTimestamp)
    latestTimestamp = Math.max(latestTimestamp, rowTimestamp)
    const rowType = stringValue(row.type)
    const payloadType = stringValue(payload.type)

    if (rowType === 'session_meta') {
      header = payload
      continue
    }
    if (rowType === 'turn_context') {
      currentTurnId = stringValue(payload.turn_id) || currentTurnId
      if (currentTurnId) ensureTurn(currentTurnId, rowTimestamp)
      continue
    }
    if (rowType === 'event_msg' && payloadType === 'task_started') {
      currentTurnId = stringValue(payload.turn_id) || `local-turn-${sequence}`
      const turn = ensureTurn(currentTurnId, numberValue(payload.started_at) ?? rowTimestamp)
      turn.status = 'inProgress'
      continue
    }
    if (rowType === 'event_msg' && payloadType === 'task_complete') {
      const turnId = stringValue(payload.turn_id) || currentTurnId
      const turn = ensureTurn(turnId, rowTimestamp)
      turn.completedAt = numberValue(payload.completed_at) ?? rowTimestamp
      turn.durationMs = numberValue(payload.duration_ms)
      turn.status = 'completed'
      continue
    }
    if (rowType === 'event_msg' && payloadType === 'turn_aborted') {
      const turnId = stringValue(payload.turn_id) || currentTurnId
      const turn = ensureTurn(turnId, rowTimestamp)
      turn.completedAt = rowTimestamp
      turn.status = 'interrupted'
      continue
    }
    if (rowType !== 'response_item') continue

    const turnId = responseTurnId(payload, currentTurnId)
    const turn = ensureTurn(turnId, rowTimestamp)
    currentTurnId = turn.id
    const itemId = stringValue(payload.id)
      || stringValue(payload.call_id)
      || `local-item-${sequence}`

    if (payloadType === 'message') {
      const role = stringValue(payload.role)
      const text = contentText(payload.content)
      if (role !== 'user' && role !== 'assistant') continue
      const item: ThreadItem = role === 'user'
        ? {
            clientId: null,
            content: userContent(payload.content),
            id: itemId,
            type: 'userMessage',
          }
        : {
            id: itemId,
            memoryCitation: null,
            phase: payload.phase === 'commentary' || payload.phase === 'final_answer'
              ? payload.phase
              : null,
            text,
            type: 'agentMessage',
          }
      if (
        (item.type === 'userMessage' && item.content.length === 0)
        || (item.type === 'agentMessage' && !item.text)
      ) continue
      turn.items.push(item)
      itemsById.set(itemId, item)
      continue
    }
    if (payloadType === 'reasoning') {
      const item: ThreadItem = {
        content: reasoningText(payload.content),
        id: itemId,
        summary: reasoningText(payload.summary),
        type: 'reasoning',
      }
      turn.items.push(item)
      itemsById.set(itemId, item)
      continue
    }
    if (payloadType === 'custom_tool_call' || payloadType === 'function_call') {
      const callId = stringValue(payload.call_id) || itemId
      const name = stringValue(payload.name)
      const input = payloadType === 'function_call' ? payload.arguments : payload.input
      const item: ThreadItem = {
        aggregatedOutput: null,
        command: toolCommand(name, input),
        commandActions: [],
        cwd: record.cwd,
        durationMs: null,
        exitCode: null,
        id: callId,
        processId: null,
        source: 'agent',
        status: commandStatus(payload.status),
        type: 'commandExecution',
      }
      turn.items.push(item)
      itemsById.set(callId, item)
      continue
    }
    if (payloadType === 'local_shell_call') {
      const callId = stringValue(payload.call_id) || itemId
      const action = recordValue(payload.action)
      const command = Array.isArray(action?.command)
        ? action.command.filter((entry): entry is string => typeof entry === 'string').join(' ')
        : ''
      const item: ThreadItem = {
        aggregatedOutput: null,
        command: command || 'Shell command',
        commandActions: [],
        cwd: stringValue(action?.working_directory) || record.cwd,
        durationMs: null,
        exitCode: null,
        id: callId,
        processId: null,
        source: 'agent',
        status: commandStatus(payload.status),
        type: 'commandExecution',
      }
      turn.items.push(item)
      itemsById.set(callId, item)
      continue
    }
    if (payloadType === 'custom_tool_call_output' || payloadType === 'function_call_output') {
      const callId = stringValue(payload.call_id)
      const item = itemsById.get(callId)
      if (item?.type === 'commandExecution') {
        item.aggregatedOutput = contentText(payload.output)
        item.status = 'completed'
      }
      continue
    }
    if (payloadType === 'web_search_call') {
      const { action, query } = webSearchDetails(payload.action)
      const item: ThreadItem = {
        action,
        id: itemId,
        query,
        type: 'webSearch',
      }
      turn.items.push(item)
      itemsById.set(itemId, item)
      continue
    }
    if (payloadType === 'compaction' || payloadType === 'context_compaction') {
      const item: ThreadItem = { id: itemId, type: 'contextCompaction' }
      turn.items.push(item)
      itemsById.set(itemId, item)
    }
  }

  for (const turn of turns) {
    if (turn.status === 'inProgress') {
      turn.status = 'completed'
      turn.completedAt = turn.completedAt ?? latestTimestamp
    }
  }
  const headerThreadId = stringValue(header?.id)
  const headerWorkspacePath = stringValue(header?.cwd)
  if (
    !header
    || (headerThreadId && headerThreadId !== record.id)
    || !headerWorkspacePath
    || workspaceIdentity(headerWorkspacePath) !== workspaceIdentity(record.cwd)
  ) {
    throw new Error('Codex rollout does not match the indexed thread.')
  }
  const sessionId = stringValue(header.session_id) || headerThreadId || record.id
  const preview = record.preview
    || turns.flatMap((turn) => turn.items)
      .find((item) => item.type === 'userMessage')
      ?.content.find((entry) => entry.type === 'text')?.text
    || ''

  return {
    agentNickname: null,
    agentRole: null,
    cliVersion: stringValue(header.cli_version),
    createdAt: timestampSeconds(header.timestamp, fallbackCreatedAt),
    cwd: headerWorkspacePath,
    ephemeral: false,
    forkedFromId: null,
    gitInfo: null,
    id: record.id,
    modelProvider: stringValue(header.model_provider) || 'openai',
    name: record.name,
    parentThreadId: null,
    path: rolloutPath,
    preview,
    recencyAt: latestTimestamp,
    sessionId,
    source: normalizeSource(header.source),
    status: { type: 'idle' },
    threadSource: stringValue(header.thread_source) || null,
    turns,
    updatedAt: latestTimestamp,
  }
}

async function readRolloutThread(record: CodexThreadRecord, rolloutPath: string, size: number) {
  if (size <= MAX_FULL_ROLLOUT_BYTES) {
    const content = await readFile(rolloutPath, 'utf8')
    return buildThread(record, rolloutPath, content.split(/\r?\n/))
  }
  const input = createReadStream(rolloutPath, { encoding: 'utf8' })
  const lines = createInterface({ crlfDelay: Number.POSITIVE_INFINITY, input })
  try {
    return await buildThread(record, rolloutPath, lines)
  } finally {
    lines.close()
    input.destroy()
  }
}

export class CodexRolloutSnapshotReader {
  private readonly cache = new Map<string, CachedRollout>()
  private readonly rolloutPaths = new Map<string, string>()

  async read(record: CodexThreadRecord) {
    let rolloutPath = await this.findRolloutPath(record)
    let initialStat: Awaited<ReturnType<typeof stat>>
    try {
      initialStat = await stat(rolloutPath)
    } catch {
      if (this.rolloutPaths.get(record.id) !== rolloutPath) throw new Error('Codex rollout is unavailable.')
      this.rolloutPaths.delete(record.id)
      rolloutPath = await this.findRolloutPath({ ...record, rolloutPath: null })
      initialStat = await stat(rolloutPath)
    }
    const signature = fileSignature(initialStat)
    const cached = this.cache.get(rolloutPath)
    if (cached?.signature === signature) {
      this.cache.delete(rolloutPath)
      this.cache.set(rolloutPath, cached)
      return cached.thread
    }

    const thread = await readRolloutThread(record, rolloutPath, initialStat.size)
    const finalStat = await stat(rolloutPath)
    if (fileSignature(finalStat) === signature) {
      this.cache.delete(rolloutPath)
      this.cache.set(rolloutPath, { signature, thread })
      while (this.cache.size > MAX_CACHED_ROLLOUTS) {
        const oldest = this.cache.keys().next().value
        if (typeof oldest !== 'string') break
        this.cache.delete(oldest)
      }
    }
    return thread
  }

  private async findRolloutPath(record: CodexThreadRecord) {
    const cached = this.rolloutPaths.get(record.id)
    if (cached) return cached
    const home = codexHome()
    const roots = [path.join(home, 'sessions'), path.join(home, 'archived_sessions')]
    if (record.rolloutPath) {
      const resolved = path.resolve(record.rolloutPath)
      if (
        roots.some((root) => isPathInside(root, resolved))
        && path.extname(resolved).toLowerCase() === '.jsonl'
        && path.basename(resolved).includes(record.id)
      ) {
        this.rolloutPaths.set(record.id, resolved)
        return resolved
      }
    }

    for (const root of roots) {
      for (const parts of dateDirectoryParts(record.createdAt)) {
        const directory = path.join(root, ...parts)
        try {
          const entries = await readdir(directory, { withFileTypes: true })
          const match = entries.find((entry) => (
            entry.isFile()
            && entry.name.endsWith('.jsonl')
            && entry.name.includes(record.id)
          ))
          if (!match) continue
          const resolved = path.join(directory, match.name)
          this.rolloutPaths.set(record.id, resolved)
          return resolved
        } catch {
          // The candidate date directory need not exist.
        }
      }
    }
    throw new Error(`Codex rollout ${record.id} was not found.`)
  }
}
