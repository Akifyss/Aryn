import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  AgentProjectSwitchTrigger,
  AgentSessionTreeView,
  type AgentSessionTreeController,
} from '@/features/agent/components/agent-session-tree/agent-session-tree'
import { AgentSessionTreeRow } from '@/features/agent/components/agent-session-tree/session-row'
import type { AgentWorkspaceState } from '@/features/agent/types'

const emptyAgentState: AgentWorkspaceState = {
  activeSession: null,
  runtime: {
    agentId: 'builtin-pi',
    auth: {},
    availableModelInputs: {},
    availableModels: [],
    availableThinkingLevels: ['off'],
    availableThinkingLevelsByModel: {},
    compactionReason: null,
    followUpMessageCount: 0,
    followUpMessages: [],
    followUpMode: 'one-at-a-time',
    hasConfiguredModels: false,
    isCompacting: false,
    defaultModel: null,
    defaultThinkingLevel: 'medium',
    isStreaming: false,
    pendingMessageCount: 0,
    preferredModelByProvider: {},
    retryAttempt: 0,
    retryMaxAttempts: null,
    selectedModel: null,
    setupHint: null,
    supportedRunningPromptBehaviors: ['steer', 'followUp'],
    supportsQueuedMessageEditing: true,
    supportsThinking: false,
    steeringMessageCount: 0,
    steeringMessages: [],
    steeringMode: 'one-at-a-time',
    thinkingLevel: 'off',
    workspacePath: null,
  },
  sessions: [],
}

function createController(
  overrides: Partial<AgentSessionTreeController> = {},
): AgentSessionTreeController {
  return {
    activeWorkspaceContext: { kind: 'conversationDraft' },
    activeSessionPath: null,
    activeSessionSelection: { kind: 'new' },
    agentState: emptyAgentState,
    conversationState: { version: 3, conversations: [] },
    deletingSessionPath: null,
    handleDeleteSession: vi.fn(async () => undefined),
    handleOpenSession: vi.fn(async () => undefined),
    handleRenameSession: vi.fn(async () => undefined),
    handleStartNewSession: vi.fn(),
    isProjectAddMenuOpen: false,
    loadProjectSessions: vi.fn(async () => undefined),
    projectSessions: {},
    projectState: { lastProjectId: null, projects: [] },
    selectedAgentId: 'builtin-pi',
    sessionActivityById: {},
    sessionTreeAgentIds: ['builtin-pi'],
    workspacePath: null,
    ...overrides,
  }
}

describe('AgentSessionTree presentation components', () => {
  it('selects the flat session view for floating surfaces', () => {
    const controller = createController({
      agentState: {
        ...emptyAgentState,
        sessions: [{
          createdAt: '2026-07-28T10:00:00.000Z',
          id: 'session-1',
          messageCount: 1,
          modifiedAt: '2026-07-28T10:05:00.000Z',
          name: 'Floating session',
          path: 'session-1',
          preview: 'Preview',
        }],
      },
      selectedAgentId: 'codex',
    })

    const markup = renderToStaticMarkup(
      <AgentSessionTreeView controller={controller} isFloating />,
    )

    expect(markup).toContain('agent-flat-session-list')
    expect(markup).toContain('Floating session')
    expect(markup).not.toContain('agent-session-section-stack')
  })

  it('renders project and conversation sections for docked surfaces', () => {
    const project = {
      addedAt: '2026-07-28T09:00:00.000Z',
      id: 'project-1',
      lastFilePath: null,
      lastOpenedAt: '2026-07-28T10:00:00.000Z',
      name: 'Aryn',
      path: 'C:\\workspace\\Aryn',
    }
    const controller = createController({
      activeWorkspaceContext: { kind: 'conversation', conversationId: 'conversation-1' },
      conversationState: {
        version: 3,
        conversations: [{
          agentId: 'codex',
          agentSessionPath: null,
          createdAt: '2026-07-28T10:00:00.000Z',
          id: 'conversation-1',
          lastMessagePreview: null,
          status: 'active',
          title: 'Architecture review',
          titleSource: 'user',
          updatedAt: '2026-07-28T10:05:00.000Z',
          workspacePath: null,
        }],
      },
      projectState: {
        lastProjectId: project.id,
        projects: [project],
      },
    })

    const markup = renderToStaticMarkup(
      <AgentSessionTreeView controller={controller} />,
    )

    expect(markup).toContain('agent-project-tree-shell')
    expect(markup).toContain('Aryn')
    expect(markup).toContain('Architecture review')
    expect(markup).toContain('项目')
    expect(markup).toContain('对话')
  })

  it('keeps rename controls inside the reusable session row', () => {
    const markup = renderToStaticMarkup(
      <AgentSessionTreeRow
        agentId='codex'
        isActive
        isDeleting={false}
        isRenaming
        label='Rename me'
        onCancelRename={vi.fn()}
        onDelete={vi.fn()}
        onOpen={vi.fn()}
        onRename={vi.fn(async () => undefined)}
        onRequestRename={vi.fn()}
      />,
    )

    expect(markup).toContain('raw-rename-input')
    expect(markup).toContain('value="Rename me"')
    expect(markup).toContain('aria-label="Confirm rename"')
    expect(markup).toContain('aria-label="Cancel rename"')
    expect(markup).not.toContain('Open Rename me menu')
  })

  it('preserves the public project switch trigger contract', () => {
    const markup = renderToStaticMarkup(
      <AgentProjectSwitchTrigger
        activeProject={{
          addedAt: '2026-07-28T09:00:00.000Z',
          id: 'project-1',
          lastFilePath: null,
          lastOpenedAt: '2026-07-28T10:00:00.000Z',
          name: 'Aryn',
          path: 'C:\\workspace\\Aryn',
        }}
        onOpenProjectSwitchMenu={vi.fn()}
      />,
    )

    expect(markup).toContain('agent-project-switch-trigger')
    expect(markup).toContain('切换项目，当前项目：Aryn')
    expect(markup).not.toContain('disabled=""')
  })
})
