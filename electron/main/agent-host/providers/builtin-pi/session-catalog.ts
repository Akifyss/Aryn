import { createHash } from 'node:crypto'
import { open as openFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import type { AgentSessionListItem } from '../../../../shared/agent-contracts/types'
import { AgentSessionAnnotationStore } from '../../sessions/annotations'
import { PiSessionFileReader } from '../../sessions/pi-session-file-reader'
import { pathExists } from './file-system'
import { clampText } from './session-presentation'

const SESSION_HEADER_READ_CHUNK_BYTES = 4096
const SESSION_HEADER_READ_LIMIT_BYTES = 64 * 1024

function getWorkspacePathIdentity(workspacePath: string) {
  const normalizedPath = path.resolve(workspacePath)
  return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath
}

export function areSameWorkspacePath(
  left: string | null | undefined,
  right: string | null | undefined,
) {
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

/**
 * Owns embedded PI's session discovery and path authorization boundary.
 *
 * Runtime activation stays in the manager; this catalog is responsible only
 * for locating official/legacy files and proving that a requested file belongs
 * to the requested workspace before it is opened or removed.
 */
export class BuiltinPiSessionCatalog {
  private readonly sessionFileReader = new PiSessionFileReader()

  constructor(
    private readonly agentDir: string,
    private readonly annotationStore: AgentSessionAnnotationStore,
  ) {}

  sessionDir(cwd: string) {
    return getArynPiSessionDir(cwd, this.agentDir)
  }

  open(cwd: string, sessionPath: string) {
    return SessionManager.open(sessionPath, this.sessionDirForPath(cwd, sessionPath), cwd)
  }

  async list(cwd: string): Promise<AgentSessionListItem[]> {
    const sessions = (
      await Promise.all(this.readableSessionDirs(cwd).map((sessionDir) => (
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

  async discard(cwd: string) {
    await Promise.all([
      rm(this.sessionDir(cwd), { force: true, recursive: true }),
      this.discardMatchingSessionFiles(cwd, this.legacyAppSessionDir(cwd)),
      rm(this.legacyWorkspaceSessionDir(cwd), { force: true, recursive: true }),
    ])
  }

  async resolveRestorable(cwd: string, preferredSessionPath: string | null) {
    if (preferredSessionPath) {
      try {
        const resolvedSessionPath = await this.resolveFile(cwd, preferredSessionPath)
        return await pathExists(resolvedSessionPath) ? resolvedSessionPath : null
      } catch {
        return null
      }
    }

    const sessions = await this.list(cwd)
    return sessions[0]?.path ?? null
  }

  async resolveFile(cwd: string, sessionPath: string) {
    const resolvedSessionPath = this.resolvePath(cwd, sessionPath)
    const sessionCwd = await this.readSessionFileCwd(resolvedSessionPath)

    if (!sessionCwd || !areSameWorkspacePath(sessionCwd, cwd)) {
      throw new Error('Invalid session path.')
    }

    return resolvedSessionPath
  }

  async readFile(cwd: string, sessionPath: string) {
    const resolvedSessionPath = this.resolvePath(cwd, sessionPath)
    const value = await this.sessionFileReader.read(resolvedSessionPath)
    if (!value.workspacePath || !areSameWorkspacePath(value.workspacePath, cwd)) {
      throw new Error('Invalid session path.')
    }
    return value
  }

  private legacyAppSessionDir(cwd: string) {
    return getLegacyArynPiSessionDir(cwd, this.agentDir)
  }

  private legacyWorkspaceSessionDir(cwd: string) {
    return path.join(cwd, '.pi', 'sessions')
  }

  private readableSessionDirs(cwd: string) {
    const sessionDirs = [
      this.sessionDir(cwd),
      this.legacyAppSessionDir(cwd),
      this.legacyWorkspaceSessionDir(cwd),
    ]

    return sessionDirs.filter((sessionDir, index) => (
      sessionDirs.findIndex((candidate) => areSameWorkspacePath(candidate, sessionDir)) === index
    ))
  }

  private sessionDirForPath(cwd: string, sessionPath: string) {
    const resolvedSessionPath = path.resolve(sessionPath)
    const matchingSessionDir = this.readableSessionDirs(cwd)
      .map((sessionDir) => path.resolve(sessionDir))
      .find((sessionDir) => this.isPathInsideSessionDir(sessionDir, resolvedSessionPath))

    if (!matchingSessionDir) {
      throw new Error('Invalid session path.')
    }

    return matchingSessionDir
  }

  private resolvePath(cwd: string, sessionPath: string) {
    const resolvedSessionPath = path.resolve(sessionPath)

    if (
      path.extname(resolvedSessionPath).toLowerCase() !== '.jsonl'
      || !this.readableSessionDirs(cwd)
        .map((sessionDir) => path.resolve(sessionDir))
        .some((sessionDir) => this.isPathInsideSessionDir(sessionDir, resolvedSessionPath))
    ) {
      throw new Error('Invalid session path.')
    }

    return resolvedSessionPath
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

        if (bytesRead === 0) break

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

  private readSessionHeaderCwd(firstLine: string) {
    const line = firstLine.trim()
    if (!line) return null

    try {
      const header = JSON.parse(line) as { cwd?: unknown; type?: unknown }
      return header.type === 'session' && typeof header.cwd === 'string' && header.cwd.trim()
        ? header.cwd
        : null
    } catch {
      return null
    }
  }

  private isPathInsideSessionDir(sessionDir: string, sessionPath: string) {
    const relativeSessionPath = path.relative(sessionDir, sessionPath)

    return Boolean(relativeSessionPath)
      && !relativeSessionPath.startsWith('..')
      && !path.isAbsolute(relativeSessionPath)
  }
}
