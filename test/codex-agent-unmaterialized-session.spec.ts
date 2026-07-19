import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Model } from '../src/features/agent/codex-protocol/generated/v2/Model'
import type { Thread } from '../src/features/agent/codex-protocol/generated/v2/Thread'
import { CodexAgentManager } from '../electron/main/codex-agent'

function emptyThread(cwd: string, overrides: Partial<Thread> = {}): Thread {
  return {
    agentNickname: null,
    agentRole: null,
    cliVersion: '0.144.1',
    createdAt: 1,
    cwd,
    ephemeral: false,
    forkedFromId: null,
    gitInfo: null,
    id: 'thread-unmaterialized',
    modelProvider: 'openai',
    name: null,
    parentThreadId: null,
    path: null,
    preview: '',
    recencyAt: null,
    sessionId: 'session-unmaterialized',
    source: 'appServer',
    status: { type: 'idle' },
    threadSource: 'aryn',
    turns: [],
    updatedAt: 1,
    ...overrides,
  }
}

describe('Codex unmaterialized sessions', () => {
  it('paginates and lists official Codex threads that were created outside Aryn', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-official-list-'))
    const workspace = path.join(tempRoot, 'workspace')
    const requests: Array<{ method: string, params: Record<string, unknown> }> = []
    const manager = new CodexAgentManager({ agentDir: path.join(tempRoot, 'agent-data'), emitEvent: () => undefined })
    const internals = manager as unknown as {
      client: {
        request: (method: string, params: Record<string, unknown>) => Promise<unknown>
        stop: () => void
      }
    }
    internals.client = {
      request: async (method, params) => {
        requests.push({ method, params })
        if (method !== 'thread/list') throw new Error(`Unexpected Codex request: ${method}`)
        if (params.cursor === null) {
          return {
            data: [
              emptyThread(workspace, {
                id: 'official-cli-thread-1',
                path: path.join(tempRoot, 'official-1.jsonl'),
                preview: 'Created by Codex CLI',
                source: 'cli',
                updatedAt: 2,
              }),
              emptyThread(workspace, { id: 'subagent-thread', parentThreadId: 'official-cli-thread-1' }),
              emptyThread(workspace, { ephemeral: true, id: 'ephemeral-thread' }),
            ],
            nextCursor: 'page-2',
          }
        }
        return {
          data: [
            emptyThread(workspace, {
              id: 'official-cli-thread-1',
              path: path.join(tempRoot, 'official-1.jsonl'),
              preview: 'Duplicate pagination entry',
              source: 'cli',
              updatedAt: 2,
            }),
            emptyThread(workspace, {
              id: 'official-vscode-thread-2',
              name: 'Named in another Codex client',
              path: path.join(tempRoot, 'official-2.jsonl'),
              preview: 'Created by the Codex extension',
              source: 'vscode',
              updatedAt: 3,
            }),
            emptyThread(workspace, {
              id: 'official-exec-thread-3',
              path: path.join(tempRoot, 'official-3.jsonl'),
              preview: 'Created by codex exec',
              source: 'exec',
              updatedAt: 4,
            }),
          ],
          nextCursor: null,
        }
      },
      stop: () => undefined,
    }

    try {
      await expect(manager.listSessionItems(workspace)).resolves.toEqual([
        expect.objectContaining({ id: 'official-exec-thread-3', preview: 'Created by codex exec' }),
        expect.objectContaining({ id: 'official-vscode-thread-2', name: 'Named in another Codex client' }),
        expect.objectContaining({ id: 'official-cli-thread-1', preview: 'Created by Codex CLI' }),
      ])
      expect(requests).toEqual([
        expect.objectContaining({
          method: 'thread/list',
          params: expect.objectContaining({
            cursor: null,
            cwd: workspace,
            sourceKinds: ['cli', 'vscode', 'exec', 'appServer', 'unknown'],
          }),
        }),
        expect.objectContaining({ method: 'thread/list', params: expect.objectContaining({ cursor: 'page-2', cwd: workspace }) }),
      ])

      await manager.discardWorkspaceSessions(workspace)
      expect(requests.some((request) => request.method === 'thread/archive')).toBe(false)
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('uses the thread/start snapshot until the first turn creates a rollout', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-unmaterialized-'))
    const workspace = path.join(tempRoot, 'workspace')
    const requestedMethods: string[] = []
    const manager = new CodexAgentManager({ agentDir: path.join(tempRoot, 'agent-data'), emitEvent: () => undefined })
    const internals = manager as unknown as {
      client: {
        request: (method: string) => Promise<unknown>
        stop: () => void
      }
    }
    internals.client = {
      request: async (method) => {
        requestedMethods.push(method)
        if (method === 'thread/start') {
          return {
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
            cwd: workspace,
            instructionSources: [],
            model: 'gpt-5.3-codex',
            modelProvider: 'openai',
            reasoningEffort: 'medium',
            sandbox: { type: 'workspaceWrite' },
            serviceTier: null,
            thread: emptyThread(workspace),
          }
        }
        if (method === 'thread/list') return { data: [], nextCursor: null }
        if (method === 'thread/name/set') return {}
        if (method === 'thread/delete') return {}
        throw new Error(`Unexpected Codex request: ${method}`)
      },
      stop: () => undefined,
    }

    try {
      const created = await manager.createSession(workspace, { name: 'Empty Codex thread' })
      expect(created.activeSession?.native?.agentId).toBe('codex')
      expect(requestedMethods[0]).toBe('thread/start')
      expect(requestedMethods).toContain('thread/list')
      await expect(manager.readSession(workspace, 'thread-unmaterialized')).resolves.toBeTruthy()
      await manager.renameSession(workspace, 'thread-unmaterialized', 'Renamed before first turn')
      await manager.deleteSession(workspace, 'thread-unmaterialized')
      expect(requestedMethods).toContain('thread/delete')
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('falls back to the in-memory snapshot while a materialized rollout is temporarily empty', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-empty-rollout-'))
    const workspace = path.join(tempRoot, 'workspace')
    const manager = new CodexAgentManager({ agentDir: path.join(tempRoot, 'agent-data'), emitEvent: () => undefined })
    const internals = manager as unknown as {
      bindings: Map<string, {
        isStreaming: boolean
        record: { materialized: boolean }
      }>
      client: {
        request: (method: string) => Promise<unknown>
        stop: () => void
      }
    }
    internals.client = {
      request: async (method) => {
        if (method === 'thread/start') {
          return {
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
            cwd: workspace,
            instructionSources: [],
            model: 'gpt-5.3-codex',
            modelProvider: 'openai',
            reasoningEffort: 'medium',
            sandbox: { type: 'workspaceWrite' },
            serviceTier: null,
            thread: emptyThread(workspace),
          }
        }
        if (method === 'thread/read') {
          throw new Error('failed to load rollout: rollout file is empty')
        }
        if (method === 'thread/list') return { data: [], nextCursor: null }
        throw new Error(`Unexpected Codex request: ${method}`)
      },
      stop: () => undefined,
    }

    try {
      await manager.createSession(workspace, { name: 'Materializing Codex thread' })
      const binding = internals.bindings.get('thread-unmaterialized')
      expect(binding).toBeTruthy()
      binding!.record.materialized = true
      binding!.isStreaming = false

      const snapshot = await manager.readSession(workspace, 'thread-unmaterialized')
      expect(snapshot.native?.agentId).toBe('codex')
      expect(snapshot.native?.thread.id).toBe('thread-unmaterialized')
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('passes the catalog default model explicitly when starting a native thread', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-default-model-'))
    const workspace = path.join(tempRoot, 'workspace')
    const requests: Array<{ method: string, params: unknown }> = []
    const manager = new CodexAgentManager({ agentDir: path.join(tempRoot, 'agent-data'), emitEvent: () => undefined })
    const defaultModel: Model = {
      additionalSpeedTiers: [],
      availabilityNux: null,
      defaultReasoningEffort: 'low',
      defaultServiceTier: null,
      description: 'Default model',
      displayName: 'GPT 5.6 Sol',
      hidden: false,
      id: 'gpt-5.6-sol',
      inputModalities: ['text'],
      isDefault: true,
      model: 'gpt-5.6-sol',
      serviceTiers: [],
      supportedReasoningEfforts: [{ description: '', reasoningEffort: 'low' }],
      supportsPersonality: false,
      upgrade: null,
      upgradeInfo: null,
    }
    const internals = manager as unknown as {
      client: {
        request: (method: string, params: unknown) => Promise<unknown>
        stop: () => void
      }
      models: Model[]
    }
    internals.models = [defaultModel]
    internals.client = {
      request: async (method, params) => {
        requests.push({ method, params })
        if (method === 'thread/start') {
          return {
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
            cwd: workspace,
            instructionSources: [],
            model: defaultModel.model,
            modelProvider: 'openai',
            reasoningEffort: 'low',
            sandbox: { type: 'workspaceWrite' },
            serviceTier: null,
            thread: emptyThread(workspace),
          }
        }
        if (method === 'thread/list') return { data: [], nextCursor: null }
        throw new Error(`Unexpected Codex request: ${method}`)
      },
      stop: () => undefined,
    }

    try {
      const created = await manager.createSession(workspace, { thinkingLevel: 'low' })

      expect(requests.find((request) => request.method === 'thread/start')).toEqual(expect.objectContaining({
        method: 'thread/start',
        params: expect.objectContaining({ model: 'gpt-5.6-sol' }),
      }))
      expect(created.runtime.defaultModel).toBe('openai/gpt-5.6-sol')
      expect(created.runtime.preferredModelByProvider).toEqual({ openai: 'openai/gpt-5.6-sol' })
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('uses the selected model default reasoning effort when no level is specified', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-selected-model-'))
    const workspace = path.join(tempRoot, 'workspace')
    const manager = new CodexAgentManager({ agentDir: path.join(tempRoot, 'agent-data'), emitEvent: () => undefined })
    const selectedModel: Model = {
      additionalSpeedTiers: [],
      availabilityNux: null,
      defaultReasoningEffort: 'high',
      defaultServiceTier: null,
      description: 'Selected model',
      displayName: 'Selected model',
      hidden: false,
      id: 'gpt-selected',
      inputModalities: ['text'],
      isDefault: false,
      model: 'gpt-selected',
      serviceTiers: [],
      supportedReasoningEfforts: [{ description: '', reasoningEffort: 'high' }],
      supportsPersonality: false,
      upgrade: null,
      upgradeInfo: null,
    }
    const defaultModel: Model = {
      ...selectedModel,
      defaultReasoningEffort: 'low',
      displayName: 'Default model',
      id: 'gpt-default',
      isDefault: true,
      model: 'gpt-default',
      supportedReasoningEfforts: [{ description: '', reasoningEffort: 'low' }],
    }
    const internals = manager as unknown as {
      client: { request: (method: string, params: Record<string, unknown>) => Promise<unknown>, stop: () => void }
      models: Model[]
    }
    internals.models = [defaultModel, selectedModel]
    internals.client = {
      request: async (method, params) => {
        if (method === 'thread/list') return { data: [], nextCursor: null }
        expect(method).toBe('thread/start')
        expect(params.model).toBe('gpt-selected')
        return {
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
          cwd: workspace,
          instructionSources: [],
          model: selectedModel.model,
          modelProvider: 'openai',
          reasoningEffort: 'high',
          sandbox: { type: 'workspaceWrite' },
          serviceTier: null,
          thread: emptyThread(workspace),
        }
      },
      stop: () => undefined,
    }

    try {
      const created = await manager.createSession(workspace, { modelKey: 'openai/gpt-selected' })
      expect(created.runtime.thinkingLevel).toBe('high')
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })
})
