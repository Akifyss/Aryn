import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DuoPane } from '@/features/duo/duo-pane'
import { DuoPanelLayer } from '@/features/duo/duo-panel-layer'
import { useDuoStore, createDuoPane } from '@/features/duo/duo-state'
import { captureDuoDocumentTarget } from '@/features/duo/duo-document-navigation'
import { useWorkspaceDocumentNavigation } from '@/features/workspace/hooks/use-workspace-document-navigation'
import { useWorkspaceStore } from '@/features/workspace/store/use-workspace-store'
import '@/features/layout/components/app-shell/styles.css'
import '@/features/duo/styles.css'

const noop = () => {}
const reads: string[] = []
const actions: { kind: string; paths: string[] }[] = []
const project = { id: 'qa', name: 'QA', path: '/qa', addedAt: '', lastOpenedAt: '', lastFilePath: null }
const change = (name, scope = 'unstaged', kind = 'modified') => ({
  path: `/qa/${name}`, relativePath: name, scope, kind, originalPath: null, statusCode: 'M',
})
const commit = { hash: 'abcdef123', shortHash: 'abcdef1', subject: '测试提交', authorName: 'QA', authorEmail: null, authorTimeUnix: 1700000000 }
const { scope: _, ...commitChange } = change('history.md')
const repository = {
  isRepository: true, workspacePath: '/qa', repositoryRootPath: '/qa', branch: 'main',
  hasChanges: true, hasCommits: true, hasRemote: false, remoteCount: 0,
  ahead: 0, behind: 0, unpushedCommits: 0, recentlyPulledChanges: [],
  stagedChanges: [change('staged.md', 'staged')],
  unstagedChanges: [change('unstaged.md'), change('deleted.md', 'unstaged', 'deleted')],
}
const diff = (name, scope, source) => ({
  change: change(name, scope), editorKind: 'prose', originalContent: 'before', modifiedContent: 'after',
  originalExists: true, modifiedExists: !name.endsWith('deleted.md'), originalLabel: 'before', modifiedLabel: 'after',
  repositoryRootPath: '/qa', selections: [], source,
})
window.appApi = {
  platform: 'win32',
  resolveWorkspaceEditorKind: async () => 'prose',
  readWorkspaceFile: async (path: string) => { reads.push(path); return '# Fixture file' },
  updateWorkspaceState: async () => {},
  getGitCommitHistory: async () => ({ commits: [commit], repositoryRootPath: '/qa' }),
  getGitCommitDetails: async () => ({ ...commit, changes: [commitChange] }),
  getGitFileDiff: async (_, path, scope) => {
    reads.push(`${scope}:${path}`)
    return diff(path.split('/').pop(), scope, { kind: 'working-tree' })
  },
  getGitCommitFileDiff: async (_, hash, path) => {
    reads.push(`${hash}:${path}`)
    return diff(path.split('/').pop(), 'staged', { kind: 'commit', commit, parentHash: null, parentShortHash: null })
  },
}
useWorkspaceStore.setState({ currentPath: '/qa', openTabs: [], activeTabId: null })
Object.assign(window, { getTreeFixtureState: () => ({
  focusedPane: useDuoStore.getState().focusedPane,
  panes: useDuoStore.getState().panes,
  documents: useWorkspaceStore.getState().openTabs,
  reads,
  actions,
}) })
const options = window.fixtureOptions
const nodes = ['.agents', '.codex', '.idea', '.obsidian', '.thinkrail', 'proto', 'specs']
  .map(name => ({ kind: 'directory', name, path: '/qa/' + name,
    children: [{ kind: 'file', name: 'child.md', path: '/qa/' + name + '/child.md' }] }))
  .concat(Array.from({ length: options.fileCount }, (_, i) => ({
    kind: 'file', name: 'file-' + i + '.md', path: '/qa/file-' + i + '.md',
  })))
useDuoStore.setState({ project, panes: { left: createDuoPane(), right: createDuoPane() } })
function App() {
  const commands = useRef({})
  const editorRef = useRef(null)
  const documentNavigation = useWorkspaceDocumentNavigation({
    captureDocumentTarget: captureDuoDocumentTarget,
    captureActiveMeoViewPosition: noop, closeLeftDrawer: noop, closeRightDrawer: noop,
    currentPath: '/qa', displayActiveTabId: null, displayTabs: [], expandAgentEditorSurface: noop,
    flushWorkspaceAutosave: async () => true, isActiveEditorComposing: false,
    isLeftSidebarDrawer: false, isRightSidebarDrawer: false,
    setActiveAgentLayoutFixedTab: noop, setIsAgentLayoutFixedTabActive: noop, setStatusMessage: noop,
  })
  const [visible, setVisible] = useState(!options.initiallyHidden)
  window.setFixtureVisible = setVisible
  const configuration = {
    editor: {
      navigation: {
        activeTab: 'file', activeTreePath: null, onOpenFile: noop, onReplaceActiveFile: noop,
        treePanel: { expandedPaths: new Set(), nodes, workspacePath: '/qa', iconTheme: null,
          onCreateFile: noop, onCreateDirectory: noop, onDeleteNode: noop,
          onMoveNode: noop, onRenameNode: noop },
        gitPanel: {
          busyLabel: null, commitMessage: '', historyRefreshVersion: 0, iconTheme: null, isLoading: false,
          layout: options.gitLayout ?? 'list', repositoryState: repository, workspacePath: '/qa',
          onCommit: noop, onCommitAndSync: noop, onCommitMessageChange: noop, onDiscardAll: noop,
          onDiscardMany: (changes) => actions.push({ kind: 'discard', paths: changes.map((change) => change.path) }),
          onInitialize: noop, onLayoutChange: noop, onPull: noop, onPush: noop, onRefresh: noop, onRevertCommit: noop,
          onStage: (paths) => actions.push({ kind: 'stage', paths }),
          onUnstage: (paths) => actions.push({ kind: 'unstage', paths }),
        },
      },
      editorContent: { workspacePath: '/qa', meoEditorHostRef: editorRef, fileActions: {} },
      fileTabs: { iconTheme: null, workspacePath: '/qa' }, fileSystemPanel: {}, emptyState: {},
    },
    conversations: { selectedProject: project }, documentNavigation,
    refreshGitState: noop, onCloseDocument: async () => true, confirmCloseConversation: async () => true,
  }
  // Match App.tsx: initialized Duo panes stay mounted while another layout is active.
  return <div hidden={!visible} inert={!visible ? true : undefined}>
    <div className='app-shell duo-shell' data-app-layout='duo'>
      <div className='duo-panes' style={{ '--duo-left-ratio': '50%' }}>
        <DuoPane pane='left' configuration={configuration} commands={commands} isActive={visible} />
        <div className='duo-separator' />
        <DuoPane pane='right' configuration={configuration} commands={commands} isActive={visible} />
        <DuoPanelLayer configuration={configuration} commands={commands} />
      </div>
    </div>
  </div>
}
createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)
