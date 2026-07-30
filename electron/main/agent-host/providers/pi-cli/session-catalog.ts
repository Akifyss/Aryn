import { constants, existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  SessionManager,
  type SessionInfo,
} from '@earendil-works/pi-coding-agent'
import { AtomicJsonStore } from '../../../json-file-store'
import { createWorkspaceIdentity as workspaceIdentity } from '../../runtime/runtime-keys'
import {
  DEFAULT_PI_CLI_SESSION_INDEX,
  normalizePiCliSessionIndex,
  type PiCliSessionIndex,
  type PiCliSessionRecord,
} from './session-model'
import {
  getLegacyPiSessionDirectory,
  resolvePiSessionDirectory,
} from './session-paths'

type PiCliSessionCatalogOptions = {
  agentDir: string
  isRuntimeLive: (record: PiCliSessionRecord) => boolean
}

/**
 * Merges PI's official session catalog with Aryn's narrow ownership index.
 *
 * Official files remain the source of truth for materialized sessions. The
 * private index contributes only unmaterialized drafts and per-session Aryn
 * configuration, and is never used as a visibility whitelist.
 */
export class PiCliSessionCatalog {
  private readonly index: AtomicJsonStore<PiCliSessionIndex>
  private readonly legacyMigrations = new Map<string, Promise<void>>()

  constructor(private readonly options: PiCliSessionCatalogOptions) {
    this.index = new AtomicJsonStore({
      defaultState: () => structuredClone(DEFAULT_PI_CLI_SESSION_INDEX),
      filePath: path.join(options.agentDir, 'external', 'pi', 'sessions.json'),
      normalize: normalizePiCliSessionIndex,
    })
  }

  async list(cwd: string) {
    await this.ensureLegacySessionsMigrated(cwd)
    const indexedRecords = await this.listOwned(cwd)
    const indexedById = new Map(indexedRecords.map((record) => [record.id, record]))
    const officialRecords = await this.listOfficial(cwd, indexedById)
    const officialIds = new Set(officialRecords.map((record) => record.id))
    const liveOrUnmaterializedDrafts = indexedRecords.filter((record) => (
      !officialIds.has(record.id)
      && (!record.materialized || this.options.isRuntimeLive(record))
    ))
    return [...officialRecords, ...liveOrUnmaterializedDrafts]
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  }

  async listOwned(cwd: string) {
    const identity = workspaceIdentity(cwd)
    return (await this.index.read()).sessions
      .filter((record) => workspaceIdentity(record.cwd) === identity)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  }

  async require(cwd: string, sessionId: string) {
    const record = (await this.list(cwd)).find((candidate) => candidate.id === sessionId)
    if (!record) throw new Error('PI CLI session not found for this workspace.')
    return record
  }

  async insert(record: PiCliSessionRecord) {
    await this.index.update((state) => ({ ...state, sessions: [record, ...state.sessions] }))
  }

  async remove(cwd: string, sessionId: string) {
    const identity = workspaceIdentity(cwd)
    await this.index.update((state) => ({
      ...state,
      sessions: state.sessions.filter((record) => (
        record.id !== sessionId || workspaceIdentity(record.cwd) !== identity
      )),
    }))
  }

  async removeWorkspace(cwd: string) {
    const identity = workspaceIdentity(cwd)
    await this.index.update((state) => ({
      ...state,
      sessions: state.sessions.filter((record) => workspaceIdentity(record.cwd) !== identity),
    }))
  }

  async rename(cwd: string, sessionId: string, name: string) {
    const identity = workspaceIdentity(cwd)
    const updatedAt = new Date().toISOString()
    await this.index.update((state) => ({
      ...state,
      sessions: state.sessions.map((record) => (
        record.id === sessionId && workspaceIdentity(record.cwd) === identity
          ? { ...record, name, updatedAt }
          : record
      )),
    }))
    return updatedAt
  }

  async update(record: PiCliSessionRecord) {
    record.updatedAt = new Date().toISOString()
    const identity = workspaceIdentity(record.cwd)
    await this.index.update((state) => ({
      ...state,
      sessions: state.sessions.map((candidate) => (
        candidate.id === record.id && workspaceIdentity(candidate.cwd) === identity
          ? {
              createdAt: record.createdAt,
              cwd: record.cwd,
              id: record.id,
              materialized: record.materialized,
              modelKey: record.modelKey,
              name: record.name,
              thinkingLevel: record.thinkingLevel,
              updatedAt: record.updatedAt,
            }
          : candidate
      )),
    }))
  }

  dispose() {
    this.legacyMigrations.clear()
  }

  private async listOfficial(
    cwd: string,
    indexedById: Map<string, PiCliSessionRecord>,
  ) {
    const sessionDir = resolvePiSessionDirectory(cwd)
    const infos = await SessionManager.list(cwd, sessionDir)
    return infos
      .filter((info) => !info.cwd || workspaceIdentity(info.cwd) === workspaceIdentity(cwd))
      .map((info) => this.officialSessionRecord(cwd, info, indexedById.get(info.id)))
  }

  private officialSessionRecord(
    cwd: string,
    info: SessionInfo,
    indexed: PiCliSessionRecord | undefined,
  ): PiCliSessionRecord {
    return {
      createdAt: info.created.toISOString(),
      cwd: info.cwd || cwd,
      id: info.id,
      materialized: true,
      messageCount: info.messageCount,
      modelKey: indexed?.modelKey ?? null,
      name: info.name?.trim() || null,
      preview: info.firstMessage?.trim() || null,
      sessionPath: info.path,
      thinkingLevel: indexed?.thinkingLevel ?? 'medium',
      updatedAt: info.modified.toISOString(),
    }
  }

  private async ensureLegacySessionsMigrated(cwd: string) {
    const identity = workspaceIdentity(cwd)
    const existing = this.legacyMigrations.get(identity)
    if (existing) return existing
    const migration = this.migrateLegacySessions(cwd).catch((error) => {
      this.legacyMigrations.delete(identity)
      throw error
    })
    this.legacyMigrations.set(identity, migration)
    return migration
  }

  private async migrateLegacySessions(cwd: string) {
    const sourceDir = getLegacyPiSessionDirectory(this.options.agentDir, cwd)
    if (!existsSync(sourceDir)) return
    const legacySessions = await SessionManager.list(cwd, sourceDir)
    if (legacySessions.length === 0) return
    const targetDir = resolvePiSessionDirectory(cwd)
    await mkdir(targetDir, { recursive: true })
    const officialById = new Map((await SessionManager.list(cwd, targetDir)).map((info) => [info.id, info]))

    for (const legacy of legacySessions) {
      const existingOfficial = officialById.get(legacy.id)
      if (existingOfficial) {
        const [legacyContent, officialContent] = await Promise.all([
          readFile(legacy.path),
          readFile(existingOfficial.path),
        ])
        if (legacyContent.equals(officialContent)) {
          await rm(legacy.path, { force: true })
        } else {
          console.warn(`[pi cli] Legacy session ${legacy.id} conflicts with an official session and was left at ${legacy.path}.`)
        }
        continue
      }

      const targetPath = path.join(targetDir, path.basename(legacy.path))
      let copiedByMigration = false
      try {
        await copyFile(legacy.path, targetPath, constants.COPYFILE_EXCL)
        copiedByMigration = true
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
        if (code !== 'EEXIST') throw error
        const [legacyContent, targetContent] = await Promise.all([
          readFile(legacy.path),
          readFile(targetPath),
        ])
        if (!legacyContent.equals(targetContent)) {
          console.warn(`[pi cli] Legacy session target already exists with different content: ${targetPath}`)
          continue
        }
      }

      const migrated = (await SessionManager.list(cwd, targetDir)).find((info) => (
        info.id === legacy.id && path.resolve(info.path) === path.resolve(targetPath)
      ))
      if (!migrated) {
        if (copiedByMigration) await rm(targetPath, { force: true })
        throw new Error(`PI CLI legacy session ${legacy.id} could not be verified in the official session directory.`)
      }
      officialById.set(migrated.id, migrated)
      await rm(legacy.path, { force: true })
    }

    const remaining = await readdir(sourceDir).catch(() => [])
    if (remaining.length === 0) await rm(sourceDir, { force: true, recursive: true })
  }
}
