import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentInteractionHistoryStore } from '../electron/main/agent-host/sessions/interaction-history'

const tempDirectories: string[] = []

async function createStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aryn-interactions-'))
  tempDirectories.push(directory)
  return { directory, store: new AgentInteractionHistoryStore(directory) }
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe('AgentInteractionHistoryStore', () => {
  it('persists resolved lifecycle records without secret answers', async () => {
    const { store } = await createStore()
    const requested = store.enrichEvent({
      agentId: 'codex',
      request: {
        agentId: 'codex',
        fields: [{ id: 'token', isSecret: true, label: 'Token' }],
        id: 'request-1',
        kind: 'question',
        message: 'Enter token',
        options: [],
        sessionId: 'session-1',
        title: 'Authentication',
        turnId: 'turn-1',
        workspacePath: 'C:\\workspace',
      },
      type: 'interaction_requested',
    }, 100)
    await store.observeEvent(requested)
    const resolved = store.enrichEvent({
      agentId: 'codex',
      requestId: 'request-1',
      response: {
        agentId: 'codex',
        answers: { token: ['super-secret'] },
        optionId: 'submit',
        requestId: 'request-1',
        sessionId: 'session-1',
        values: ['super-secret'],
      },
      resumeRun: true,
      sessionId: 'session-1',
      type: 'interaction_resolved',
    }, 200)
    await store.observeEvent(resolved)

    expect(await store.read('codex', 'session-1')).toEqual([
      expect.objectContaining({
        requestedAt: 100,
        resolvedAt: 200,
        status: 'resolved',
        request: expect.objectContaining({ turnId: 'turn-1' }),
        response: expect.not.objectContaining({ values: ['super-secret'] }),
      }),
    ])
    expect(JSON.stringify(await store.read('codex', 'session-1'))).not.toContain('super-secret')
  })

  it('never persists flattened values when any answer field is secret', async () => {
    const { store } = await createStore()
    await store.observeEvent(store.enrichEvent({
      agentId: 'codex',
      request: {
        agentId: 'codex',
        fields: [
          { id: 'environment', label: 'Environment' },
          { id: 'token', isSecret: true, label: 'Token' },
        ],
        id: 'request-mixed-secret',
        kind: 'question',
        message: 'Configure deployment',
        options: [],
        sessionId: 'session-1',
        title: 'Deployment',
        workspacePath: 'C:\\workspace',
      },
      type: 'interaction_requested',
    }, 100))
    await store.observeEvent(store.enrichEvent({
      agentId: 'codex',
      requestId: 'request-mixed-secret',
      response: {
        agentId: 'codex',
        answers: {
          environment: ['production'],
          token: ['super-secret'],
        },
        optionId: 'submit',
        requestId: 'request-mixed-secret',
        sessionId: 'session-1',
        values: ['production', 'super-secret'],
      },
      resumeRun: true,
      sessionId: 'session-1',
      type: 'interaction_resolved',
    }, 200))

    const serialized = JSON.stringify(await store.read('codex', 'session-1'))
    expect(serialized).toContain('production')
    expect(serialized).not.toContain('super-secret')
  })

  it('recovers pending records as interrupted after a restart', async () => {
    const { directory, store } = await createStore()
    await store.observeEvent(store.enrichEvent({
      agentId: 'pi',
      request: {
        agentId: 'pi',
        id: 'request-1',
        kind: 'permission',
        message: 'Continue?',
        options: [{ id: 'allow', label: 'Allow' }],
        sessionId: 'session-1',
        title: 'Permission',
        workspacePath: 'C:\\workspace',
      },
      type: 'interaction_requested',
    }, 100))

    const restored = new AgentInteractionHistoryStore(directory)
    expect(await restored.read('pi', 'session-1')).toEqual([
      expect.objectContaining({
        status: 'interrupted',
        statusReason: 'Application restarted before the request completed.',
      }),
    ])
  })

  it('clears a builtin PI session by its persisted file-path alias', async () => {
    const { directory, store } = await createStore()
    const sessionPath = path.join(directory, 'sessions', 'session.jsonl')
    const workspacePath = path.join(directory, 'workspace')
    await store.associateSession('builtin-pi', 'builtin-session-id', sessionPath, workspacePath)
    await store.observeEvent(store.enrichEvent({
      agentId: 'builtin-pi',
      request: {
        agentId: 'builtin-pi',
        id: 'request-1',
        kind: 'permission',
        message: 'Continue?',
        options: [{ id: 'allow', label: 'Allow' }],
        sessionId: 'builtin-session-id',
        title: 'Permission',
        workspacePath,
      },
      type: 'interaction_requested',
    }, 100))

    const restored = new AgentInteractionHistoryStore(directory)
    await restored.clearSession('builtin-pi', sessionPath)

    expect(await restored.read('builtin-pi', 'builtin-session-id')).toEqual([])
  })

  it('persists a rejected question as a cancelled lifecycle', async () => {
    const { store } = await createStore()
    await store.observeEvent(store.enrichEvent({
      agentId: 'opencode',
      request: {
        agentId: 'opencode',
        id: 'question-1',
        kind: 'question',
        message: 'Choose?',
        options: [{ id: 'reject', label: 'Cancel' }],
        sessionId: 'session-1',
        title: 'Choose',
        workspacePath: 'C:\\workspace',
      },
      type: 'interaction_requested',
    }, 100))
    await store.observeEvent(store.enrichEvent({
      agentId: 'opencode',
      requestId: 'question-1',
      response: {
        agentId: 'opencode',
        optionId: 'reject',
        requestId: 'question-1',
        sessionId: 'session-1',
      },
      resumeRun: true,
      sessionId: 'session-1',
      type: 'interaction_resolved',
    }, 200))

    expect(await store.read('opencode', 'session-1')).toEqual([
      expect.objectContaining({
        status: 'interrupted',
        statusReason: 'User cancelled the request.',
      }),
    ])
  })
})
