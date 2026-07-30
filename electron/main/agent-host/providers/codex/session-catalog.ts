import path from 'node:path'
import type { Thread } from '../../../../shared/agent-contracts/providers/codex/protocol/generated/v2/Thread'
import type { ThreadListResponse } from '../../../../shared/agent-contracts/providers/codex/protocol/generated/v2/ThreadListResponse'
import { AtomicJsonStore } from '../../../json-file-store'
import { createWorkspaceIdentity as workspaceIdentity } from '../../runtime/runtime-keys'
import type { CodexRpcClient } from './rpc-client'
import {
  DEFAULT_CODEX_THREAD_INDEX,
  normalizeCodexThreadIndex,
  TOP_LEVEL_CODEX_THREAD_SOURCE_KINDS,
  type CodexThreadIndex,
  type CodexThreadRecord,
} from './session-model'

type CodexSessionCatalogListOptions = {
  /**
   * A newly started thread can be live before Codex writes its rollout. The
   * manager supplies that runtime fact without making the catalog depend on
   * runtime ownership or the in-memory projection store.
   */
  retainIndexedRecord: (record: CodexThreadRecord) => boolean
}

/**
 * Reconciles Codex's authoritative thread catalog with Aryn's auxiliary index.
 *
 * Official App Server history controls visibility for materialized threads.
 * The index only preserves Aryn configuration and genuinely live,
 * not-yet-materialized drafts.
 */
export class CodexSessionCatalog {
  private readonly index: AtomicJsonStore<CodexThreadIndex>

  constructor(agentDir: string) {
    this.index = new AtomicJsonStore({
      defaultState: () => structuredClone(DEFAULT_CODEX_THREAD_INDEX),
      filePath: path.join(agentDir, 'external', 'codex', 'threads.json'),
      normalize: normalizeCodexThreadIndex,
    })
  }

  async list(
    client: CodexRpcClient,
    cwd: string,
    options: CodexSessionCatalogListOptions,
  ) {
    const [nativeThreads, indexedRecords] = await Promise.all([
      this.listNative(client, cwd),
      this.listIndexed(cwd),
    ])
    const indexedById = new Map(indexedRecords.map((record) => [record.id, record]))
    const nativeIds = new Set(nativeThreads.map((thread) => thread.id))
    const officialRecords = nativeThreads.map((thread): CodexThreadRecord => {
      const indexed = indexedById.get(thread.id)
      return {
        createdAt: new Date(thread.createdAt * 1_000).toISOString(),
        cwd: thread.cwd,
        id: thread.id,
        materialized: true,
        model: indexed?.model ?? null,
        modelExplicit: indexed?.modelExplicit ?? false,
        name: thread.name,
        preview: thread.preview || null,
        reasoningEffort: indexed?.reasoningEffort ?? 'medium',
        updatedAt: new Date(thread.updatedAt * 1_000).toISOString(),
      }
    })
    const liveOrUnmaterializedDrafts = indexedRecords.filter((record) => (
      !nativeIds.has(record.id)
      && (!record.materialized || options.retainIndexedRecord(record))
    ))
    return [...officialRecords, ...liveOrUnmaterializedDrafts]
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  }

  async listNative(client: CodexRpcClient, cwd: string) {
    const threads: Thread[] = []
    const seenCursors = new Set<string>()
    const seenThreadIds = new Set<string>()
    let cursor: string | null = null
    do {
      const response: ThreadListResponse = await client.request('thread/list', {
        archived: false,
        cursor,
        cwd,
        limit: 100,
        sortDirection: 'desc',
        sortKey: 'updated_at',
        sourceKinds: TOP_LEVEL_CODEX_THREAD_SOURCE_KINDS,
      })
      for (const thread of response.data) {
        if (thread.ephemeral || thread.parentThreadId || seenThreadIds.has(thread.id)) continue
        seenThreadIds.add(thread.id)
        threads.push(thread)
      }
      const nextCursor = response.nextCursor ?? null
      if (nextCursor && seenCursors.has(nextCursor)) {
        throw new Error(`Codex thread/list returned the repeated cursor "${nextCursor}".`)
      }
      if (nextCursor) seenCursors.add(nextCursor)
      cursor = nextCursor
    } while (cursor)
    return threads
  }

  async listIndexed(cwd: string) {
    const identity = workspaceIdentity(cwd)
    return (await this.index.read()).threads
      .filter((record) => workspaceIdentity(record.cwd) === identity)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  }

  async add(record: CodexThreadRecord) {
    await this.index.update((state) => ({
      ...state,
      threads: [record, ...state.threads],
    }))
  }

  async ensure(record: CodexThreadRecord) {
    await this.index.update((state) => ({
      ...state,
      threads: state.threads.some((candidate) => candidate.id === record.id)
        ? state.threads
        : [record, ...state.threads],
    }))
  }

  async replace(threadId: string, replacement: CodexThreadRecord) {
    await this.index.update((state) => ({
      ...state,
      threads: state.threads.map((candidate) => (
        candidate.id === threadId ? replacement : candidate
      )),
    }))
  }

  async update(record: CodexThreadRecord) {
    await this.index.update((state) => ({
      ...state,
      threads: state.threads.map((candidate) => (
        candidate.id === record.id ? { ...record } : candidate
      )),
    }))
  }

  async remove(threadId: string) {
    return this.removeMany(new Set([threadId]))
  }

  async removeMany(threadIds: ReadonlySet<string>) {
    await this.index.update((state) => ({
      ...state,
      threads: state.threads.filter((record) => !threadIds.has(record.id)),
    }))
  }
}
