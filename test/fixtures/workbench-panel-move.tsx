import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkbenchPane, type WorkbenchPaneCommands, type WorkbenchPaneConfiguration } from '../../src/features/workbench/workbench-pane'
import { WorkbenchPanelLayer } from '../../src/features/workbench/workbench-panel-layer'
import { createWorkbenchPane, WORKBENCH_FILES_ID, WORKBENCH_GIT_ID, useWorkbenchStore, type WorkbenchPaneId } from '../../src/features/workbench/workbench-state'
import { createWorkbenchLayoutSnapshot, loadWorkbenchLayout } from '../../src/features/workbench/workbench-persistence'
import { useWorkspaceStore } from '../../src/features/workspace/store/use-workspace-store'
import { useSettingsStore } from '../../src/hooks/use-settings-store'
import '../../src/features/layout/components/app-shell/styles.css'
import '../../src/features/workbench/styles.css'

const noop = () => {}
const app = window as any
const test = app.panelTest = { reads: [], history: [], details: [], opens: [] }
const project = (id: string) => ({ id, name: id, path: '/' + id, addedAt: '', lastOpenedAt: '', lastFilePath: null })
const files = (root: string, folder = '') => Array.from({ length: 120 }, (_, i) => ({
  kind: 'file', name: `note-${String(i).padStart(3, '0')}.txt`,
  path: `${root}${folder}/note-${String(i).padStart(3, '0')}.txt`, size: i + 1,
}))
const commits = Array.from({ length: 70 }, (_, i) => ({
  hash: 'hash-' + i, shortHash: 'h' + i, subject: 'Commit ' + i,
  authorName: 'QA', authorEmail: null, authorTimeUnix: 1700000000 - i * 86400,
}))
// The fixture switches projects without changing their directory manifests.
const projectNodes = new Map(['qa', 'other'].map(id => ['/' + id, [
  { kind: 'directory', name: 'folder', path: `/${id}/folder`, hasChildren: true }, ...files('/' + id),
]]))
app.appApi = {
  platform: 'win32', updateWorkspaceState: async () => {},
  loadWorkspaceDirectory: async (root: string, path: string) => { test.reads.push({ root, path }); return files(root, '/folder') },
  getGitCommitHistory: async (root: string) => { test.history.push(root); return { commits, repositoryRootPath: root, workspacePath: root } },
  getGitCommitDetails: async (root: string, hash: string) => {
    test.details.push({ root, hash })
    return { ...commits.find(commit => commit.hash === hash), changes: [{ kind: 'modified', path: root + '/history.txt', relativePath: 'history.txt', originalPath: null, statusCode: 'M' }] }
  },
}
const emptyLayout = () => ({ ratio: .5, focusedPane: 'left' as const, panes: {
  left: { ...createWorkbenchPane(), directoryOpen: false }, right: { ...createWorkbenchPane(), directoryOpen: false },
} })
useWorkbenchStore.getState().switchProject(project('qa'), emptyLayout())
useWorkspaceStore.setState({ currentPath: '/qa', openTabs: [], activeTabId: null })
useWorkbenchStore.getState().open('left', { id: WORKBENCH_FILES_ID, kind: 'panel' })
useWorkbenchStore.getState().open('right', { id: WORKBENCH_GIT_ID, kind: 'panel' })
useWorkbenchStore.getState().open('right', { id: WORKBENCH_FILES_ID, kind: 'panel' })
test.inspect = () => ({ ...useWorkbenchStore.getState(), documents: useWorkspaceStore.getState().openTabs })
test.open = (pane: WorkbenchPaneId, id: string) => useWorkbenchStore.getState().open(pane, { id: id === 'files' ? WORKBENCH_FILES_ID : WORKBENCH_GIT_ID, kind: 'panel' })
test.activate = (pane: WorkbenchPaneId, id: string) => useWorkbenchStore.getState().activate(pane, id === 'files' ? WORKBENCH_FILES_ID : WORKBENCH_GIT_ID)
test.switchProject = (id: string) => {
  const store = useWorkbenchStore.getState()
  store.switchProject(project(id), store.projectLayouts[id] ?? emptyLayout())
  useWorkspaceStore.setState({ currentPath: '/' + id })
}
const openDocument = (path: string, root: string, target: (id: string) => void) => {
  test.opens.push({ path, root })
  useWorkspaceStore.getState().openTab({ filePath: path, workspacePath: root, content: 'fixture', editorKind: 'prose' })
  target(useWorkspaceStore.getState().activeTabId!)
}
function App() {
  const selectedProject = useWorkbenchStore(state => state.project!)
  const root = selectedProject.path
  const commands = useRef<Partial<Record<WorkbenchPaneId, WorkbenchPaneCommands>>>({})
  const editorRef = useRef(null)
  const [commitMessage, setCommitMessage] = useState('')
  const nodes = projectNodes.get(root)!
  const change = { path: root + '/changed.txt', relativePath: 'changed.txt', kind: 'modified', originalPath: null, scope: 'unstaged', statusCode: ' M' }
  const repository = { workspacePath: root, repositoryRootPath: root, isRepository: true, branch: 'main', hasCommits: true,
    hasChanges: true, hasRemote: false, remoteCount: 0, ahead: 0, behind: 0, unpushedCommits: 0,
    recentlyPulledChanges: [], stagedChanges: [], unstagedChanges: [change] }
  const configuration = {
    editor: {
      navigation: {
        activeTab: 'file', treePanel: { expandedPaths: new Set(), nodes: [] },
        gitPanel: { busyLabel: null, commitMessage, historyRefreshVersion: 0, iconTheme: null, isLoading: false,
          layout: 'list', repositoryState: repository, workspacePath: root, onCommitMessageChange: setCommitMessage,
          onCommit: noop, onCommitAndSync: noop, onDiscardAll: noop, onDiscardMany: noop, onInitialize: noop,
          onLayoutChange: noop, onPull: noop, onPush: noop, onRefresh: noop, onRevertCommit: noop, onStage: noop, onUnstage: noop },
      },
      editorContent: { workspacePath: root, meoEditorHostRef: editorRef, fileActions: {} },
      fileTabs: { iconTheme: null, workspacePath: root }, fileSystemPanel: { nodes, workspacePath: root, title: selectedProject.name, iconTheme: null, theme: 'light',
        meoSettings: useSettingsStore.getState().meo, gitRepositoryState: repository },
    },
    conversations: { selectedProject }, onCloseDocument: async () => true, confirmCloseConversation: async () => true,
    refreshGitState: async () => repository,
    documentNavigation: {
      openFile: async (path, root, _mode, target) => openDocument(path, root, target),
      openGitDiff: async (change, _options, target) => openDocument(change.path, root, target),
      openGitCommitFileDiff: async (_hash, change, target) => openDocument(change.path, root, target),
    },
  } as unknown as WorkbenchPaneConfiguration
  return <div className='app-shell' style={{ '--left-panel-toggle-anchor': '6px', '--workbench-left-controls-width': '0px' } as React.CSSProperties}>
    <div className='workbench-panes' style={{ '--workbench-left-ratio': '50%' } as React.CSSProperties}>
      <WorkbenchPane pane='left' configuration={configuration} commands={commands} />
      <div className='workbench-separator' />
      <WorkbenchPane pane='right' configuration={configuration} commands={commands} />
      <WorkbenchPanelLayer configuration={configuration} commands={commands} />
    </div>
  </div>
}
// Exercise identical panel references through the actual restart/restore path.
// Each pane must receive its own instance before the live layer mounts.
void loadWorkbenchLayout(createWorkbenchLayoutSnapshot(useWorkbenchStore.getState(), [], '/qa'), app.appApi, [project('qa')], []).then(restored => {
  useWorkbenchStore.setState({ panes: restored.panes })
  createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
})
