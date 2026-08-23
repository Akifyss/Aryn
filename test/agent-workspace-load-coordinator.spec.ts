import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { AgentWorkspaceLoadCoordinator } from '../src/features/agent/lib/agent-workspace-load-coordinator'
import type { AgentWorkspaceState } from '../src/features/agent/types'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function workspaceState(workspacePath: string): AgentWorkspaceState {
  return {
    activeSession: null,
    runtime: {
      agentId: 'pi',
      availableModels: [],
      compactionReason: null,
      configuredProviders: [],
      defaultModel: null,
      executionState: { type: 'idle' },
      followUpMessageCount: 0,
      hasConfiguredModels: true,
      isCompacting: false,
      isStreaming: false,
      pendingMessageCount: 0,
      retryAttempt: 0,
      retryMaxAttempts: null,
      selectedModel: null,
      setupHint: null,
      steeringMessageCount: 0,
      supportedRunningPromptBehaviors: [],
      workspacePath,
    },
    sessions: [],
  }
}

const draftRequest = {
  agentId: 'pi' as const,
  preferredSessionPath: null,
  restoreSession: false,
  workspacePath: 'C:/conversation',
}

describe('AgentWorkspaceLoadCoordinator', () => {
  it('shares one native load between lifecycle and draft materialization', async () => {
    const coordinator = new AgentWorkspaceLoadCoordinator()
    const pending = deferred<AgentWorkspaceState>()
    const loader = vi.fn(() => pending.promise)

    const lifecycleLoad = coordinator.load(draftRequest, loader)
    const submissionLoad = coordinator.load({
      ...draftRequest,
      workspacePath: 'c:\\conversation\\',
    }, loader, { reuseSettled: true })
    pending.resolve(workspaceState('C:/conversation'))

    await expect(lifecycleLoad).resolves.toMatchObject({ status: 'completed' })
    await expect(submissionLoad).resolves.toMatchObject({ status: 'completed' })
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('reuses a just-settled lifecycle load during the same materialization', async () => {
    const coordinator = new AgentWorkspaceLoadCoordinator()
    const state = workspaceState('C:/conversation')
    const lifecycleLoader = vi.fn(async () => state)
    const submissionLoader = vi.fn(async () => state)

    await expect(coordinator.load(draftRequest, lifecycleLoader)).resolves.toEqual({
      state,
      status: 'completed',
    })
    await expect(coordinator.load(
      draftRequest,
      submissionLoader,
      { reuseSettled: true },
    )).resolves.toEqual({ state, status: 'completed' })
    expect(submissionLoader).not.toHaveBeenCalled()
  })

  it('reuses a just-settled submission load when lifecycle observes the new workspace later', async () => {
    const coordinator = new AgentWorkspaceLoadCoordinator()
    const state = workspaceState('C:/conversation')
    const submissionLoader = vi.fn(async () => state)
    const lifecycleLoader = vi.fn(async () => state)

    await expect(coordinator.load(
      draftRequest,
      submissionLoader,
      { reuseSettled: true },
    )).resolves.toEqual({ state, status: 'completed' })
    await expect(coordinator.load(
      draftRequest,
      lifecycleLoader,
      { reuseSettled: true },
    )).resolves.toEqual({ state, status: 'completed' })
    expect(lifecycleLoader).not.toHaveBeenCalled()
  })

  it('treats an obsolete load failure as cancellation instead of a visible error', async () => {
    const coordinator = new AgentWorkspaceLoadCoordinator()
    const older = deferred<AgentWorkspaceState>()
    const olderResult = coordinator.load(draftRequest, () => older.promise)
    const newerState = workspaceState('C:/project')
    const newerResult = coordinator.load({
      ...draftRequest,
      restoreSession: true,
      workspacePath: 'C:/project',
    }, async () => newerState)

    older.reject(new Error('PI CLI workspace activation was superseded.'))

    await expect(olderResult).resolves.toEqual({ status: 'superseded' })
    await expect(newerResult).resolves.toEqual({ state: newerState, status: 'completed' })
  })

  it('preserves failures from the current load', async () => {
    const coordinator = new AgentWorkspaceLoadCoordinator()
    const error = new Error('Unable to load the current workspace.')

    await expect(coordinator.load(draftRequest, async () => {
      throw error
    })).rejects.toBe(error)
  })

  it('is the single renderer path for workspace activation', async () => {
    const [lifecycleSource, submissionSource] = await Promise.all([
      readFile(new URL('../src/features/agent/runtime/use-agent-workspace-lifecycle.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/agent/composer/use-agent-prompt-submission.ts', import.meta.url), 'utf8'),
    ])

    expect(lifecycleSource.match(/window\.appApi\.loadAgentWorkspace\(/g)).toHaveLength(1)
    expect(submissionSource).not.toContain('window.appApi.loadAgentWorkspace(')
    expect(submissionSource).toContain('loadAgentWorkspaceState({')
    expect(lifecycleSource).toContain('{ forceNewSession: true }')
    expect(lifecycleSource).toMatch(/reuseSettled: shouldStartNewSession\s*&& activeWorkspaceContext\.kind === 'conversation'/)

    const workspaceCreationStart = submissionSource.indexOf('createdConversation = await createConversationWorkspace({')
    const workspaceLoadStart = submissionSource.indexOf('const loadResult = await loadAgentWorkspaceState({')
    const workspaceCreationTransition = submissionSource.slice(workspaceCreationStart, workspaceLoadStart)
    expect(workspaceCreationStart).toBeGreaterThan(-1)
    expect(workspaceLoadStart).toBeGreaterThan(workspaceCreationStart)
    expect(workspaceCreationTransition).not.toContain('isSubmissionContextCurrent()')
    expect(submissionSource).not.toContain('PendingConversationSubmission')
    expect(submissionSource).not.toContain('setPendingConversationSubmission')

    const realSessionReady = submissionSource.indexOf('const promptSessionPath = nextSessionPath')
    const optimisticMessageCommit = submissionSource.indexOf('setOptimisticUserMessages(', realSessionReady)
    const conversationBinding = submissionSource.indexOf('const conversationId = createdConversation?.id', optimisticMessageCommit)
    expect(realSessionReady).toBeGreaterThan(workspaceLoadStart)
    expect(optimisticMessageCommit).toBeGreaterThan(realSessionReady)
    expect(conversationBinding).toBeGreaterThan(optimisticMessageCommit)
  })
})
