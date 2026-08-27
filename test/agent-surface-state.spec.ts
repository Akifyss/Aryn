import { describe, expect, it } from 'vitest'
import {
  isAgentVisibleWorkspaceOperational,
  resolveAgentComposerWorkspacePresentation,
  resolveAgentSessionControlPresentation,
  resolveAgentThreadbarSessionPresentation,
  shouldRetainNewConversationSurfaceDuringSubmission,
  shouldShowAgentNewConversationPrompt,
  shouldShowAgentProjectSessionMenu,
  shouldShowAgentSessionLoadingIndicator,
} from '../src/features/agent/lib/agent-surface-state'

const project = {
  addedAt: '2026-08-20T00:00:00.000Z',
  id: 'project-1',
  lastFilePath: null,
  lastOpenedAt: '2026-08-20T00:00:00.000Z',
  name: 'Career',
  path: 'C:/work/career',
}

const runtime = {
  agentId: 'codex' as const,
  workspacePath: project.path,
}

const targetSession = {
  createdAt: '2026-08-20T00:00:00.000Z',
  id: 'target-session',
  messageCount: 1,
  modifiedAt: '2026-08-20T00:01:00.000Z',
  name: 'Target session',
  path: 'target-session',
  preview: 'Target preview',
}

describe('resolveAgentComposerWorkspacePresentation', () => {
  it('keeps workspace-aware copy stable while same-workspace session operations are gated', () => {
    expect(resolveAgentComposerWorkspacePresentation({
      isWorkspaceContextPreparing: true,
      operationalWorkspacePath: project.path,
      visibleWorkspacePath: project.path,
    })).toEqual({
      canUseOperationalWorkspace: false,
      mentionWorkspacePath: null,
      placeholder: '发送消息，输入 @ 来提及文件…',
    })
  })

  it('presents the target workspace without exposing the source workspace to mentions', () => {
    expect(resolveAgentComposerWorkspacePresentation({
      isWorkspaceContextPreparing: true,
      operationalWorkspacePath: 'C:/work/source',
      visibleWorkspacePath: 'C:/work/target',
    })).toEqual({
      canUseOperationalWorkspace: false,
      mentionWorkspacePath: null,
      placeholder: '发送消息，输入 @ 来提及文件…',
    })
  })

  it('enables mentions only after the operational workspace is ready', () => {
    expect(resolveAgentComposerWorkspacePresentation({
      isWorkspaceContextPreparing: false,
      operationalWorkspacePath: project.path,
      visibleWorkspacePath: project.path,
    })).toEqual({
      canUseOperationalWorkspace: true,
      mentionWorkspacePath: project.path,
      placeholder: '发送消息，输入 @ 来提及文件…',
    })
  })

  it('uses generic copy when the visible conversation has no workspace', () => {
    expect(resolveAgentComposerWorkspacePresentation({
      isWorkspaceContextPreparing: false,
      operationalWorkspacePath: project.path,
      visibleWorkspacePath: null,
    })).toEqual({
      canUseOperationalWorkspace: false,
      mentionWorkspacePath: null,
      placeholder: '发送消息…',
    })
  })

  it('never exposes a stale operational workspace for a different visible target', () => {
    const state = {
      isWorkspaceContextPreparing: false,
      operationalWorkspacePath: 'C:/work/source',
      visibleWorkspacePath: 'C:/work/target',
    }

    expect(isAgentVisibleWorkspaceOperational(state)).toBe(false)
    expect(resolveAgentComposerWorkspacePresentation(state)).toEqual({
      canUseOperationalWorkspace: false,
      mentionWorkspacePath: null,
      placeholder: '发送消息，输入 @ 来提及文件…',
    })
  })
})

describe('shouldShowAgentNewConversationPrompt', () => {
  it('shows the prompt for true new-session entry points', () => {
    expect(shouldShowAgentNewConversationPrompt({ kind: 'conversationDraft' }, { kind: 'new' })).toBe(true)
    expect(shouldShowAgentNewConversationPrompt({ kind: 'project', projectId: 'project-1' }, { kind: 'new' })).toBe(true)
  })

  it('does not treat a selected conversation record without a restored session as a new conversation', () => {
    expect(shouldShowAgentNewConversationPrompt({ kind: 'conversation', conversationId: 'conversation-1' }, { kind: 'new' })).toBe(false)
  })

  it('hides the prompt when an actual session is selected', () => {
    expect(shouldShowAgentNewConversationPrompt({ kind: 'project', projectId: 'project-1' }, {
      agentId: 'codex',
      kind: 'session',
      sessionPath: 'session-a',
    })).toBe(false)
  })

  it('keeps the project session menu identity independent of runtime readiness', () => {
    expect(shouldShowAgentProjectSessionMenu({ kind: 'project', projectId: 'project-1' })).toBe(true)
    expect(shouldShowAgentProjectSessionMenu({ kind: 'conversationDraft' })).toBe(false)
    expect(shouldShowAgentProjectSessionMenu({
      kind: 'conversation',
      conversationId: 'conversation-1',
    })).toBe(false)
  })
})

describe('resolveAgentThreadbarSessionPresentation', () => {
  it('keeps the standalone draft threadbar empty', () => {
    expect(resolveAgentThreadbarSessionPresentation({
      activeWorkspaceContext: { kind: 'conversationDraft' },
      isConversationMaterializing: false,
      selection: { kind: 'new' },
    })).toEqual({
      isNewConversationPresentation: true,
      showSessionControl: false,
    })
  })

  it('keeps the threadbar empty until a materialized conversation is ready', () => {
    expect(resolveAgentThreadbarSessionPresentation({
      activeWorkspaceContext: { kind: 'conversation', conversationId: 'conversation-1' },
      isConversationMaterializing: true,
      selection: { kind: 'new' },
    })).toEqual({
      isNewConversationPresentation: true,
      showSessionControl: false,
    })
    expect(resolveAgentThreadbarSessionPresentation({
      activeWorkspaceContext: { kind: 'conversation', conversationId: 'conversation-1' },
      isConversationMaterializing: true,
      selection: {
        agentId: 'pi',
        kind: 'session',
        sessionPath: 'session-1',
      },
    })).toEqual({
      isNewConversationPresentation: true,
      showSessionControl: false,
    })
  })

  it('preserves the project new-session title and controls', () => {
    expect(resolveAgentThreadbarSessionPresentation({
      activeWorkspaceContext: { kind: 'project', projectId: 'project-1' },
      isConversationMaterializing: false,
      selection: { kind: 'new' },
    })).toEqual({
      isNewConversationPresentation: true,
      showSessionControl: true,
    })
  })

  it('shows the selected conversation controls outside materialization', () => {
    expect(resolveAgentThreadbarSessionPresentation({
      activeWorkspaceContext: { kind: 'conversation', conversationId: 'conversation-1' },
      isConversationMaterializing: false,
      selection: { kind: 'new' },
    })).toEqual({
      isNewConversationPresentation: false,
      showSessionControl: true,
    })
  })
})

describe('shouldRetainNewConversationSurfaceDuringSubmission', () => {
  it('retains the draft surface throughout first-session materialization', () => {
    expect(shouldRetainNewConversationSurfaceDuringSubmission({
      activeWorkspaceContext: { kind: 'conversationDraft' },
      conversationStatus: null,
      hasVisibleNativeSession: false,
      isSubmitting: true,
    })).toBe(true)
    expect(shouldRetainNewConversationSurfaceDuringSubmission({
      activeWorkspaceContext: { kind: 'conversation', conversationId: 'conversation-1' },
      conversationStatus: null,
      hasVisibleNativeSession: false,
      isSubmitting: true,
    })).toBe(true)
    expect(shouldRetainNewConversationSurfaceDuringSubmission({
      activeWorkspaceContext: { kind: 'conversation', conversationId: 'conversation-1' },
      conversationStatus: 'draft',
      hasVisibleNativeSession: false,
      isSubmitting: true,
    })).toBe(true)
    expect(shouldRetainNewConversationSurfaceDuringSubmission({
      activeWorkspaceContext: { kind: 'conversation', conversationId: 'conversation-1' },
      conversationStatus: 'active',
      hasVisibleNativeSession: false,
      isSubmitting: true,
    })).toBe(true)
  })

  it('hands off only to a real active conversation session', () => {
    expect(shouldRetainNewConversationSurfaceDuringSubmission({
      activeWorkspaceContext: { kind: 'conversation', conversationId: 'conversation-1' },
      conversationStatus: 'active',
      hasVisibleNativeSession: true,
      isSubmitting: true,
    })).toBe(false)
  })

  it('does not affect project submissions or completed submission state', () => {
    expect(shouldRetainNewConversationSurfaceDuringSubmission({
      activeWorkspaceContext: { kind: 'project', projectId: 'project-1' },
      conversationStatus: null,
      hasVisibleNativeSession: false,
      isSubmitting: true,
    })).toBe(false)
    expect(shouldRetainNewConversationSurfaceDuringSubmission({
      activeWorkspaceContext: { kind: 'conversationDraft' },
      conversationStatus: null,
      hasVisibleNativeSession: false,
      isSubmitting: false,
    })).toBe(false)
  })
})

describe('shouldShowAgentSessionLoadingIndicator', () => {
  it('shows loading immediately when no prior session content can cover the transition', () => {
    expect(shouldShowAgentSessionLoadingIndicator({
      hasVisibleSessionContent: false,
      isImmediateNewConversationSurface: false,
      isSessionContentLoading: true,
      showDelayedLoadingIndicator: false,
    })).toBe(true)
  })

  it('retains visible content during the grace period and shows loading after it expires', () => {
    const loadingState = {
      hasVisibleSessionContent: true,
      isImmediateNewConversationSurface: false,
      isSessionContentLoading: true,
    }
    expect(shouldShowAgentSessionLoadingIndicator({
      ...loadingState,
      showDelayedLoadingIndicator: false,
    })).toBe(false)
    expect(shouldShowAgentSessionLoadingIndicator({
      ...loadingState,
      showDelayedLoadingIndicator: true,
    })).toBe(true)
  })

  it('never covers completed sessions or immediate new-conversation surfaces', () => {
    expect(shouldShowAgentSessionLoadingIndicator({
      hasVisibleSessionContent: false,
      isImmediateNewConversationSurface: false,
      isSessionContentLoading: false,
      showDelayedLoadingIndicator: true,
    })).toBe(false)
    expect(shouldShowAgentSessionLoadingIndicator({
      hasVisibleSessionContent: false,
      isImmediateNewConversationSurface: true,
      isSessionContentLoading: true,
      showDelayedLoadingIndicator: true,
    })).toBe(false)
  })
})

describe('resolveAgentSessionControlPresentation', () => {
  const activeWorkspaceContext = { kind: 'project' as const, projectId: project.id }
  const previousSelection = {
    agentId: 'pi' as const,
    kind: 'session' as const,
    sessionPath: 'previous-session',
  }

  it('uses the navigation intent instead of the source runtime during a cross-project switch', () => {
    expect(resolveAgentSessionControlPresentation({
      activeProject: project,
      activeSelection: previousSelection,
      activeWorkspaceContext,
      projectSessions: {},
      request: {
        agentId: 'codex',
        kind: 'session',
        projectId: project.id,
        requestId: 1,
        sessionLabel: 'Target session',
        sessionPath: targetSession.path,
      },
      runtime: { ...runtime, agentId: 'pi', workspacePath: 'C:/work/previous' },
      sessions: [{ ...targetSession, name: 'Wrong runtime title' }],
    })).toEqual({
      label: 'Target session',
      selection: {
        agentId: 'codex',
        kind: 'session',
        sessionPath: targetSession.path,
      },
    })
  })

  it('resolves direct in-project navigation from the complete project snapshot', () => {
    expect(resolveAgentSessionControlPresentation({
      activeProject: project,
      activeSelection: {
        agentId: 'codex',
        kind: 'session',
        sessionPath: targetSession.path,
      },
      activeWorkspaceContext,
      projectSessions: {
        [project.id]: {
          hasCompleteSnapshot: true,
          sources: {
            codex: {
              error: null,
              hasLoaded: true,
              isLoading: false,
              sessions: [targetSession],
            },
          },
        },
      },
      request: null,
      runtime: { ...runtime, workspacePath: 'C:/work/previous' },
      sessions: [],
    }).label).toBe('Target session')
  })

  it('never leaks a previous workspace session when target metadata is unavailable', () => {
    expect(resolveAgentSessionControlPresentation({
      activeProject: project,
      activeSelection: {
        agentId: 'codex',
        kind: 'session',
        sessionPath: 'missing-session',
      },
      activeWorkspaceContext,
      projectSessions: {},
      request: null,
      runtime: { ...runtime, workspacePath: 'C:/work/previous' },
      sessions: [{ ...targetSession, path: 'missing-session' }],
    }).label).toBe('未命名会话')
  })
})
