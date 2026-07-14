import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { getModel } from '@earendil-works/pi-ai'
import { SessionManager, type SessionEntry } from '@earendil-works/pi-coding-agent'
import {
  getArynPiSessionDir,
  getThinkingLevelsByModel,
  PiAgentManager,
  serializePiWebSessionEntries,
  serializeSessionEntries,
} from '../electron/main/agent'

function appendTestAssistantMessage(sessionManager: SessionManager, text: string, timestamp: number) {
  sessionManager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-completions',
    model: 'deepseek/deepseek-v3.2-exp',
    provider: 'openrouter',
    stopReason: 'stop',
    timestamp,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      input: 1,
      output: 1,
      totalTokens: 2,
      cost: {
        cacheRead: 0,
        cacheWrite: 0,
        input: 0,
        output: 0,
        total: 0,
      },
    },
  })
}

function getLegacyArynPiSessionDirForTest(cwd: string, agentDir: string) {
  const workspaceIdentity = process.platform === 'win32'
    ? path.resolve(cwd).toLowerCase()
    : path.resolve(cwd)
  const safePath = `--${workspaceIdentity.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  return path.join(agentDir, 'sessions', safePath)
}

function getPiWebSnapshotTexts(snapshot: Awaited<ReturnType<PiAgentManager['readSession']>>) {
  if (snapshot.native?.agentId !== 'builtin-pi') return []
  return snapshot.native.messages.map((message) => {
    if (typeof message.content === 'string') return message.content
    if (!Array.isArray(message.content)) return ''
    return message.content.flatMap((part) => (
      part && typeof part === 'object'
        && (part as { type?: unknown }).type === 'text'
        && typeof (part as { text?: unknown }).text === 'string'
        ? [(part as { text: string }).text]
        : []
    )).join('\n')
  })
}

describe('agent session serialization', () => {
  it('preserves native pi messages and full-branch summary entries for pi-web', () => {
    const entries = [
      {
        id: 'user-entry',
        parentId: null,
        timestamp: '2026-04-08T17:05:00.000Z',
        type: 'message',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Inspect the project.' }],
          timestamp: 1775667900000,
        },
      },
      {
        id: 'compaction-entry',
        parentId: 'user-entry',
        timestamp: '2026-04-08T17:06:00.000Z',
        type: 'compaction',
        summary: 'Earlier context.',
        firstKeptEntryId: 'user-entry',
        tokensBefore: 1200,
      },
    ] as SessionEntry[]

    expect(serializePiWebSessionEntries(entries)).toEqual({
      entryIds: ['user-entry', 'compaction-entry'],
      messages: [
        entries[0].message,
        expect.objectContaining({
          role: 'custom',
          customType: 'compaction',
          content: 'Earlier context.',
          display: true,
        }),
      ],
    })
  })

  it('updates application-level provider auth without creating a workspace', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-agent-draft-'))
    const agentDir = path.join(tempRoot, 'agent')
    const unusedWorkspacePath = path.join(tempRoot, 'conversation-workspace')

    try {
      await mkdir(agentDir, { recursive: true })
      const manager = new PiAgentManager(() => undefined, { agentDir })
      const state = await manager.updateProviderAuth(null, 'openrouter', 'test-api-key')

      expect(state.activeSession).toBeNull()
      expect(state.sessions).toEqual([])
      expect(state.runtime.workspacePath).toBeNull()
      expect(state.runtime.auth.openrouter).toMatchObject({
        hasStoredCredential: true,
        source: 'stored',
        storedCredentialType: 'api_key',
      })
      await expect(stat(unusedWorkspacePath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('releases the active runtime before entering a projectless draft', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-agent-draft-release-'))

    try {
      const abort = vi.fn(async () => undefined)
      const dispose = vi.fn()
      const unsubscribe = vi.fn()
      const manager = new PiAgentManager(() => undefined, { agentDir: path.join(tempRoot, 'agent') })
      ;(manager as unknown as { activeRuntime: unknown }).activeRuntime = {
        cwd: path.join(tempRoot, 'workspace'),
        session: {
          abort,
          dispose,
          isStreaming: true,
        },
        unsubscribe,
      }

      const state = await manager.loadDraftState()

      expect(abort).toHaveBeenCalledOnce()
      expect(dispose).toHaveBeenCalledOnce()
      expect(unsubscribe).toHaveBeenCalledOnce()
      expect((manager as unknown as { activeRuntime: unknown }).activeRuntime).toBeNull()
      expect(state.runtime.workspacePath).toBeNull()
    } finally {
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('matches active runtime workspace paths case-insensitively on Windows', async () => {
    if (process.platform !== 'win32') {
      return
    }

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-agent-runtime-case-'))

    try {
      const abort = vi.fn(async () => undefined)
      const dispose = vi.fn()
      const unsubscribe = vi.fn()
      const workspacePath = path.join(tempRoot, 'Workspace')
      const manager = new PiAgentManager(() => undefined, { agentDir: path.join(tempRoot, 'agent') })
      ;(manager as unknown as { activeRuntime: unknown }).activeRuntime = {
        cwd: workspacePath,
        session: {
          abort,
          dispose,
          isStreaming: true,
        },
        unsubscribe,
      }

      await manager.releaseWorkspaceRuntime(workspacePath.toLowerCase())

      expect(abort).toHaveBeenCalledOnce()
      expect(dispose).toHaveBeenCalledOnce()
      expect(unsubscribe).toHaveBeenCalledOnce()
      expect((manager as unknown as { activeRuntime: unknown }).activeRuntime).toBeNull()
    } finally {
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('uses a stable session bucket for equivalent Windows workspace paths', () => {
    if (process.platform !== 'win32') {
      return
    }

    expect(getArynPiSessionDir('C:\\Users\\Me\\Project', 'C:\\agent')).toBe(
      getArynPiSessionDir('c:\\users\\me\\project\\', 'C:\\agent'),
    )
  })

  it('does not merge distinct Windows workspace paths with the same separator-stripped text', () => {
    if (process.platform !== 'win32') {
      return
    }

    expect(getArynPiSessionDir('C:\\workspace\\a-b', 'C:\\agent')).not.toBe(
      getArynPiSessionDir('C:\\workspace\\a\\b', 'C:\\agent'),
    )
  })

  it('serializes model-specific thinking levels from Pi metadata', () => {
    const deepseekV4Pro = getModel('openrouter', 'deepseek/deepseek-v4-pro')
    const deepseekV32 = getModel('openrouter', 'deepseek/deepseek-v3.2')

    expect(getThinkingLevelsByModel([deepseekV4Pro, deepseekV32])).toMatchObject({
      'openrouter/deepseek/deepseek-v4-pro': ['off', 'high', 'xhigh'],
      'openrouter/deepseek/deepseek-v3.2': ['off', 'minimal', 'low', 'medium', 'high'],
    })
  })

  it('keeps thinking-only assistant messages without placeholder text', () => {
    const entries: SessionEntry[] = [
      {
        id: 'assistant-1',
        parentId: null,
        timestamp: '2026-04-08T17:05:56.123Z',
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'Internal reasoning that should stay behind the disclosure.',
              thinkingSignature: 'reasoning',
            },
          ],
          api: 'openai-completions',
          model: 'deepseek/deepseek-v3.2-exp',
          provider: 'openrouter',
          responseId: 'resp-1',
          stopReason: 'stop',
          timestamp: 1775667945852,
          usage: {
            cacheRead: 0,
            cacheWrite: 0,
            input: 1,
            output: 1,
            totalTokens: 2,
            cost: {
              cacheRead: 0,
              cacheWrite: 0,
              input: 0,
              output: 0,
              total: 0,
            },
          },
        },
      } as SessionEntry,
    ]

    expect(serializeSessionEntries(entries)).toEqual([
      {
        id: 'assistant-1775667945852-0',
        kind: 'assistant',
        sessionEntryId: 'assistant-1',
        text: '',
        thinkingText: 'Internal reasoning that should stay behind the disclosure.',
        timestamp: 1775667945852,
        isError: false,
      },
    ])
  })

  it('attaches the originating entry id to the first visible tool message when assistant text is empty', () => {
    const entries: SessionEntry[] = [
      {
        id: 'assistant-2',
        parentId: null,
        timestamp: '2026-04-08T17:05:59.123Z',
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'tool-call-1',
              name: 'write',
              arguments: {
                path: 'docs/outline.md',
              },
            },
          ],
          api: 'openai-completions',
          model: 'deepseek/deepseek-v3.2-exp',
          provider: 'openrouter',
          responseId: 'resp-2',
          stopReason: 'stop',
          timestamp: 1775667949123,
          usage: {
            cacheRead: 0,
            cacheWrite: 0,
            input: 1,
            output: 1,
            totalTokens: 2,
            cost: {
              cacheRead: 0,
              cacheWrite: 0,
              input: 0,
              output: 0,
              total: 0,
            },
          },
        },
      } as SessionEntry,
    ]

    expect(serializeSessionEntries(entries)).toEqual([
      expect.objectContaining({
        id: 'tool-call-1',
        kind: 'tool',
        sessionEntryId: 'assistant-2',
        status: 'running',
        title: 'write',
      }),
    ])
  })

  it('reads a session snapshot without releasing the active runtime', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-agent-session-'))

    try {
      const workspacePath = path.join(tempRoot, 'workspace')
      const agentDir = path.join(tempRoot, 'agent')
      const sessionDir = getArynPiSessionDir(workspacePath, agentDir)
      const sessionManager = SessionManager.create(workspacePath, sessionDir)
      sessionManager.appendMessage({
        role: 'user',
        content: [{ type: 'text', text: 'Show me the plan.' }],
        timestamp: 1775667950000,
      })
      sessionManager.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'Here is the plan.' }],
        api: 'openai-completions',
        model: 'deepseek/deepseek-v3.2-exp',
        provider: 'openrouter',
        stopReason: 'stop',
        timestamp: 1775667951000,
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          input: 1,
          output: 1,
          totalTokens: 2,
          cost: {
            cacheRead: 0,
            cacheWrite: 0,
            input: 0,
            output: 0,
            total: 0,
          },
        },
      })

      const abort = vi.fn()
      const activeRuntime = {
        cwd: workspacePath,
        session: {
          abort,
          dispose: vi.fn(),
          isStreaming: true,
        },
        unsubscribe: vi.fn(),
      }
      const manager = new PiAgentManager(() => undefined, { agentDir })
      ;(manager as unknown as { activeRuntime: unknown }).activeRuntime = activeRuntime

      const snapshot = await manager.readSession(workspacePath, sessionManager.getSessionFile() ?? '')

      expect(abort).not.toHaveBeenCalled()
      expect((manager as unknown as { activeRuntime: unknown }).activeRuntime).toBe(activeRuntime)
      expect(getPiWebSnapshotTexts(snapshot)).toEqual([
        'Show me the plan.',
        'Here is the plan.',
      ])
    } finally {
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('can still read legacy workspace-local sessions', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-agent-legacy-session-'))

    try {
      const workspacePath = path.join(tempRoot, 'workspace')
      const legacySessionDir = path.join(workspacePath, '.pi', 'sessions')
      const sessionManager = SessionManager.create(workspacePath, legacySessionDir)
      sessionManager.appendMessage({
        role: 'user',
        content: [{ type: 'text', text: 'Read the legacy session.' }],
        timestamp: 1775667952000,
      })
      appendTestAssistantMessage(sessionManager, 'Legacy session loaded.', 1775667952500)

      const manager = new PiAgentManager(() => undefined, { agentDir: path.join(tempRoot, 'agent') })
      const snapshot = await manager.readSession(workspacePath, sessionManager.getSessionFile() ?? '')

      expect(snapshot.sessionPath).toBe(sessionManager.getSessionFile())
      expect(getPiWebSnapshotTexts(snapshot)).toEqual([
        'Read the legacy session.',
        'Legacy session loaded.',
      ])
    } finally {
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('can still read legacy app-level sessions from the previous encoded bucket format', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-agent-legacy-app-session-'))

    try {
      const workspacePath = path.join(tempRoot, 'workspace')
      const agentDir = path.join(tempRoot, 'agent')
      const legacyAppSessionDir = getLegacyArynPiSessionDirForTest(workspacePath, agentDir)
      const sessionManager = SessionManager.create(workspacePath, legacyAppSessionDir)
      sessionManager.appendMessage({
        role: 'user',
        content: [{ type: 'text', text: 'Read the legacy app-level session.' }],
        timestamp: 1775667952600,
      })
      appendTestAssistantMessage(sessionManager, 'Legacy app-level session loaded.', 1775667952700)

      const manager = new PiAgentManager(() => undefined, { agentDir })
      const snapshot = await manager.readSession(workspacePath, sessionManager.getSessionFile() ?? '')

      expect(snapshot.sessionPath).toBe(sessionManager.getSessionFile())
      expect(getPiWebSnapshotTexts(snapshot)).toEqual([
        'Read the legacy app-level session.',
        'Legacy app-level session loaded.',
      ])
    } finally {
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('rejects legacy app-level sessions whose header cwd belongs to a different workspace', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-agent-legacy-cwd-guard-'))

    try {
      const agentDir = path.join(tempRoot, 'agent')
      const workspacePath = path.join(tempRoot, 'a-b')
      const collidingWorkspacePath = path.join(tempRoot, 'a', 'b')
      const legacyAppSessionDir = getLegacyArynPiSessionDirForTest(workspacePath, agentDir)
      expect(legacyAppSessionDir).toBe(getLegacyArynPiSessionDirForTest(collidingWorkspacePath, agentDir))

      const sessionManager = SessionManager.create(collidingWorkspacePath, legacyAppSessionDir)
      sessionManager.appendMessage({
        role: 'user',
        content: [{ type: 'text', text: 'This belongs to the nested workspace.' }],
        timestamp: 1775667952800,
      })
      appendTestAssistantMessage(sessionManager, 'Nested response.', 1775667952900)

      const manager = new PiAgentManager(() => undefined, { agentDir })

      await expect(manager.sessionExists(workspacePath, sessionManager.getSessionFile() ?? '')).resolves.toBe(false)
      await expect(manager.readSession(workspacePath, sessionManager.getSessionFile() ?? '')).rejects.toThrow(
        'Invalid session path.',
      )
    } finally {
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('lists app-level sessions alongside legacy app-level and workspace-local sessions', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-agent-session-list-'))

    try {
      const workspacePath = path.join(tempRoot, 'workspace')
      const agentDir = path.join(tempRoot, 'agent')
      const appSessionManager = SessionManager.create(workspacePath, getArynPiSessionDir(workspacePath, agentDir))
      appSessionManager.appendMessage({
        role: 'user',
        content: [{ type: 'text', text: 'App-level session.' }],
        timestamp: 1775667953000,
      })
      appendTestAssistantMessage(appSessionManager, 'App-level response.', 1775667953500)

      const legacyAppSessionManager = SessionManager.create(
        workspacePath,
        getLegacyArynPiSessionDirForTest(workspacePath, agentDir),
      )
      legacyAppSessionManager.appendMessage({
        role: 'user',
        content: [{ type: 'text', text: 'Legacy app-level session.' }],
        timestamp: 1775667953600,
      })
      appendTestAssistantMessage(legacyAppSessionManager, 'Legacy app-level response.', 1775667953700)

      const legacySessionManager = SessionManager.create(workspacePath, path.join(workspacePath, '.pi', 'sessions'))
      legacySessionManager.appendMessage({
        role: 'user',
        content: [{ type: 'text', text: 'Legacy session.' }],
        timestamp: 1775667954000,
      })
      appendTestAssistantMessage(legacySessionManager, 'Legacy response.', 1775667954500)

      const manager = new PiAgentManager(() => undefined, { agentDir })
      const sessions = await manager.listSessionItems(workspacePath)

      expect(sessions.map((session) => session.path).sort()).toEqual([
        appSessionManager.getSessionFile(),
        legacyAppSessionManager.getSessionFile(),
        legacySessionManager.getSessionFile(),
      ].sort())
      expect(sessions.every((session) => session.path.endsWith('.jsonl'))).toBe(true)
    } finally {
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('discards app-level and legacy sessions for a removed draft workspace', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-agent-discard-session-'))

    try {
      const workspacePath = path.join(tempRoot, 'workspace')
      const agentDir = path.join(tempRoot, 'agent')
      const appSessionManager = SessionManager.create(workspacePath, getArynPiSessionDir(workspacePath, agentDir))
      appSessionManager.appendMessage({
        role: 'user',
        content: [{ type: 'text', text: 'Discard this app-level session.' }],
        timestamp: 1775667955000,
      })
      appendTestAssistantMessage(appSessionManager, 'Discard app-level response.', 1775667955050)

      const legacyAppSessionManager = SessionManager.create(
        workspacePath,
        getLegacyArynPiSessionDirForTest(workspacePath, agentDir),
      )
      legacyAppSessionManager.appendMessage({
        role: 'user',
        content: [{ type: 'text', text: 'Discard this legacy app-level session.' }],
        timestamp: 1775667955100,
      })
      appendTestAssistantMessage(legacyAppSessionManager, 'Discard legacy app-level response.', 1775667955150)

      const legacySessionManager = SessionManager.create(workspacePath, path.join(workspacePath, '.pi', 'sessions'))
      legacySessionManager.appendMessage({
        role: 'user',
        content: [{ type: 'text', text: 'Discard this workspace-local session.' }],
        timestamp: 1775667955200,
      })
      appendTestAssistantMessage(legacySessionManager, 'Discard workspace-local response.', 1775667955250)

      const manager = new PiAgentManager(() => undefined, { agentDir })
      await manager.discardWorkspaceSessions(workspacePath)

      await expect(stat(appSessionManager.getSessionFile() ?? '')).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(stat(legacyAppSessionManager.getSessionFile() ?? '')).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(stat(legacySessionManager.getSessionFile() ?? '')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('does not discard colliding legacy app-level sessions from another workspace', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-agent-discard-collision-'))

    try {
      const agentDir = path.join(tempRoot, 'agent')
      const workspacePath = path.join(tempRoot, 'a-b')
      const collidingWorkspacePath = path.join(tempRoot, 'a', 'b')
      const legacyAppSessionDir = getLegacyArynPiSessionDirForTest(workspacePath, agentDir)
      expect(legacyAppSessionDir).toBe(getLegacyArynPiSessionDirForTest(collidingWorkspacePath, agentDir))

      const targetSessionManager = SessionManager.create(workspacePath, legacyAppSessionDir)
      targetSessionManager.appendMessage({
        role: 'user',
        content: [{ type: 'text', text: 'Discard only this session.' }],
        timestamp: 1775667955300,
      })
      appendTestAssistantMessage(targetSessionManager, 'Discard target response.', 1775667955350)

      const collidingSessionManager = SessionManager.create(collidingWorkspacePath, legacyAppSessionDir)
      collidingSessionManager.appendMessage({
        role: 'user',
        content: [{ type: 'text', text: 'Keep this colliding session.' }],
        timestamp: 1775667955400,
      })
      appendTestAssistantMessage(collidingSessionManager, 'Keep colliding response.', 1775667955450)

      const manager = new PiAgentManager(() => undefined, { agentDir })
      await manager.discardWorkspaceSessions(workspacePath)

      await expect(stat(targetSessionManager.getSessionFile() ?? '')).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(stat(collidingSessionManager.getSessionFile() ?? '').then((stats) => stats.isFile())).resolves.toBe(true)
    } finally {
      await rm(tempRoot, { force: true, recursive: true })
    }
  })
})
