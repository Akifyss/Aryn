import { describe, expect, it } from 'vitest'
import {
  agentSessionNavigationTargetsMatch,
  isAgentWorkspaceTargetPreparing,
  isAgentWorkspacePathReadyForTarget,
  isAgentNewConversationPresentation,
  resolveAgentSessionControlTarget,
  resolveAgentSessionNavigationTarget,
  resolvePendingAgentNewSessionProject,
  resolveAgentWorkspaceSessionRestore,
  shouldApplyAgentSessionNavigationResult,
  shouldApplyAgentSessionOperationResult,
  shouldApplyAgentWorkspaceState,
  shouldPersistAgentWorkspaceSelection,
  type AgentProjectSessionRequest,
} from '../src/features/agent/lib/project-session-request'

const projects = [{
  addedAt: '2026-08-20T00:00:00.000Z',
  id: 'project-1',
  lastFilePath: null,
  lastOpenedAt: '2026-08-20T00:00:00.000Z',
  name: 'Career',
  path: 'C:/work/career',
}]

describe('resolveAgentSessionNavigationTarget', () => {
  const conversation = {
    agentId: 'pi' as const,
    agentSessionPath: 'C:/sessions/conversation.jsonl',
    createdAt: '2026-08-20T00:00:00.000Z',
    id: 'conversation-1',
    lastMessagePreview: 'Hello',
    status: 'active' as const,
    title: 'Conversation',
    titleSource: 'user' as const,
    updatedAt: '2026-08-20T00:00:00.000Z',
    workspacePath: 'C:/work/conversation',
  }

  it('resolves an accepted conversation without waiting for the connected workspace', () => {
    expect(resolveAgentSessionNavigationTarget({
      activeConversation: conversation,
      activeWorkspaceContext: { kind: 'conversation', conversationId: conversation.id },
      projects,
      request: null,
    })).toMatchObject({
      agentId: 'pi',
      navigationKey: 'conversation:conversation-1:C:/sessions/conversation.jsonl',
      sessionPath: 'C:/sessions/conversation.jsonl',
      workspacePath: 'C:/work/conversation',
    })
  })

  it('resolves only the project session request owned by the active context', () => {
    const request: AgentProjectSessionRequest = {
      agentId: 'codex',
      kind: 'session',
      projectId: 'project-1',
      requestId: 7,
      sessionLabel: 'Target',
      sessionPath: 'C:/sessions/target.jsonl',
    }
    expect(resolveAgentSessionNavigationTarget({
      activeConversation: null,
      activeWorkspaceContext: { kind: 'project', projectId: 'project-1' },
      projects,
      request,
    })).toMatchObject({
      navigationKey: 'project:7',
      workspacePath: 'C:/work/career',
    })
    expect(resolveAgentSessionNavigationTarget({
      activeConversation: null,
      activeWorkspaceContext: { kind: 'project', projectId: 'another-project' },
      projects,
      request,
    })).toBeNull()
  })

  it('uses the full normalized identity to reject late navigation results', () => {
    const target = resolveAgentSessionNavigationTarget({
      activeConversation: conversation,
      activeWorkspaceContext: { kind: 'conversation', conversationId: conversation.id },
      projects,
      request: null,
    })
    expect(target).not.toBeNull()
    if (!target) throw new Error('Expected a conversation navigation target.')
    expect(agentSessionNavigationTargetsMatch(target, {
      ...target,
      workspacePath: 'c:\\work\\conversation\\',
    })).toBe(true)
    expect(agentSessionNavigationTargetsMatch(target, {
      ...target,
      navigationKey: 'conversation:2',
    })).toBe(false)
  })
})

describe('isAgentWorkspacePathReadyForTarget', () => {
  it('starts runtime work only after the connected path owns the accepted target', () => {
    expect(isAgentWorkspacePathReadyForTarget('C:/work/old', 'C:/work/career')).toBe(false)
    expect(isAgentWorkspacePathReadyForTarget('c:\\work\\career\\', 'C:/work/career')).toBe(true)
    expect(isAgentWorkspacePathReadyForTarget(null, null)).toBe(true)
    expect(isAgentWorkspacePathReadyForTarget(null, undefined)).toBe(false)
  })
})

describe('shouldApplyAgentSessionNavigationResult', () => {
  const operationTarget = {
    agentId: 'codex' as const,
    navigationKey: 'project:7',
    sessionPath: 'C:/sessions/target.jsonl',
    workspacePath: 'C:/work/career',
  }
  const selectedTarget = {
    agentId: 'codex' as const,
    kind: 'session' as const,
    sessionPath: operationTarget.sessionPath,
  }

  it('keeps a snapshot result valid after its transient project request is acknowledged', () => {
    expect(shouldApplyAgentSessionNavigationResult({
      currentNavigationTarget: null,
      currentSelection: selectedTarget,
      currentWorkspacePath: 'c:\\work\\career\\',
      operationTarget,
    })).toBe(true)
  })

  it('rejects the result when another navigation or presentation has taken ownership', () => {
    expect(shouldApplyAgentSessionNavigationResult({
      currentNavigationTarget: { ...operationTarget, navigationKey: 'project:8' },
      currentSelection: selectedTarget,
      currentWorkspacePath: operationTarget.workspacePath,
      operationTarget,
    })).toBe(false)
    expect(shouldApplyAgentSessionNavigationResult({
      currentNavigationTarget: null,
      currentSelection: { kind: 'new' },
      currentWorkspacePath: operationTarget.workspacePath,
      operationTarget,
    })).toBe(false)
  })
})

describe('resolvePendingAgentNewSessionProject', () => {
  it('resolves only a new-session request owned by the active project', () => {
    const request: AgentProjectSessionRequest = {
      kind: 'new',
      projectId: 'project-1',
      requestId: 1,
    }

    expect(resolvePendingAgentNewSessionProject(
      request,
      { kind: 'project', projectId: 'project-1' },
      projects,
    )).toBe(projects[0])
    expect(resolvePendingAgentNewSessionProject(
      request,
      { kind: 'project', projectId: 'project-2' },
      projects,
    )).toBeNull()
    expect(resolvePendingAgentNewSessionProject(
      request,
      { kind: 'conversationDraft' },
      projects,
    )).toBeNull()
  })

  it('does not treat an existing-session request as a new-conversation surface', () => {
    expect(resolvePendingAgentNewSessionProject({
      agentId: 'codex',
      kind: 'session',
      projectId: 'project-1',
      requestId: 1,
      sessionLabel: 'Target session',
      sessionPath: 'thread-1',
    }, { kind: 'project', projectId: 'project-1' }, projects)).toBeNull()
  })
})

describe('resolveAgentSessionControlTarget', () => {
  const currentSelection = {
    agentId: 'pi' as const,
    kind: 'session' as const,
    sessionPath: 'previous-session',
  }

  it('commits an accepted project session target before its snapshot is ready', () => {
    expect(resolveAgentSessionControlTarget({
      agentId: 'codex',
      kind: 'session',
      projectId: 'project-1',
      requestId: 4,
      sessionLabel: 'Target session',
      sessionPath: 'target-session',
    }, { kind: 'project', projectId: 'project-1' }, currentSelection)).toEqual({
      label: 'Target session',
      selection: {
        agentId: 'codex',
        kind: 'session',
        sessionPath: 'target-session',
      },
    })
  })

  it('commits a matching new-session intent without inheriting the source title', () => {
    expect(resolveAgentSessionControlTarget({
      kind: 'new',
      projectId: 'project-1',
      requestId: 5,
    }, { kind: 'project', projectId: 'project-1' }, currentSelection)).toEqual({
      label: null,
      selection: { kind: 'new' },
    })
  })

  it('ignores stale requests owned by another context', () => {
    expect(resolveAgentSessionControlTarget({
      agentId: 'codex',
      kind: 'session',
      projectId: 'project-1',
      requestId: 6,
      sessionLabel: 'Stale session',
      sessionPath: 'stale-session',
    }, { kind: 'project', projectId: 'project-2' }, currentSelection)).toEqual({
      label: null,
      selection: currentSelection,
    })
  })
})

describe('isAgentNewConversationPresentation', () => {
  it('keeps an explicit project draft active across normalized workspace paths', () => {
    expect(isAgentNewConversationPresentation(
      { kind: 'new' },
      'c:\\work\\career\\',
      { kind: 'project', projectId: 'project-1' },
      projects,
    )).toBe(true)
  })

  it('recognizes standalone drafts without leaking them into another context', () => {
    expect(isAgentNewConversationPresentation(
      { kind: 'new' },
      null,
      { kind: 'conversationDraft' },
      projects,
    )).toBe(true)
    expect(isAgentNewConversationPresentation(
      { kind: 'new' },
      null,
      { kind: 'project', projectId: 'project-1' },
      projects,
    )).toBe(false)
  })

  it('ends the draft presentation after a session becomes selected', () => {
    expect(isAgentNewConversationPresentation(
      { agentId: 'codex', kind: 'session', sessionPath: 'thread-1' },
      'C:/work/career',
      { kind: 'project', projectId: 'project-1' },
      projects,
    )).toBe(false)
  })
})

describe('isAgentWorkspaceTargetPreparing', () => {
  const readyRuntime = {
    agentId: 'codex' as const,
    workspacePath: 'C:/work/career',
  }

  it('stays pending until the workspace surface and runtime both own the target', () => {
    expect(isAgentWorkspaceTargetPreparing({
      currentWorkspacePath: 'C:/work/previous',
      hasPendingProjectSessionRequest: false,
      hasLoadedWorkspaceState: true,
      runtime: readyRuntime,
      selectedAgentId: 'codex',
      targetWorkspacePath: 'C:/work/career',
    })).toBe(true)
    expect(isAgentWorkspaceTargetPreparing({
      currentWorkspacePath: 'C:/work/career',
      hasPendingProjectSessionRequest: false,
      hasLoadedWorkspaceState: true,
      runtime: { ...readyRuntime, workspacePath: 'C:/work/previous' },
      selectedAgentId: 'codex',
      targetWorkspacePath: 'C:/work/career',
    })).toBe(true)
    expect(isAgentWorkspaceTargetPreparing({
      currentWorkspacePath: 'C:/work/career',
      hasPendingProjectSessionRequest: false,
      hasLoadedWorkspaceState: false,
      runtime: readyRuntime,
      selectedAgentId: 'codex',
      targetWorkspacePath: 'C:/work/career',
    })).toBe(true)
  })

  it('accepts normalized matching targets only for the selected Agent', () => {
    expect(isAgentWorkspaceTargetPreparing({
      currentWorkspacePath: 'c:\\work\\career\\',
      hasPendingProjectSessionRequest: false,
      hasLoadedWorkspaceState: true,
      runtime: readyRuntime,
      selectedAgentId: 'codex',
      targetWorkspacePath: 'C:/work/career',
    })).toBe(false)
    expect(isAgentWorkspaceTargetPreparing({
      currentWorkspacePath: 'C:/work/career',
      hasPendingProjectSessionRequest: false,
      hasLoadedWorkspaceState: true,
      runtime: readyRuntime,
      selectedAgentId: 'pi',
      targetWorkspacePath: 'C:/work/career',
    })).toBe(true)
  })

  it('stays pending while an accepted project session request still owns navigation', () => {
    expect(isAgentWorkspaceTargetPreparing({
      currentWorkspacePath: 'C:/work/career',
      hasPendingProjectSessionRequest: true,
      hasLoadedWorkspaceState: true,
      runtime: readyRuntime,
      selectedAgentId: 'codex',
      targetWorkspacePath: 'C:/work/career',
    })).toBe(true)
  })

  it('supports a ready projectless draft and treats an unresolved target as pending', () => {
    expect(isAgentWorkspaceTargetPreparing({
      currentWorkspacePath: null,
      hasPendingProjectSessionRequest: false,
      hasLoadedWorkspaceState: true,
      runtime: { agentId: 'codex', workspacePath: null },
      selectedAgentId: 'codex',
      targetWorkspacePath: null,
    })).toBe(false)
    expect(isAgentWorkspaceTargetPreparing({
      currentWorkspacePath: null,
      hasPendingProjectSessionRequest: false,
      hasLoadedWorkspaceState: true,
      runtime: { agentId: 'codex', workspacePath: null },
      selectedAgentId: 'codex',
      targetWorkspacePath: undefined,
    })).toBe(true)
  })
})

describe('resolveAgentWorkspaceSessionRestore', () => {
  it('uses the requested project session instead of the last restored session', () => {
    const request: AgentProjectSessionRequest = {
      agentId: 'codex',
      kind: 'session',
      projectId: 'project-1',
      requestId: 1,
      sessionLabel: 'Third session',
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
      sessionLabel: 'Third session',
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
