import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import type { EditorViewHandle, EditorViewState } from '@/features/editor/lib/editor-view-handle'
import type { MeoEditorHostHandle } from '@/features/editor/components/meo-editor-host/meo-editor-host'
import { WorkspaceEditorWorkbench } from '@/features/workspace/components/workspace-workbench/workspace-editor-workbench'
import { WorkspaceEditorDirectoryToggle } from '@/features/workspace/components/workspace-editor-surface/workspace-editor-surface'
import { WorkspaceGitPane, WorkspaceTreePane } from '@/features/workspace/components/workspace-workbench/workspace-navigation-panels'
import { WorkspaceSidebarTabs, type WorkspaceSidebarTabWithConversations } from '@/features/workspace/components/workspace-sidebar-tabs/workspace-sidebar-tabs'
import { deriveWorkspaceTabViewState, getFixedPanelTab } from '@/features/workspace/lib/workspace-tabs'
import { collectWorkspaceDirectoryPaths } from '@/features/workspace/lib/workspace-file-operation-state'
import { useWorkspaceStore, type WorkspaceDisplayTab } from '@/features/workspace/store/use-workspace-store'
import type { DuoConversationConfiguration } from './duo-conversations'
import type { DuoConversationHandle } from './duo-conversation-layer'
import { DuoConversationList } from './duo-conversation-list'
import { DUO_CONVERSATIONS_ID, DUO_GIT_ID, getDuoProjectTabs, hasOtherDuoDocumentOwner, useDuoStore, type DuoPaneId } from './duo-state'
import { DuoNewTabMenu } from './duo-new-tab-menu'
import { DUO_START_TAB, DuoStartPage } from './duo-start-page'
import { cancelDuoDocumentNavigation, createDuoDocumentNavigation, type DuoDocumentNavigation } from './duo-document-navigation'
import { createDuoPanelNavigation } from './duo-panel-navigation'

export type DuoPaneCommands = {
  focus: () => void
  conversationHost: React.RefObject<HTMLDivElement | null>
  panelHost: React.RefObject<HTMLDivElement | null>
  registerConversation: (id: string, handle: DuoConversationHandle | null) => void
  capture: () => void
  close: () => Promise<void>
  cycle: (direction: 1 | -1) => void
  receiveDocument: (id: string, state: EditorViewState | null) => void
}

export type DuoPaneConfiguration = {
  editor: ComponentProps<typeof WorkspaceEditorWorkbench>
  conversations: DuoConversationConfiguration
  onCloseDocument: (id: string) => Promise<boolean>
  documentNavigation: DuoDocumentNavigation
  refreshGitState: Parameters<typeof createDuoDocumentNavigation>[3]
  confirmCloseConversation: () => Promise<boolean>
}

export function DuoPane({ pane, configuration, commands, isActive }: {
  pane: DuoPaneId
  configuration: DuoPaneConfiguration
  commands: React.RefObject<Partial<Record<DuoPaneId, DuoPaneCommands>>>
  isActive: boolean
}) {
  const paneState = useDuoStore((state) => state.panes[pane])
  const projectTabs = getDuoProjectTabs(paneState.tabs, configuration.conversations.selectedProject)
  const selectedTabId = projectTabs.some((tab) => tab.id === paneState.activeTabId)
    ? paneState.activeTabId : projectTabs[0]?.id ?? ''
  const isFocused = useDuoStore((state) => state.focusedPane === pane)
  const documents = useWorkspaceStore((state) => state.openTabs)
  const editorRef = useRef<MeoEditorHostHandle>(null)
  const paneRef = useRef<HTMLElement>(null)
  const viewRef = useRef<{ id: string; handle: EditorViewHandle } | null>(null)
  const pendingViewRef = useRef<{ id: string; state: EditorViewState | null; revision: number } | null>(null)
  const applyPendingView = useCallback(() => {
    const pending = pendingViewRef.current
    if (!pending) return
    const current = useDuoStore.getState()
    if (current.scopeRevision !== pending.revision || current.restoring
      || current.focusedPane !== pane || current.panes[pane].activeTabId !== pending.id) {
      pendingViewRef.current = null
      return
    }
    const view = viewRef.current
    if (view?.id === pending.id) {
      pendingViewRef.current = null
      view.handle.focus()
      if (pending.state) view.handle.restore(pending.state)
    } else {
      paneRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true })
      if (!pending.state) pendingViewRef.current = null
    }
  }, [pane])
  const setViewHandle = useCallback((handle: EditorViewHandle | null) => {
    viewRef.current = handle ? { id: selectedTabId, handle } : null
    if (handle) applyPendingView()
  }, [selectedTabId, applyPendingView])
  useLayoutEffect(applyPendingView)
  const conversationHost = useRef<HTMLDivElement>(null)
  const panelHost = useRef<HTMLDivElement>(null)
  const conversationHandles = useRef(new Map<string, DuoConversationHandle>())
  const navigationTab = paneState.directoryTab
  const setNavigationTab = (tab: WorkspaceSidebarTabWithConversations) => useDuoStore.getState().setDirectoryTab(pane, tab)
  const [expandedPaths, setExpandedPaths] = useState(configuration.editor.navigation.treePanel.expandedPaths)
  const workspacePath = configuration.editor.editorContent.workspacePath
  const documentNavigation = createDuoDocumentNavigation(pane, configuration.documentNavigation, workspacePath, configuration.refreshGitState)
  const otherPane = pane === 'left' ? 'right' : 'left'
  const otherPaneNavigation = createDuoDocumentNavigation(otherPane, configuration.documentNavigation, workspacePath, configuration.refreshGitState)
  const sharedEditorRef = configuration.editor.editorContent.meoEditorHostRef
  const setEditorHost = useCallback((host: MeoEditorHostHandle | null) => {
    editorRef.current = host
    if (isActive && useDuoStore.getState().focusedPane === pane && typeof sharedEditorRef === 'object' && sharedEditorRef) {
      sharedEditorRef.current = host
    }
  }, [isActive, pane, sharedEditorRef])
  useEffect(() => {
    setExpandedPaths(new Set())
  }, [workspacePath])

  const state = deriveWorkspaceTabViewState({
    activeAgentLayoutFixedTab: 'file',
    activeTabId: selectedTabId,
    isAgentLayout: false,
    isAgentLayoutFixedTabActive: false,
    openTabs: documents,
  })
  const tabs: WorkspaceDisplayTab[] = []
  for (const tab of projectTabs) {
    if (tab.kind === 'document') {
      const document = documents.find((item) => item.id === tab.id)
      if (document) tabs.push(document)
    } else if (tab.kind === 'panel') {
      tabs.push({
        ...getFixedPanelTab(tab.id === DUO_GIT_ID ? 'git' : 'file'),
        id: tab.id, filePath: tab.id, closable: true,
        fixedTabKind: tab.id === DUO_CONVERSATIONS_ID ? 'conversation-panel' : tab.id === DUO_GIT_ID ? 'git-panel' : 'file-panel',
      })
    } else {
      const projectRequest = tab.projectSession?.request
      const title = projectRequest?.kind === 'session' ? projectRequest.sessionLabel
        : '新对话'
      tabs.push({ ...tab, title, filePath: tab.id, exists: true, isDirty: false })
    }
  }
  // Derive the fallback from visible tabs, without inserting a synthetic
  // document into either store or leaving a permanent pinned page behind.
  const isEmpty = tabs.length === 0
  if (isEmpty) tabs.push(DUO_START_TAB)
  const activeTabId = isEmpty ? DUO_START_TAB.id : selectedTabId
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const hasDocument = activeTab?.kind === 'file' || activeTab?.kind === 'diff'
  useLayoutEffect(() => {
    if (!isActive || !isFocused || !hasDocument) return
    useWorkspaceStore.getState().activateTab(selectedTabId)
    const ref = configuration.editor.editorContent.meoEditorHostRef
    if (typeof ref === 'object' && ref) ref.current = editorRef.current
  }, [isActive, isFocused, hasDocument, selectedTabId, configuration.editor.editorContent.meoEditorHostRef])
  const directoryVisible = paneState.directoryOpen
  const directoryId = `duo-${pane}-directory`
  const toggleDirectory = () => useDuoStore.getState().toggleDirectory(pane)
  const focus = () => {
    const previous = useDuoStore.getState().focusedPane
    if (previous !== pane) commands.current[previous]?.capture()
    useDuoStore.getState().focus(pane)
    if (hasDocument) useWorkspaceStore.getState().activateTab(selectedTabId)
    const ref = configuration.editor.editorContent.meoEditorHostRef
    if (typeof ref === 'object' && ref) ref.current = editorRef.current
  }
  const activate = (id: string) => {
    editorRef.current?.captureViewPosition()
    useDuoStore.getState().activate(pane, id)
    if (documents.some((tab) => tab.id === id)) useWorkspaceStore.getState().activateTab(id)
  }
  const close = async (id: string) => {
    const scopeRevision = useDuoStore.getState().scopeRevision
    const isCurrent = () => useDuoStore.getState().scopeRevision === scopeRevision
    const tab = paneState.tabs.find((item) => item.id === id)
    if (!tab) return
    const conversation = conversationHandles.current.get(id)
    if (tab.kind === 'conversation' && conversation && !await conversation.canClose()) return
    if (!isCurrent()) return
    if (!useDuoStore.getState().panes[pane].tabs.some((item) => item.id === id)) return
    editorRef.current?.captureViewPosition()
    if (tab.kind === 'document') {
      const shared = hasOtherDuoDocumentOwner(useDuoStore.getState(), pane, id)
      if (!shared && !await configuration.onCloseDocument(id)) return
    }
    if (!isCurrent()) return
    useDuoStore.getState().close(pane, id)
    conversationHandles.current.delete(id)
    const nextId = useDuoStore.getState().panes[pane].activeTabId
    if (documents.some((item) => item.id === nextId)) useWorkspaceStore.getState().activateTab(nextId)
  }
  const moveTab = (id: string) => {
    const current = useDuoStore.getState()
    const tab = current.panes[pane].tabs.find(item => item.id === id)
    if (current.restoring || !tab) return
    // Capture the displaced editor first, then the source. No close/save path:
    // its shared draft remains alive even when this was the last source tab.
    commands.current[otherPane]?.capture()
    editorRef.current?.captureViewPosition()
    const pending = pendingViewRef.current
    const viewState = (viewRef.current?.id === id ? viewRef.current.handle.capture() : null)
      ?? (pending?.id === id && pending.revision === current.scopeRevision ? pending.state : null)
    cancelDuoDocumentNavigation(pane)
    cancelDuoDocumentNavigation(otherPane)
    if (tab.kind === 'document') commands.current[otherPane]?.receiveDocument(id, viewState)
    else if (tab.kind === 'conversation') conversationHandles.current.get(id)?.capture()
    current.moveTab(pane, id)
  }
  commands.current[pane] = {
    focus,
    conversationHost,
    panelHost,
    registerConversation: (id, handle) => {
      if (handle) conversationHandles.current.set(id, handle)
      else conversationHandles.current.delete(id)
    },
    capture: () => editorRef.current?.captureViewPosition(),
    close: () => close(selectedTabId),
    cycle: (direction) => {
      const ids = projectTabs.map((tab) => tab.id)
      if (!ids.length) return
      const index = ids.indexOf(selectedTabId)
      activate(ids[(index + direction + ids.length) % ids.length])
    },
    receiveDocument: (id, state) => {
      pendingViewRef.current = { id, state, revision: useDuoStore.getState().scopeRevision }
    },
  }

  const navigation: typeof configuration.editor.navigation = {
    ...configuration.editor.navigation,
    activeTab: navigationTab === 'conversation' ? 'file' as const : navigationTab,
    onActiveTabChange: setNavigationTab,
    activeTreePath: state.activeFileTab?.filePath ?? state.activeDiffTab?.filePath ?? null,
    onOpenFile: documentNavigation.openFile,
    gitPanel: createDuoPanelNavigation(pane, configuration).gitPanel,
    treePanel: {
      ...configuration.editor.navigation.treePanel,
      onOpenDiff: documentNavigation.openGitDiff,
      onOpenInCodeEditor: (path: string) => documentNavigation.openFile(path, workspacePath, 'code'),
      otherPaneAction: { direction: otherPane, onOpenFile: otherPaneNavigation.openFile },
      expandedPaths,
      setExpandedPaths,
      onToggleFileTreeExpansion: () => setExpandedPaths((current) => current.size > 0
        ? new Set() : collectWorkspaceDirectoryPaths(configuration.editor.navigation.treePanel.nodes)),
    },
    // Duo directory clicks open a tab; replacing a global active tab could affect its peer.
    onReplaceActiveFile: documentNavigation.openFile,
  }
  return (
    <section ref={paneRef} id={`duo-${pane}`} className='duo-pane' data-directory-side={pane} data-focused={isFocused} aria-label={pane === 'left' ? '左侧面板' : '右侧面板'} onPointerDownCapture={focus} onFocusCapture={focus}>
      <div className='duo-directory-control'>
        <WorkspaceEditorDirectoryToggle side={pane} controls={directoryId} isVisible={directoryVisible} onToggle={toggleDirectory} />
      </div>
      <WorkspaceEditorWorkbench
        {...configuration.editor}
        directorySidebarSide={pane}
        directorySidebarId={directoryId}
        directorySidebarContent={<WorkspaceSidebarTabs
          activeTab={navigationTab}
          onActiveTabChange={setNavigationTab}
          filePanel={<WorkspaceTreePane configuration={navigation} fileClickMode='open-tab' />}
          gitPanel={<WorkspaceGitPane configuration={navigation} />}
          conversationPanel={<DuoConversationList pane={pane} configuration={configuration.conversations} />}
        />}
        activeFixedPanelTab={activeTab?.kind === 'fixed-panel' ? activeTab : null}
        fixedPanelContent={<div ref={panelHost} className='duo-panel-host' />}
        editorContent={{
          ...configuration.editor.editorContent,
          fileActions: {
            ...configuration.editor.editorContent.fileActions,
            openFile: (path) => { void documentNavigation.openFile(path, state.activeFileTab?.workspacePath ?? workspacePath, 'meo') },
            openGitDiff: (path, action) => { void documentNavigation.openFileDiff(path, { ...action, view: 'meo' }) },
          },
          activeFileTab: hasDocument ? state.activeFileTab : null,
          activeDiffTab: hasDocument ? state.activeDiffTab : null,
          workspacePath: state.activeFileTab?.workspacePath ?? workspacePath,
          gitRepositoryState: state.activeFileTab?.workspacePath && state.activeFileTab.workspacePath !== workspacePath
            ? null : configuration.editor.editorContent.gitRepositoryState,
          diffDraftContent: state.activeDiffDraftContent,
          diffHasDirtyRelatedFileTab: state.activeDiffHasDirtyRelatedFileTab,
          isVisible: hasDocument,
          meoEditorHostRef: setEditorHost,
          viewHandleRef: setViewHandle,
        }}
        fileTabs={{
          ...configuration.editor.fileTabs,
          newTabAction: <DuoNewTabMenu pane={pane} configuration={configuration.conversations} />,
          tabs,
          activeTabId,
          onActivate: activate,
          onOpenDiff: (path) => { void documentNavigation.openFileDiff(path) },
          onClose: (id) => { void close(id) },
          onMoveTab: (moving, target, position) => useDuoStore.getState().reorder(pane, moving, target, position),
          otherPaneAction: { direction: otherPane, onMove: moveTab },
        }}
        navigation={navigation}
        isDirectorySidebarAvailable={false}
        isDirectorySidebarVisible={directoryVisible}
        isDirectoryToggleSlotVisible={false}
        onToggleDirectorySidebar={toggleDirectory}
        auxiliaryContent={<>
          {isEmpty ? <DuoStartPage pane={pane} configuration={configuration.conversations} /> : null}
          <div ref={conversationHost} className='duo-conversation-host' />
        </>}
      />
    </section>
  )
}
