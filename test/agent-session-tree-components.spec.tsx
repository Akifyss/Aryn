import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  AgentProjectSwitchTrigger,
  AgentSessionTreeView,
  type AgentSessionTreeController,
} from '@/features/agent/components/agent-session-tree/agent-session-tree'
import { AgentSessionTreeRow } from '@/features/agent/components/agent-session-tree/session-row'
import {
  AgentSessionTreeStatusItem,
  resolveAgentSessionTreeStatus,
} from '@/features/agent/components/agent-session-tree/status-item'
import { VirtualizedAgentTreeList } from '@/features/agent/components/agent-session-tree/virtualized-tree-list'
import type { AgentWorkspaceState } from '@/features/agent/types'
import { ProjectIcon } from '@/components/project-icon'

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
  it('uses a smaller initial render window for floating virtualized trees', () => {
    const rows = Array.from({ length: 1_000 }, (_, index) => ({
      key: `row-${index}`,
      label: `Row ${index}`,
    }))
    const renderTree = (isFloating: boolean) => renderToStaticMarkup(
      <VirtualizedAgentTreeList
        ariaLabel='Sessions'
        estimateRowSize={() => 34}
        isFloating={isFloating}
        renderRow={(row) => <span>{row.label}</span>}
        rows={rows}
      />,
    )
    const floatingRows = renderTree(true).match(/agent-session-virtual-item/g) ?? []
    const dockedRows = renderTree(false).match(/agent-session-virtual-item/g) ?? []

    expect(floatingRows.length).toBeGreaterThan(0)
    expect(floatingRows.length).toBeLessThan(dockedRows.length)
  })

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

  it('virtualizes large floating session collections', () => {
    const sessions = Array.from({ length: 1_000 }, (_, index) => ({
      createdAt: '2026-07-28T10:00:00.000Z',
      id: `session-${index}`,
      messageCount: 1,
      modifiedAt: '2026-07-28T10:05:00.000Z',
      name: `Floating session ${index}`,
      path: `session-${index}`,
      preview: 'Preview',
    }))
    const markup = renderToStaticMarkup(
      <AgentSessionTreeView
        controller={createController({
          agentState: {
            ...emptyAgentState,
            sessions,
          },
          selectedAgentId: 'codex',
        })}
        isFloating
      />,
    )
    const renderedSessionRows = markup.match(/agent-project-session-node/g) ?? []

    expect(markup).toContain('Floating session 0')
    expect(markup).not.toContain('Floating session 999')
    expect(markup).toContain('aria-setsize="1000"')
    expect(renderedSessionRows.length).toBeGreaterThan(0)
    expect(renderedSessionRows.length).toBeLessThan(40)
  })

  it('keeps the standalone floating empty state when no project is selected', () => {
    const markup = renderToStaticMarkup(
      <AgentSessionTreeView controller={createController()} isFloating />,
    )

    expect(markup).toContain('agent-session-tree-status-item is-empty')
    expect(markup).toContain('暂无对话')
  })

  it('keeps complete cached content visible without a parallel loading item', () => {
    const project = {
      addedAt: '2026-07-28T09:00:00.000Z',
      id: 'project-1',
      lastFilePath: null,
      lastOpenedAt: '2026-07-28T10:00:00.000Z',
      name: 'Aryn',
      path: 'C:\\workspace\\Aryn',
    }
    const controller = createController({
      projectSessions: {
        [project.id]: {
          hasCompleteSnapshot: true,
          sources: {
            'builtin-pi': {
              error: null,
              hasLoaded: false,
              isLoading: true,
              sessions: [{
                createdAt: '2026-07-28T10:00:00.000Z',
                id: 'session-1',
                messageCount: 1,
                modifiedAt: '2026-07-28T10:05:00.000Z',
                name: 'Cached session',
                path: 'session-1',
                preview: 'Preview',
              }],
            },
          },
        },
      },
      projectState: {
        lastProjectId: project.id,
        projects: [project],
      },
      workspacePath: project.path,
    })

    const markup = renderToStaticMarkup(
      <AgentSessionTreeView controller={controller} isFloating />,
    )

    expect(markup).toContain('Cached session')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).not.toContain('agent-session-tree-status-item is-loading')

    const emptyMarkup = renderToStaticMarkup(
      <AgentSessionTreeView
        controller={{
          ...controller,
          projectSessions: {
            [project.id]: {
              hasCompleteSnapshot: true,
              sources: {
                'builtin-pi': {
                  error: null,
                  hasLoaded: false,
                  isLoading: true,
                  sessions: [],
                },
              },
            },
          },
        }}
        isFloating
      />,
    )

    expect(emptyMarkup).toContain('agent-session-tree-status-item is-empty')
    expect(emptyMarkup).not.toContain('agent-session-tree-status-item is-loading')
  })

  it('hides runtime partial sessions until the initial project snapshot is complete', () => {
    const project = {
      addedAt: '2026-07-28T09:00:00.000Z',
      id: 'project-1',
      lastFilePath: null,
      lastOpenedAt: '2026-07-28T10:00:00.000Z',
      name: 'Aryn',
      path: 'C:\\workspace\\Aryn',
    }
    const controller = createController({
      projectSessions: {
        [project.id]: {
          hasCompleteSnapshot: false,
          sources: {
            'builtin-pi': {
              error: null,
              hasLoaded: true,
              isLoading: false,
              sessions: [{
                createdAt: '2026-07-28T10:00:00.000Z',
                id: 'partial-session',
                messageCount: 1,
                modifiedAt: '2026-07-28T10:05:00.000Z',
                name: 'Runtime partial session',
                path: 'partial-session',
                preview: 'Preview',
              }],
            },
            codex: {
              error: null,
              hasLoaded: false,
              isLoading: true,
              sessions: [],
            },
          },
        },
      },
      projectState: {
        lastProjectId: project.id,
        projects: [project],
      },
      sessionTreeAgentIds: ['builtin-pi', 'codex'],
      workspacePath: project.path,
    })

    const markup = renderToStaticMarkup(
      <AgentSessionTreeView controller={controller} isFloating />,
    )

    expect(markup).toContain('agent-session-tree-status-item is-loading')
    expect(markup).not.toContain('Runtime partial session')
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
    expect(markup).toContain('aria-level="1"')
    expect(markup).toContain('aria-level="2"')
    expect(markup).toContain('aria-posinset="2"')
    expect(markup).toContain('aria-setsize="2"')
    expect(markup).not.toContain('role="tree"')
    expect(markup).not.toContain('role="treeitem"')
    expect(markup).not.toContain('aria-busy="true"')
  })

  it('bounds docked tree markup to the virtual render window for large collections', () => {
    const projects = Array.from({ length: 1_000 }, (_, index) => ({
      addedAt: '2026-07-28T09:00:00.000Z',
      id: `project-${index}`,
      lastFilePath: null,
      lastOpenedAt: '2026-07-28T10:00:00.000Z',
      name: `Project ${index}`,
      path: `C:\\workspace\\project-${index}`,
    }))
    const markup = renderToStaticMarkup(
      <AgentSessionTreeView
        controller={createController({
          projectState: {
            lastProjectId: null,
            projects,
          },
        })}
      />,
    )
    const renderedProjectRows = markup.match(/agent-project-node/g) ?? []

    expect(markup).toContain('Project 0')
    expect(markup).not.toContain('Project 999')
    expect(renderedProjectRows.length).toBeGreaterThan(0)
    expect(renderedProjectRows.length).toBeLessThan(40)
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

  it('renders session agent identities with their brand artwork', () => {
    const markup = renderToStaticMarkup(
      <AgentSessionTreeRow
        agentId='codex'
        isActive={false}
        isDeleting={false}
        isRenaming={false}
        label='Codex session'
        onCancelRename={vi.fn()}
        onDelete={vi.fn()}
        onOpen={vi.fn()}
        onRename={vi.fn(async () => undefined)}
        onRequestRename={vi.fn()}
      />,
    )

    expect(markup).toContain('agent-brand-icon-image')
    expect(markup).toContain('src="./agent-icons/codex.svg"')
    expect(markup).not.toContain('agent-brand-icon-mask')
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

  it('renders loading and empty states as static AppItems', () => {
    const loadingMarkup = renderToStaticMarkup(
      <AgentSessionTreeStatusItem label='正在加载会话…' status='loading' />,
    )
    const emptyMarkup = renderToStaticMarkup(
      <AgentSessionTreeStatusItem label='暂无对话' status='empty' />,
    )
    const errorMarkup = renderToStaticMarkup(
      <AgentSessionTreeStatusItem label='部分 Agent 会话加载失败' status='error' />,
    )

    expect(loadingMarkup).toContain('agent-session-tree-status-item is-loading')
    expect(loadingMarkup).toContain('app-item-icon')
    expect(loadingMarkup).toContain('spinner')
    expect(loadingMarkup).toContain('正在加载会话…')
    expect(loadingMarkup).not.toContain('<button')
    expect(emptyMarkup).toContain('agent-session-tree-status-item is-empty')
    expect(emptyMarkup).toContain('app-item-row')
    expect(emptyMarkup).toContain('暂无对话')
    expect(errorMarkup).toContain('agent-session-tree-status-item is-error')
    expect(errorMarkup).toContain('部分 Agent 会话加载失败')
  })

  it('resolves initial loading, cached refresh, empty, and error states consistently', () => {
    expect(resolveAgentSessionTreeStatus({
      errorCount: 0,
      hasCompleteSnapshot: false,
      isPending: true,
      sessionCount: 1,
    })).toBe('loading')
    expect(resolveAgentSessionTreeStatus({
      errorCount: 0,
      hasCompleteSnapshot: true,
      isPending: true,
      sessionCount: 1,
    })).toBeNull()
    expect(resolveAgentSessionTreeStatus({
      errorCount: 0,
      hasCompleteSnapshot: true,
      isPending: true,
      sessionCount: 0,
    })).toBe('empty')
    expect(resolveAgentSessionTreeStatus({
      errorCount: 1,
      hasCompleteSnapshot: true,
      isPending: false,
      sessionCount: 0,
    })).toBe('error')
  })

  it('uses the Mingcute open-folder icon for expanded projects', () => {
    const closedMarkup = renderToStaticMarkup(<ProjectIcon />)
    const openMarkup = renderToStaticMarkup(<ProjectIcon isOpen />)

    expect(closedMarkup).not.toContain('is-open')
    expect(openMarkup).toContain('project-icon is-open')
    expect(openMarkup).not.toBe(closedMarkup)
  })
})
