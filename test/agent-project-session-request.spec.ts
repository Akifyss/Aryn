import { describe, expect, it } from 'vitest'
import {
  resolveAgentWorkspaceSessionRestore,
  shouldApplyAgentSessionOperationResult,
  shouldApplyAgentWorkspaceState,
  shouldPersistAgentWorkspaceSelection,
  type AgentProjectSessionRequest,
} from '../src/features/agent/lib/project-session-request'

describe('resolveAgentWorkspaceSessionRestore', () => {
  it('uses the requested project session instead of the last restored session', () => {
    const request: AgentProjectSessionRequest = {
      agentId: 'codex',
      kind: 'session',
      projectId: 'project-1',
      requestId: 1,
      sessionPath: 'C:/sessions/third.jsonl',
    }

    expect(resolveAgentWorkspaceSessionRestore(request, { lastAgentSessionPath: 'C:/sessions/first.jsonl' })).toEqual({
      preferredSessionPath: 'C:/sessions/third.jsonl',
    })
  })

  it('disables session restore when starting a new project session', () => {
    const request: AgentProjectSessionRequest = {
      kind: 'new',
      projectId: 'project-1',
      requestId: 1,
    }

    expect(resolveAgentWorkspaceSessionRestore(request, { lastAgentSessionPath: 'C:/sessions/first.jsonl' })).toEqual({
      options: { restoreSession: false },
      preferredSessionPath: null,
    })
  })

  it('falls back to workspace state when no explicit project session is requested', () => {
    expect(resolveAgentWorkspaceSessionRestore(null, { lastAgentSessionPath: 'C:/sessions/first.jsonl' })).toEqual({
      preferredSessionPath: 'C:/sessions/first.jsonl',
    })
  })

  it('skips session restore when the workspace prefers a new conversation draft', () => {
    expect(resolveAgentWorkspaceSessionRestore(null, {
      lastAgentSessionPath: 'C:/sessions/first.jsonl',
      prefersNewAgentSession: true,
    })).toEqual({
      options: { restoreSession: false },
      preferredSessionPath: null,
    })
  })

  it('ignores the previous session preference when the user explicitly asks for a project session', () => {
    const request: AgentProjectSessionRequest = {
      agentId: 'pi',
      kind: 'session',
      projectId: 'project-1',
      requestId: 1,
      sessionPath: 'C:/sessions/third.jsonl',
    }

    expect(resolveAgentWorkspaceSessionRestore(request, {
      lastAgentSessionPath: 'C:/sessions/first.jsonl',
      prefersNewAgentSession: true,
    })).toEqual({
      preferredSessionPath: 'C:/sessions/third.jsonl',
    })
  })

  it('treats an unset prefersNewAgentSession as false', () => {
    expect(resolveAgentWorkspaceSessionRestore(null, { lastAgentSessionPath: null })).toEqual({
      preferredSessionPath: null,
    })
  })
})

describe('shouldApplyAgentWorkspaceState', () => {
  it('only applies full runtime state for the currently selected native session', () => {
    expect(shouldApplyAgentWorkspaceState({ agentId: 'codex', kind: 'session', sessionPath: 'session-a' }, 'codex', 'session-a')).toBe(true)
    expect(shouldApplyAgentWorkspaceState({ agentId: 'codex', kind: 'session', sessionPath: 'session-a' }, 'pi', 'session-a')).toBe(false)
    expect(shouldApplyAgentWorkspaceState({ agentId: 'codex', kind: 'session', sessionPath: 'session-a' }, 'codex', 'session-b')).toBe(false)
    expect(shouldApplyAgentWorkspaceState({ agentId: 'codex', kind: 'session', sessionPath: 'session-a' }, 'codex', null)).toBe(false)
  })

  it('keeps a new-session draft isolated from background session broadcasts', () => {
    expect(shouldApplyAgentWorkspaceState({ kind: 'new' }, 'builtin-pi', null)).toBe(true)
    expect(shouldApplyAgentWorkspaceState({ kind: 'new' }, 'builtin-pi', 'background-session')).toBe(false)
  })
})

describe('shouldPersistAgentWorkspaceSelection', () => {
  it('rejects stale runtime state while a different workspace is being restored', () => {
    expect(shouldPersistAgentWorkspaceSelection({
      agentId: 'opencode',
      workspacePath: 'C:/work/previous',
    }, 'opencode', 'C:/work/current')).toBe(false)
  })

  it('accepts only the selected agent runtime for the current normalized workspace', () => {
    expect(shouldPersistAgentWorkspaceSelection({
      agentId: 'opencode',
      workspacePath: 'C:\\work\\current\\',
    }, 'opencode', 'c:/work/current')).toBe(true)
    expect(shouldPersistAgentWorkspaceSelection({
      agentId: 'pi',
      workspacePath: 'C:/work/current',
    }, 'opencode', 'C:/work/current')).toBe(false)
  })
})

describe('shouldApplyAgentSessionOperationResult', () => {
  const operation = {
    agentId: 'opencode' as const,
    sessionPath: 'session-shared',
    workspacePath: 'C:/work/current',
  }

  it('accepts a result only while its Agent, native session, and workspace remain selected', () => {
    expect(shouldApplyAgentSessionOperationResult({
      agentId: 'opencode',
      kind: 'session',
      sessionPath: 'session-shared',
    }, 'c:\\work\\current\\', operation)).toBe(true)
  })

  it('rejects a colliding native path from another Agent', () => {
    expect(shouldApplyAgentSessionOperationResult({
      agentId: 'codex',
      kind: 'session',
      sessionPath: 'session-shared',
    }, 'C:/work/current', operation)).toBe(false)
  })

  it('rejects stale results after a session, workspace, or draft switch', () => {
    expect(shouldApplyAgentSessionOperationResult({
      agentId: 'opencode',
      kind: 'session',
      sessionPath: 'session-next',
    }, 'C:/work/current', operation)).toBe(false)
    expect(shouldApplyAgentSessionOperationResult({
      agentId: 'opencode',
      kind: 'session',
      sessionPath: 'session-shared',
    }, 'C:/work/next', operation)).toBe(false)
    expect(shouldApplyAgentSessionOperationResult({ kind: 'new' }, 'C:/work/current', operation)).toBe(false)
    expect(shouldApplyAgentSessionOperationResult({
      agentId: 'opencode',
      kind: 'session',
      sessionPath: 'session-shared',
    }, null, operation)).toBe(false)
  })
})
