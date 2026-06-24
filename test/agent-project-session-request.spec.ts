import { describe, expect, it } from 'vitest'
import {
  resolveAgentWorkspaceSessionRestore,
  type AgentProjectSessionRequest,
} from '../src/features/agent/lib/project-session-request'

describe('resolveAgentWorkspaceSessionRestore', () => {
  it('uses the requested project session instead of the last restored session', () => {
    const request: AgentProjectSessionRequest = {
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
