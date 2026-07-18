import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Model } from '../src/features/agent/codex-protocol/generated/v2/Model'
import type { Thread } from '../src/features/agent/codex-protocol/generated/v2/Thread'
import { CodexAgentManager } from '../electron/main/codex-agent'

function emptyThread(cwd: string): Thread {
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
  }
}

describe('Codex unmaterialized sessions', () => {
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
        if (method === 'thread/name/set') return {}
        if (method === 'thread/delete') return {}
        throw new Error(`Unexpected Codex request: ${method}`)
      },
      stop: () => undefined,
    }

    try {
      const created = await manager.createSession(workspace, { name: 'Empty Codex thread' })
      expect(created.activeSession?.native?.agentId).toBe('codex')
      expect(requestedMethods).toEqual(['thread/start'])
      await expect(manager.readSession(workspace, 'thread-unmaterialized')).resolves.toBeTruthy()
      await manager.renameSession(workspace, 'thread-unmaterialized', 'Renamed before first turn')
      await manager.deleteSession(workspace, 'thread-unmaterialized')
      expect(requestedMethods).toEqual(['thread/start', 'thread/delete'])
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
        throw new Error(`Unexpected Codex request: ${method}`)
      },
      stop: () => undefined,
    }

    try {
      const created = await manager.createSession(workspace, { thinkingLevel: 'low' })

      expect(requests).toEqual([
        expect.objectContaining({
          method: 'thread/start',
          params: expect.objectContaining({ model: 'gpt-5.6-sol' }),
        }),
      ])
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
