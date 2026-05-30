import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { getModel } from '@earendil-works/pi-ai'
import { SessionManager, type SessionEntry } from '@earendil-works/pi-coding-agent'
import { getThinkingLevelsByModel, PiAgentManager, serializeSessionEntries } from '../electron/main/agent'

describe('agent session serialization', () => {
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
      const sessionDir = path.join(workspacePath, '.pi', 'sessions')
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
      const manager = new PiAgentManager(() => undefined, { agentDir: path.join(tempRoot, 'agent') })
      ;(manager as unknown as { activeRuntime: unknown }).activeRuntime = activeRuntime

      const snapshot = await manager.readSession(workspacePath, sessionManager.getSessionFile() ?? '')

      expect(abort).not.toHaveBeenCalled()
      expect((manager as unknown as { activeRuntime: unknown }).activeRuntime).toBe(activeRuntime)
      expect(snapshot.messages.map((message) => message.text)).toEqual([
        'Show me the plan.',
        'Here is the plan.',
      ])
    } finally {
      await rm(tempRoot, { force: true, recursive: true })
    }
  })
})
