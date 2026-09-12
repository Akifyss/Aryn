import React, { useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { WorkbenchPane, type WorkbenchPaneCommands, type WorkbenchPaneConfiguration } from '../../src/features/workbench/workbench-pane'
import { WorkbenchConversationLayer } from '../../src/features/workbench/workbench-conversation-layer'
import { WorkbenchPanelLayer } from '../../src/features/workbench/workbench-panel-layer'
import { createDefaultWorkbenchLayout, openWorkbenchProjectSession, useWorkbenchStore } from '../../src/features/workbench/workbench-state'
import { useWorkspaceStore } from '../../src/features/workspace/store/use-workspace-store'
import { AGENT_DEFINITIONS } from '../../src/features/agent/agent-definition'
import '../../src/features/layout/components/app-shell/styles.css'
import '../../src/features/workbench/styles.css'

const app = window as any
const project = { id: 'qa', name: 'QA', path: '/qa', addedAt: '', lastOpenedAt: '', lastFilePath: null }
const noop = () => {}
app.probes = new Map()
app.calls = { mounts: 0, unmounts: 0, loads: 0, switches: 0, subscriptions: 0, unsubscribes: 0, aborts: 0, confirms: 0, prompts: [], creates: [], files: [] }
const listeners = new Set<(event: unknown) => void>()
const runtime = {
  agentId: 'pi', workspacePath: project.path, auth: {}, hasConfiguredModels: true,
  availableModels: ['test/model-a', 'test/model-b'], availableModelInputs: {},
  availableThinkingLevels: ['off'], availableThinkingLevelsByModel: {},
  defaultModel: 'test/model-a', selectedModel: 'test/model-a', defaultThinkingLevel: 'off', thinkingLevel: 'off',
  preferredModelByProvider: { test: 'model-a' }, isStreaming: false, isCompacting: false, compactionReason: null,
  steeringMessages: [], followUpMessages: [], steeringMode: 'one-at-a-time', followUpMode: 'one-at-a-time',
  steeringMessageCount: 0, followUpMessageCount: 0, pendingMessageCount: 0, retryAttempt: 0, retryMaxAttempts: null,
  supportsThinking: false, supportsQueuedMessageEditing: true, supportedRunningPromptBehaviors: ['steer', 'followUp'], setupHint: null,
}
const session = { id: 'created', path: 'created', name: 'Created', createdAt: '2026-09-12', modifiedAt: '2026-09-12', messageCount: 1 }
const activeSession = { sessionId: 'created', sessionPath: 'created', workspacePath: project.path, messages: [], annotations: { fileChangesByEntryId: {} }, name: 'Created' }
const state = (active = false) => ({ runtime: { ...runtime }, activeSession: active ? activeSession : null, sessions: [session] })
app.emit = (event: object) => listeners.forEach(listener => listener({ agentId: 'pi', ...event }))
app.stream = (delta: string) => app.emit({ type: 'assistant_message_delta', sessionId: 'created', delta })
app.startStream = () => {
  runtime.isStreaming = true
  app.emit({ type: 'workspace_state', state: state(true) })
  app.emit({ type: 'assistant_message_started', sessionId: 'created' })
}
app.appApi = {
  platform: 'win32', loadWorkspaceTree: async () => [],
  getAgentCatalog: async () => AGENT_DEFINITIONS.map(definition => ({ definition, available: true, command: null, reason: null, guidance: null, version: null })),
  onAgentEvent: (listener: (event: unknown) => void) => {
    app.calls.subscriptions++; listeners.add(listener)
    return () => { app.calls.unsubscribes++; listeners.delete(listener) }
  },
  listAgentSessions: async ({ agentId }: any) => agentId === 'pi' ? [session] : [],
  getWorkspaceState: async () => ({ lastAgentSessionPath: null, prefersNewAgentSession: true }),
  updateWorkspaceState: async () => ({}),
  loadAgentWorkspace: async () => { app.calls.loads++; return state() },
  pickAgentAttachments: async () => [{ fileName: 'notes.txt', kind: 'file', path: '/qa/notes.txt', mimeType: 'text/plain', size: 12 }],
  createAgentSession: async (scope: any, options: any) => {
    app.calls.creates.push({ scope, options })
    await new Promise<void>(resolve => { app.finishCreate = resolve })
    runtime.selectedModel = options.modelKey
    return state(true)
  },
  sendAgentPrompt: async (...args: unknown[]) => { app.calls.prompts.push(args) },
  switchAgentSession: async () => { app.calls.switches++; return state(true) },
  abortAgent: async () => { app.calls.aborts++ },
}
localStorage.setItem('aryn:last-new-conversation-agent', 'pi')
const layout = createDefaultWorkbenchLayout(project)
layout.panes.left.directoryOpen = false
useWorkbenchStore.setState({ ...useWorkbenchStore.getInitialState(), ...layout, project, initialized: true })
useWorkspaceStore.setState({ currentPath: project.path, openTabs: [], activeTabId: null })
app.draftId = layout.panes.left.activeTabId
app.inspect = () => useWorkbenchStore.getState()
app.context = (side: string) => {
  const node = document.querySelector(`#workbench-${side} .workbench-conversation-view:not([hidden]) [data-probe-id]`) as HTMLElement
  return node ? app.probes.get(node.dataset.probeId)?.current : null
}
app.read = (side: string) => {
  const context = app.context(side)
  return context && { draft: context.composerState.text, model: context.modelInputValue, assistant: context.draftAssistant,
    selection: context.activeSessionSelection, materializing: context.isConversationMaterializing }
}
app.openNew = (side: 'left' | 'right') => openWorkbenchProjectSession(side, project)
app.reopen = (side: 'left' | 'right') => openWorkbenchProjectSession(side, project, { agentId: 'pi', sessionPath: 'created', sessionLabel: 'Created' })
app.activate = (side: 'left' | 'right', id: string) => useWorkbenchStore.getState().activate(side, id)
app.moveNow = (side: 'left' | 'right') => flushSync(() => {
  document.querySelector<HTMLButtonElement>(`#workbench-${side} .file-tab.is-active .file-tab-move`)!.click()
})
function App() {
  const commands = useRef<Partial<Record<'left' | 'right', WorkbenchPaneCommands>>>({})
  const editorRef = useRef(null)
  app.close = (side: 'left' | 'right') => commands.current[side]?.close()
  const configuration = {
    editor: {
      navigation: { activeTab: 'file', treePanel: { expandedPaths: new Set(), nodes: [] }, gitPanel: {} },
      editorContent: { workspacePath: project.path, meoEditorHostRef: editorRef, fileActions: {} },
      fileTabs: { iconTheme: null, workspacePath: project.path }, fileSystemPanel: {}, },
    conversations: { projectState: { projects: [project], lastProjectId: project.id }, selectedProject: project,
      onWorkspaceStateChange: (state: unknown) => { app.workspaceState = state },
    },
    documentNavigation: { openFile: async (path: string, root: string, mode: unknown, target: (id: string) => void) => {
      app.calls.files.push({ path, root })
      useWorkspaceStore.getState().openTab({ filePath: path, workspacePath: root, editorKind: 'code', content: 'link' })
      target(useWorkspaceStore.getState().openTabs.at(-1)!.id)
    } }, refreshGitState: noop,
    onCloseDocument: async () => true, confirmCloseConversation: async () => { app.calls.confirms++; return !!app.allowClose },
  } as unknown as WorkbenchPaneConfiguration
  return <div className='app-shell' style={{ '--left-panel-toggle-anchor': '6px' } as React.CSSProperties}>
    <div className='workbench-panes' style={{ '--workbench-left-ratio': '50%' } as React.CSSProperties}>
      <WorkbenchPane pane='left' configuration={configuration} commands={commands} />
      <div className='workbench-separator' />
      <WorkbenchPane pane='right' configuration={configuration} commands={commands} />
      <WorkbenchPanelLayer configuration={configuration} commands={commands} />
      <WorkbenchConversationLayer configuration={configuration} commands={commands} />
    </div>
  </div>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
