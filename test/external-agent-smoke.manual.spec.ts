import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentClientEventPayload, AgentWorkspaceState } from '../src/features/agent/types'
import { CodexAgentManager } from '../electron/main/agent-host/providers/codex/manager'
import { PiAgentManager } from '../electron/main/agent-host/providers/builtin-pi/manager'
import { OpenCodeAgentManager } from '../electron/main/agent-host/providers/opencode/manager'
import { PiCliAgentManager } from '../electron/main/agent-host/providers/pi-cli/manager'
import type { BbNativeSessionSnapshot } from '../packages/bb-session-surface/src/contracts'
import type { TimelineRow } from '../packages/bb-session-surface/src/compat/server-contract'
import { projectNativeSession } from '../packages/bb-session-surface/src/projectors/index'

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

function createBuiltinPiSmokeAdapter(
  agentDir: string,
  emitEvent: (event: AgentClientEventPayload) => void,
): SmokeAdapter {
  const manager = new PiAgentManager(emitEvent, { agentDir })
  return {
    createSession: (cwd, options) => manager.createSession(cwd, options),
    deleteSession: (cwd, sessionID) => manager.deleteSession(cwd, sessionID),
    dispose: () => {
      void manager.dispose()
    },
    listSessionItems: (cwd) => manager.listSessionItems(cwd),
    loadDraftState: () => manager.loadDraftState(),
    loadWorkspaceState: (cwd, sessionID) => manager.loadWorkspaceState(cwd, sessionID),
    openSession: (cwd, sessionID) => manager.openSession(cwd, sessionID),
    readSession: (cwd, sessionID) => manager.readSession(cwd, sessionID),
    sendPrompt: (_cwd, _sessionID, prompt) => manager.sendPrompt(prompt),
  }
}

function readPiMessageText(message: { content?: unknown }) {
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  return message.content.flatMap((part) => (
    part
    && typeof part === 'object'
    && 'type' in part
    && part.type === 'text'
    && 'text' in part
    && typeof part.text === 'string'
      ? [part.text]
      : []
  )).join('\n\n')
}

function flattenTimelineRows(rows: readonly TimelineRow[]): TimelineRow[] {
  return rows.flatMap((row) => {
    if (row.kind === 'turn' && row.children) return [row, ...flattenTimelineRows(row.children)]
    if (row.kind === 'work' && row.workKind === 'delegation') {
      return [row, ...flattenTimelineRows(row.childRows)]
    }
    return [row]
  })
}

function formatPromptError(value: unknown) {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'message' in value) return String(value.message)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function findTerminalPromptError(
  state: AgentWorkspaceState,
  events: AgentClientEventPayload[],
  sessionID: string,
) {
  if (state.runtime.isStreaming || state.runtime.executionState?.type === 'busy') return null
  if (state.runtime.executionState?.type === 'retry') return null

  const native = state.activeSession?.native
  if (native?.agentId === 'codex') {
    const notice = native.notices.findLast((item) => item.kind === 'error' && !item.willRetry)
    if (notice) return notice.message
  }
  if (native?.agentId === 'opencode') {
    const failedMessage = native.messages.findLast((message) => message.info.error)
    if (failedMessage) return formatPromptError(failedMessage.info.error)
  }
  if (native?.agentId === 'pi' || native?.agentId === 'builtin-pi') {
    const failedMessage = native.messages.findLast((message) => (
      typeof message.errorMessage === 'string' && message.errorMessage.trim()
    ))
    if (failedMessage && typeof failedMessage.errorMessage === 'string') {
      return failedMessage.errorMessage
    }
  }

  return events.findLast((event) => (
    event.type === 'error' && event.sessionId === sessionID
  ))?.message ?? null
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
    options: {
      expectedNativeAgentId?: 'codex' | 'opencode' | 'pi'
      modelKey?: string
      thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
    } = {},
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
        thinkingLevel: options.thinkingLevel,
      })
      sessionID = created.activeSession?.sessionId ?? null
      expect(sessionID).toBeTruthy()
      const sendResult = await manager.sendPrompt(
        workspacePath,
        sessionID!,
        'Reply with exactly OK. Do not use tools.',
      )
      expect(sendResult.ok).toBe(true)

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
        const piNative = state.activeSession?.native?.agentId === 'pi'
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
          : piNative
            ? piNative.messages.find((message) => (
                message.role === 'user'
                && readPiMessageText(message).includes('Reply with exactly OK')
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
          : piNative
            ? piNative.messages.find((message) => (
                message.role === 'assistant' && readPiMessageText(message).trim()
              ))
            : messages.find((message) => message.kind === 'assistant' && message.text.trim())
        const terminalError = findTerminalPromptError(state, events, sessionID!)
        if (terminalError) {
          throw new Error(`${label} provider ended the prompt with an error: ${terminalError}`)
        }
        if (!state.runtime.isStreaming && user && assistant) {
          expect(
            openCodeNative
            || codexNative
            || piNative
            || ('status' in assistant && (assistant.status === 'error' || assistant.text.length > 0)),
          ).toBeTruthy()
          if (options.expectedNativeAgentId) {
            const projectedNativeEvent = options.expectedNativeAgentId === 'pi'
              ? events.some((event) => event.type === 'pi_native_event')
              : events.some((event) => (
                  event.type === 'session_snapshot_updated'
                  && event.session.native?.agentId === options.expectedNativeAgentId
                ))
            expect(projectedNativeEvent).toBe(true)
          }

          const native = state.activeSession?.native
          expect(native).toBeTruthy()
          const timeline = projectNativeSession({
            fileChanges: [],
            optimisticMessages: [],
            sessionId: sessionID!,
            snapshot: native as BbNativeSessionSnapshot,
            runtimeState: state.runtime,
            workspacePath,
          })
          const conversationRows = flattenTimelineRows(timeline.rows).filter((row) => (
            row.kind === 'conversation'
          ))
          expect(conversationRows.some((row) => (
            row.kind === 'conversation'
            && row.role === 'user'
            && row.text.includes('Reply with exactly OK')
          ))).toBe(true)
          expect(conversationRows.some((row) => (
            row.kind === 'conversation'
            && row.role === 'assistant'
            && row.text.trim().length > 0
          ))).toBe(true)
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
    await exercisePrompt(
      'PI CLI',
      (agentDir, emitEvent) => new PiCliAgentManager({ agentDir, emitEvent }),
      { expectedNativeAgentId: 'pi', thinkingLevel: 'off' },
    )
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

describe.runIf(process.env.ARYN_EXTERNAL_AGENT_TOOL_SMOKE === '1')('external Agent tool and projection', () => {
  async function exerciseToolPrompt(
    label: string,
    createManager: (agentDir: string, emitEvent: (event: AgentClientEventPayload) => void) => SmokeAdapter,
    options: {
      modelKey?: string
      thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
    } = {},
  ) {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-external-agent-tool-'))
    const workspacePath = path.join(tempRoot, 'workspace')
    const agentDir = path.join(tempRoot, 'agent-data')
    const outputPath = path.join(workspacePath, 'agent-tool-smoke.txt')
    const expectedContent = `ARYN_TOOL_SMOKE_${label.replace(/\W+/g, '_').toUpperCase()}`
    const prompt = [
      'Use your file-writing tool to create agent-tool-smoke.txt in the current workspace.',
      `The file must contain exactly: ${expectedContent}`,
      'You must use a tool. After the file is written, reply with DONE.',
    ].join(' ')
    await mkdir(workspacePath, { recursive: true })
    const events: AgentClientEventPayload[] = []
    const manager = createManager(agentDir, (event) => {
      if (event.type !== 'workspace_state') events.push(event)
    })
    let sessionID: string | null = null

    try {
      const created = await manager.createSession(workspacePath, {
        modelKey: options.modelKey,
        name: `${label} tool smoke`,
        thinkingLevel: options.thinkingLevel,
      })
      sessionID = created.activeSession?.sessionId ?? null
      expect(sessionID).toBeTruthy()
      await expect(manager.sendPrompt(workspacePath, sessionID!, prompt)).resolves.toEqual({ ok: true })

      const deadline = Date.now() + 120_000
      while (Date.now() < deadline) {
        const state = await manager.loadWorkspaceState(workspacePath, sessionID!)
        const terminalError = findTerminalPromptError(state, events, sessionID!)
        if (terminalError) throw new Error(`${label} provider ended the tool prompt with an error: ${terminalError}`)
        const fileContent = await readFile(outputPath, 'utf8').catch(() => null)
        if (!state.runtime.isStreaming && fileContent !== null) {
          expect(fileContent.trim()).toBe(expectedContent)
          const native = state.activeSession?.native
          expect(native).toBeTruthy()
          const timeline = projectNativeSession({
            fileChanges: state.activeSession?.fileChanges ?? [],
            optimisticMessages: [],
            sessionId: sessionID!,
            snapshot: native as BbNativeSessionSnapshot,
            runtimeState: state.runtime,
            workspacePath,
          })
          const rows = flattenTimelineRows(timeline.rows)
          const toolRows = rows.filter((row) => (
            row.kind === 'work'
            && (row.workKind === 'command' || row.workKind === 'file-change' || row.workKind === 'tool')
          ))
          expect(toolRows.length).toBeGreaterThan(0)
          expect(JSON.stringify(toolRows)).toContain('agent-tool-smoke.txt')
          expect(rows.some((row) => (
            row.kind === 'conversation' && row.role === 'user' && row.text.includes('agent-tool-smoke.txt')
          ))).toBe(true)
          expect(rows.some((row) => (
            row.kind === 'conversation' && row.role === 'assistant' && row.text.trim().length > 0
          ))).toBe(true)
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      throw new Error(`${label} did not complete a projected file-writing tool call. Events: ${JSON.stringify(events.slice(-30))}`)
    } finally {
      if (sessionID) await manager.deleteSession(workspacePath, sessionID).catch(() => undefined)
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  }

  it('projects a real PI CLI file-writing tool call', async () => {
    await exerciseToolPrompt(
      'PI CLI',
      (agentDir, emitEvent) => new PiCliAgentManager({ agentDir, emitEvent }),
      { thinkingLevel: 'off' },
    )
  }, 150_000)

  it('projects a real builtin PI file-writing tool call', async () => {
    await exerciseToolPrompt(
      'Builtin PI',
      createBuiltinPiSmokeAdapter,
      { thinkingLevel: 'off' },
    )
  }, 150_000)

  it('projects a real Codex file-writing tool call', async () => {
    await exerciseToolPrompt(
      'Codex',
      (agentDir, emitEvent) => new CodexAgentManager({ agentDir, emitEvent }),
    )
  }, 150_000)

  it('projects a real OpenCode file-writing tool call', async () => {
    await exerciseToolPrompt(
      'OpenCode',
      (agentDir, emitEvent) => new OpenCodeAgentManager({ agentDir, emitEvent }),
      { modelKey: 'opencode/big-pickle' },
    )
  }, 150_000)
})

describe('external Agent prompt smoke diagnostics', () => {
  it('classifies a non-retrying Codex provider error without waiting for the smoke timeout', () => {
    const state = {
      activeSession: {
        native: {
          agentId: 'codex',
          notices: [{
            id: 'quota-error',
            kind: 'error',
            message: 'usage limit reached',
            turnId: 'turn-1',
            willRetry: false,
          }],
        },
      },
      runtime: {
        executionState: { type: 'idle' },
        isStreaming: false,
      },
    } as AgentWorkspaceState

    expect(findTerminalPromptError(state, [], 'codex-session')).toBe('usage limit reached')
  })

  it('does not classify a retrying provider notice as terminal', () => {
    const state = {
      activeSession: {
        native: {
          agentId: 'codex',
          notices: [{
            id: 'retry-error',
            kind: 'error',
            message: 'temporary failure',
            turnId: 'turn-1',
            willRetry: true,
          }],
        },
      },
      runtime: {
        executionState: { attempt: 1, message: 'temporary failure', next: Date.now(), type: 'retry' },
        isStreaming: false,
      },
    } as AgentWorkspaceState

    expect(findTerminalPromptError(state, [], 'codex-session')).toBeNull()
  })
})
