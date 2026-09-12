import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProvider } from '../src/features/agent/components/agent-sidebar/agent-sidebar'
import { DuoConversationList } from '../src/features/duo/duo-conversation-list'
import { createDuoPane, useDuoStore } from '../src/features/duo/duo-state'
import type { ConversationRecord } from '../electron/shared/contracts/conversations'
import type { ProjectRecord } from '../src/features/workspace/types'

const captured = vi.hoisted(() => ({ provider: null as ComponentProps<typeof AgentProvider> | null, tree: {} }))
vi.mock('../src/features/agent/components/agent-sidebar/agent-sidebar', () => ({
  AgentProvider: (props: ComponentProps<typeof AgentProvider>) => { captured.provider = props; return props.children },
  AgentSessionTree: (props: object) => { captured.tree = props; return <div data-shared-agent-tree /> },
}))
const conversation: ConversationRecord = {
  id: 'example', agentId: 'pi', title: '对话标题', titleSource: 'user',
  createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z',
  status: 'active', workspacePath: null, agentSessionPath: null, lastMessagePreview: '预览',
}
const project: ProjectRecord = { id: 'project', name: '工作项目', path: '/workspace', addedAt: '', lastOpenedAt: '', lastFilePath: null }

beforeEach(() => {
  captured.provider = null
  useDuoStore.setState({ panes: { left: createDuoPane(), right: createDuoPane() }, focusedPane: 'right' })
})

describe('Duo shared project and conversation navigation', () => {
  it('uses the shared project session browser, excluding other projects and standalone data', () => {
    const configuration = {
      conversationState: { version: 3 as const, conversations: [conversation] },
      projectState: { lastProjectId: null, projects: [project] },
      selectedProject: project,
      onRenameConversation: vi.fn(), onRemoveConversation: vi.fn(),
      onOpenProjectAddMenu: vi.fn(), onOpenProjectFolder: vi.fn(), onRemoveProject: vi.fn(),
    }
    const markup = renderToStaticMarkup(<DuoConversationList pane='left' configuration={configuration} />)
    expect(markup).toContain('data-shared-agent-tree')
    expect(markup).not.toContain('duo-conversation-items')
    expect(captured.provider).toMatchObject({
      workspaceActivation: 'none',
      projectState: { projects: [project], lastProjectId: project.id },
      activeWorkspaceContext: { kind: 'project', projectId: project.id }, workspacePath: project.path,
    })
    expect(captured.provider!.conversationState).toBeUndefined()
    expect(captured.provider!.onOpenConversation).toBeUndefined()
    expect(captured.provider!.onCreateConversationWorkspace).toBeUndefined()
    expect(captured.tree).toMatchObject({ scope: 'current-project', openSessionsInPlace: false })
    expect(markup).not.toContain(conversation.title)
  })

  it.each(['left', 'right'] as const)('opens project history in the %s pane without changing its peer', async (pane) => {
    renderToStaticMarkup(<DuoConversationList pane={pane} configuration={{ selectedProject: project }} />)
    const provider = captured.provider!
    await provider.onOpenProjectSession!(project, 'pi', '/workspace/session.jsonl', '历史会话')
    const firstId = useDuoStore.getState().panes[pane].activeTabId
    await provider.onOpenProjectSession!(project, 'pi', '/workspace/session.jsonl', '历史会话')
    expect(useDuoStore.getState().panes[pane].activeTabId).toBe(firstId)
    expect(useDuoStore.getState().panes[pane].tabs).toHaveLength(1)
    expect(useDuoStore.getState().panes[pane].tabs[0]).toMatchObject({ projectSession: { project, request: { kind: 'session', agentId: 'pi', sessionPath: '/workspace/session.jsonl' } } })
    expect(provider.onStartStandaloneConversation).toBeUndefined()
    expect(useDuoStore.getState().panes[pane === 'left' ? 'right' : 'left'].tabs).toEqual([])
  })

  it('requires a selected project instead of loading a standalone runtime', () => {
    const markup = renderToStaticMarkup(<DuoConversationList pane='left' configuration={{ selectedProject: null }} />)
    expect(markup).toContain('选择项目以开始对话')
    expect(captured.provider).toBeNull()
    expect(useDuoStore.getState().panes.left.tabs).toEqual([])
  })

  it.each(['left', 'right'] as const)('the %s list direction action moves an already open session to its peer', async pane => {
    renderToStaticMarkup(<DuoConversationList pane={pane} configuration={{ selectedProject: project }} />)
    await captured.provider!.onOpenProjectSession!(project, 'pi', '/workspace/history', 'History')
    const tab = useDuoStore.getState().panes[pane].tabs[0]
    const tree = captured.tree as { otherPaneAction: { onOpenSession: (agent: string, path: string, label: string) => void } }
    tree.otherPaneAction.onOpenSession('pi', '/workspace/history', 'History')
    const peer = pane === 'left' ? 'right' : 'left'
    expect(useDuoStore.getState().panes[pane].tabs).toEqual([])
    expect(useDuoStore.getState().panes[peer].tabs).toEqual([tab])
    expect(useDuoStore.getState().panes[peer].tabs[0]).toBe(tab)
    expect(useDuoStore.getState().focusedPane).toBe(peer)
  })
})
