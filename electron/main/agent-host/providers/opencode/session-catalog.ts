import path from 'node:path'
import type {
  OpencodeClient,
  Session,
} from '@opencode-ai/sdk/v2'
import type { AgentThinkingLevel } from '../../../../shared/agent-contracts/types'
import { AtomicJsonStore } from '../../../json-file-store'
import { createWorkspaceIdentity as workspaceIdentity } from '../../runtime/runtime-keys'
import {
  DEFAULT_OPEN_CODE_SESSION_INDEX,
  formatOpenCodeError,
  getSessionConfigurationFromMetadata,
  normalizeOpenCodeSessionIndex,
  unwrapOpenCodeSdkResult,
  withSessionConfigurationMetadata,
  type OpenCodeSessionIndex,
  type OpenCodeSessionRecord,
} from './session-model'

/**
 * Owns OpenCode's official session discovery and Aryn's narrow auxiliary index.
 *
 * Official sessions and metadata remain authoritative. The index records only
 * Aryn ownership plus legacy configuration fallback and never acts as a
 * visibility whitelist.
 */
export class OpenCodeSessionCatalog {
  private readonly index: AtomicJsonStore<OpenCodeSessionIndex>

  constructor(agentDir: string) {
    this.index = new AtomicJsonStore({
      defaultState: () => structuredClone(DEFAULT_OPEN_CODE_SESSION_INDEX),
      filePath: path.join(agentDir, 'external', 'opencode', 'sessions.json'),
      normalize: normalizeOpenCodeSessionIndex,
    })
  }

  async list(client: OpencodeClient, cwd: string) {
    const [response, records] = await Promise.all([
      client.session.list({ directory: cwd, roots: true }, { throwOnError: true }),
      this.listOwned(cwd),
    ])
    const recordsById = new Map(records.map((record) => [record.id, record]))
    const officialSessions = unwrapOpenCodeSdkResult<Session[]>(response, 'list sessions')
      .filter((session) => !session.parentID)
      .sort((left, right) => right.time.updated - left.time.updated)
    return Promise.all(officialSessions.map((session) => (
      this.migrateIndexedConfiguration(client, cwd, session, recordsById.get(session.id))
    )))
  }

  async loadHierarchy(client: OpencodeClient, cwd: string, sessionId: string) {
    const response = await client.session.get({
      directory: cwd,
      sessionID: sessionId,
    }, { throwOnError: true })
    const session = unwrapOpenCodeSdkResult<Session>(response, 'read session')
    if (!session?.id) throw new Error('OpenCode session not found for this workspace.')

    let root = session
    const seen = new Set([root.id])
    while (root.parentID) {
      if (seen.has(root.parentID)) {
        throw new Error(`OpenCode session parent cycle: ${root.parentID}`)
      }
      seen.add(root.parentID)
      const parentResponse = await client.session.get({
        directory: cwd,
        sessionID: root.parentID,
      }, { throwOnError: true })
      const parent = unwrapOpenCodeSdkResult<Session>(parentResponse, 'read parent session')
      if (!parent?.id) throw new Error('OpenCode parent session not found for this workspace.')
      root = parent
    }

    const rootsResponse = await client.session.list({
      directory: cwd,
      roots: true,
    }, { throwOnError: true })
    const belongsToWorkspace = unwrapOpenCodeSdkResult<Session[]>(
      rootsResponse,
      'list workspace sessions',
    ).some((candidate) => candidate.id === root.id)
    if (!belongsToWorkspace) {
      throw new Error('OpenCode session not found for this workspace.')
    }

    const rootRecord = (await this.listOwned(cwd))
      .find((candidate) => candidate.id === root.id)
    return { root, rootRecord, session }
  }

  async listOwned(cwd: string) {
    const identity = workspaceIdentity(cwd)
    return (await this.index.read()).sessions
      .filter((record) => workspaceIdentity(record.cwd) === identity)
  }

  async upsert(record: OpenCodeSessionRecord) {
    const identity = workspaceIdentity(record.cwd)
    await this.index.update((state) => ({
      ...state,
      sessions: [
        record,
        ...state.sessions.filter((candidate) => (
          candidate.id !== record.id
          || workspaceIdentity(candidate.cwd) !== identity
        )),
      ],
    }))
  }

  async remove(cwd: string, sessionIds: Set<string>) {
    const identity = workspaceIdentity(cwd)
    await this.index.update((state) => ({
      ...state,
      sessions: state.sessions.filter((record) => (
        !sessionIds.has(record.id)
        || workspaceIdentity(record.cwd) !== identity
      )),
    }))
  }

  async updateConfiguration(
    client: OpencodeClient,
    cwd: string,
    session: Session,
    modelKey: string | null,
    thinkingLevel: AgentThinkingLevel,
  ) {
    const sessionId = session.id
    await client.session.update({
      directory: cwd,
      metadata: withSessionConfigurationMetadata(session, modelKey, thinkingLevel),
      sessionID: sessionId,
    }, { throwOnError: true })

    // Native metadata committed successfully and is the source of truth. A
    // legacy index refresh must not roll that change back.
    const identity = workspaceIdentity(cwd)
    await this.index.update((state) => ({
      ...state,
      sessions: state.sessions.map((record) => (
        record.id === sessionId && workspaceIdentity(record.cwd) === identity
          ? { ...record, modelKey, thinkingLevel }
          : record
      )),
    })).catch((error) => {
      console.warn(
        `[opencode] Failed to update legacy session configuration for ${sessionId}: ${formatOpenCodeError(error)}`,
      )
    })
  }

  private async migrateIndexedConfiguration(
    client: OpencodeClient,
    cwd: string,
    session: Session,
    record: OpenCodeSessionRecord | undefined,
  ) {
    if (!record || getSessionConfigurationFromMetadata(session)) return session
    const metadata = withSessionConfigurationMetadata(
      session,
      record.modelKey,
      record.thinkingLevel,
    )
    try {
      await client.session.update({
        directory: cwd,
        metadata,
        sessionID: session.id,
      }, { throwOnError: true })
      return { ...session, metadata }
    } catch (error) {
      // A supplementary migration failure must not hide a valid official
      // session; the auxiliary index remains a read fallback.
      console.warn(
        `[opencode] Failed to migrate Aryn session metadata for ${session.id}: ${formatOpenCodeError(error)}`,
      )
      return session
    }
  }
}
