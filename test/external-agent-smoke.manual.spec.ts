import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentClientEventPayload, AgentWorkspaceState } from '../src/features/agent/types'
import { CodexAgentManager } from '../electron/main/codex-agent'
import { OpenCodeAgentManager } from '../electron/main/opencode-agent'
import { PiCliAgentManager } from '../electron/main/pi-cli-agent'

type SmokeAdapter = {
  createSession: (cwd: string, options?: {
    modelKey?: string
    name?: string
    thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  }) => Promise<AgentWorkspaceState>
  deleteSession: (cwd: string, sessionID: string) => Promise<AgentWorkspaceState>
  dispose: () => void
  listSessionItems: (cwd: string) => Promise<Array<{ id: string }>>
  loadDraftState: () => Promise<AgentWorkspaceState>
  loadWorkspaceState: (cwd: string, sessionID: string | null) => Promise<AgentWorkspaceState>
  openSession: (cwd: string, sessionID: string) => Promise<AgentWorkspaceState>
  readSession: (cwd: string, sessionID: string) => Promise<unknown>
  sendPrompt: (cwd: string, sessionID: string, prompt: string) => Promise<{ ok: boolean }>
}

async function exerciseAdapter(
  label: string,
  manager: SmokeAdapter,
  workspacePath: string,
  reopenManager: () => SmokeAdapter,
) {
  let activeManager = manager
  let stage = 'load draft state'
  try {
    const draftState = await activeManager.loadDraftState()
    expect(draftState.runtime.availableModels.length).toBeGreaterThan(0)

    stage = 'create session'
    const createdState = await activeManager.createSession(workspacePath, { name: 'Aryn external Agent smoke test' })
    let sessionID = createdState.activeSession?.sessionId
    expect(sessionID).toBeTruthy()

    stage = 'list sessions'
    const sessions = await activeManager.listSessionItems(workspacePath)
    expect(sessions.some((session) => session.id === sessionID)).toBe(true)
    stage = 'restart adapter'
    activeManager.dispose()
    activeManager = reopenManager()
    stage = 'open session after restart'
    const reopenedState = await activeManager.openSession(workspacePath, sessionID!)
    sessionID = reopenedState.activeSession?.sessionId
    expect(sessionID).toBeTruthy()
    stage = 'read session'
    await expect(activeManager.readSession(workspacePath, sessionID!)).resolves.toBeTruthy()
    stage = 'delete session'
    await activeManager.deleteSession(workspacePath, sessionID!)
  } catch (error) {
    throw new Error(`${label} (${stage}): ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    activeManager.dispose()
  }
}

describe.runIf(process.env.ARYN_EXTERNAL_AGENT_SMOKE === '1')('installed external Agent CLIs', () => {
  async function runAdapterSmoke(
    label: string,
    createManager: (agentDir: string, emitEvent: (event: AgentClientEventPayload) => void) => SmokeAdapter,
  ) {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-external-agent-smoke-'))
    const workspacePath = path.join(tempRoot, 'workspace')
    const agentDir = path.join(tempRoot, 'agent-data')
    await mkdir(workspacePath, { recursive: true })
    const events: AgentClientEventPayload[] = []
    const emitEvent = (event: AgentClientEventPayload) => events.push(event)

    try {
      const createAdapter = () => createManager(agentDir, emitEvent)
      await exerciseAdapter(label, createAdapter(), workspacePath, createAdapter)
      expect(events).toBeDefined()
    } finally {
      await rm(tempRoot, { force: true, recursive: true })
    }
  }

  it('starts and manages a native PI session without invoking a model', async () => {
    await runAdapterSmoke('PI CLI', (agentDir, emitEvent) => new PiCliAgentManager({ agentDir, emitEvent }))
  }, 45_000)

  it('starts and manages a native OpenCode session without invoking a model', async () => {
    await runAdapterSmoke('OpenCode', (agentDir, emitEvent) => new OpenCodeAgentManager({ agentDir, emitEvent }))
  }, 45_000)

  it('starts and manages a native Codex session without invoking a model', async () => {
    await runAdapterSmoke('Codex', (agentDir, emitEvent) => new CodexAgentManager({ agentDir, emitEvent }))
  }, 120_000)
})

describe.runIf(process.env.ARYN_EXTERNAL_AGENT_PROMPT_SMOKE === '1')('external Agent prompt and projection', () => {
  async function exercisePrompt(
    label: string,
    createManager: (agentDir: string, emitEvent: (event: AgentClientEventPayload) => void) => SmokeAdapter,
    options: { expectedNativeAgentId?: 'codex' | 'opencode', modelKey?: string } = {},
  ) {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-external-agent-prompt-'))
    const workspacePath = path.join(tempRoot, 'workspace')
    const agentDir = path.join(tempRoot, 'agent-data')
    await mkdir(workspacePath, { recursive: true })
    const events: AgentClientEventPayload[] = []
    const manager = createManager(agentDir, (event) => {
      if (event.type !== 'workspace_state') events.push(event)
    })
    let sessionID: string | null = null
    try {
      const created = await manager.createSession(workspacePath, {
        modelKey: options.modelKey,
        name: `${label} prompt smoke`,
      })
      sessionID = created.activeSession?.sessionId ?? null
      expect(sessionID).toBeTruthy()
      await manager.sendPrompt(workspacePath, sessionID!, 'Reply with exactly OK. Do not use tools.')

      const deadline = Date.now() + 120_000
      while (Date.now() < deadline) {
        const state = await manager.loadWorkspaceState(workspacePath, sessionID!)
        const messages = state.activeSession?.messages ?? []
        const openCodeNative = state.activeSession?.native?.agentId === 'opencode'
          ? state.activeSession.native
          : null
        const codexNative = state.activeSession?.native?.agentId === 'codex'
          ? state.activeSession.native
          : null
        const user = openCodeNative
          ? openCodeNative.messages.find((message) => (
              message.info.role === 'user'
              && message.parts.some((part) => part.type === 'text' && part.text.includes('Reply with exactly OK'))
            ))
          : codexNative
            ? codexNative.thread.turns.flatMap((turn) => turn.items).find((item) => (
                item.type === 'userMessage'
                && item.content.some((input) => input.type === 'text' && input.text.includes('Reply with exactly OK'))
              ))
          : messages.find((message) => message.kind === 'user' && message.text.includes('Reply with exactly OK'))
        const assistant = openCodeNative
          ? openCodeNative.messages.find((message) => (
              message.info.role === 'assistant'
              && message.parts.some((part) => part.type === 'text' && part.text.trim())
            ))
          : codexNative
            ? codexNative.thread.turns.flatMap((turn) => turn.items).find((item) => (
                item.type === 'agentMessage' && item.text.trim()
              ))
          : messages.find((message) => message.kind === 'assistant' && message.text.trim())
        if (!state.runtime.isStreaming && user && assistant) {
          expect(openCodeNative || codexNative || ('status' in assistant && (assistant.status === 'error' || assistant.text.length > 0))).toBeTruthy()
          if (options.expectedNativeAgentId) {
            expect(events.some((event) => (
              event.type === 'session_snapshot_updated'
              && event.session.native?.agentId === options.expectedNativeAgentId
            ))).toBe(true)
          }
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      throw new Error(`${label} did not project a completed user/assistant exchange. Events: ${JSON.stringify(events.slice(-30))}`)
    } finally {
      if (sessionID) await manager.deleteSession(workspacePath, sessionID).catch(() => undefined)
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  }

  it('projects a real PI CLI response', async () => {
    await exercisePrompt('PI CLI', (agentDir, emitEvent) => new PiCliAgentManager({ agentDir, emitEvent }))
  }, 150_000)

  it('projects a real Codex response', async () => {
    await exercisePrompt(
      'Codex',
      (agentDir, emitEvent) => new CodexAgentManager({ agentDir, emitEvent }),
      { expectedNativeAgentId: 'codex' },
    )
  }, 150_000)

  it('projects a real OpenCode response through native session snapshots', async () => {
    await exercisePrompt(
      'OpenCode',
      (agentDir, emitEvent) => new OpenCodeAgentManager({ agentDir, emitEvent }),
      { expectedNativeAgentId: 'opencode', modelKey: 'opencode/big-pickle' },
    )
  }, 150_000)
})
