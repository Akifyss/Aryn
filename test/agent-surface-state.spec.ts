import { describe, expect, it } from 'vitest'
import {
  resolveAgentSessionControlPresentation,
  shouldShowAgentNewConversationPrompt,
  shouldShowAgentProjectSessionMenu,
  shouldShowAgentSessionLoadingIndicator,
  shouldShowAgentThreadbarSessionControl,
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

  it('hides the threadbar session control only for standalone conversation drafts', () => {
    expect(shouldShowAgentThreadbarSessionControl(
      { kind: 'conversationDraft' },
      { kind: 'new' },
    )).toBe(false)
    expect(shouldShowAgentThreadbarSessionControl(
      { kind: 'project', projectId: 'project-1' },
      { kind: 'new' },
    )).toBe(true)
    expect(shouldShowAgentThreadbarSessionControl(
      { kind: 'conversation', conversationId: 'conversation-1' },
      { kind: 'new' },
    )).toBe(true)
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
