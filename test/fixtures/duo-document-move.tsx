import React, { useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { EditorView } from '@codemirror/view'
import * as monaco from 'monaco-editor'
import { Editor as DiffEditor } from '@pierre/diffs/edit'
import { DuoPane, type DuoPaneConfiguration, type DuoPaneCommands } from '../../src/features/duo/duo-pane'
import { DuoPanelLayer } from '../../src/features/duo/duo-panel-layer'
import { createDuoPane, DUO_FILES_ID, useDuoStore } from '../../src/features/duo/duo-state'
import { captureDuoDocumentTarget } from '../../src/features/duo/duo-document-navigation'
import { useWorkspaceStore } from '../../src/features/workspace/store/use-workspace-store'
import { useSettingsStore } from '../../src/hooks/use-settings-store'
import { initializeMeoStoredStates } from '../../src/features/editor/lib/meo-state'
import { createDiffTab } from '../../src/features/workspace/lib/workspace-tabs'
import '../../src/index.css'
import '../../src/features/layout/components/app-shell/styles.css'
import '../../src/features/duo/styles.css'

const app = window as any
// Observe the actual editor created by Pierre's React surface, without mocking it.
app.diffEditors = new Set<DiffEditor<undefined>>()
const edit = DiffEditor.prototype.edit
DiffEditor.prototype.edit = function (...args) {
  const detach = edit.apply(this, args)
  app.diffEditors.add(this)
  return () => { app.diffEditors.delete(this); detach() }
}
const noop = () => {}
app.appApi = {
  getGitBaseline: async () => ({ kind: 'unavailable', reason: 'not-repo' }),
  updateMeoFileState: async () => {}, workspaceFileExists: async () => false,
  updateWorkspaceState: async () => {},
}
app.closeCalls = 0
let scenario = 0
app.setup = (kind = 'meo', duplicate = false) => {
  const filePath = `/qa/note-${++scenario}.${kind === 'code' || kind === 'diff' || kind === 'history' ? 'txt' : 'md'}`
  initializeMeoStoredStates(kind === 'meo-diff' ? { [filePath]: { mode: 'diff-unified' } } : {})
  useDuoStore.setState({ ...useDuoStore.getInitialState(), initialized: true,
    panes: { left: { ...createDuoPane(), directoryOpen: false }, right: { ...createDuoPane(), directoryOpen: false } } })
  useWorkspaceStore.setState({ currentPath: '/qa', openTabs: [], activeTabId: null })
  const content = Array.from({ length: 170 }, (_, n) => `Line ${n} with enough text to scroll.`).join('\n')
  if (kind === 'diff' || kind === 'history') {
    useWorkspaceStore.getState().openDiffTab(createDiffTab({
      change: { kind: 'modified', path: filePath, relativePath: filePath.slice(4), originalPath: null, scope: 'unstaged', statusCode: ' M' },
      editorKind: 'code', originalContent: content.replaceAll('Line', 'Before'), modifiedContent: content,
      originalExists: true, modifiedExists: true, originalLabel: 'Before', modifiedLabel: 'After',
      repositoryRootPath: '/qa', selections: [], source: kind === 'history'
        ? { kind: 'commit', commit: { hash: 'abc123', shortHash: 'abc123', subject: 'Historical version', authorName: 'QA', authorEmail: '', authorTimeUnix: 1700000000 } }
        : { kind: 'working-tree' }, presentation: { kind: 'text' },
    }))
  } else {
    useWorkspaceStore.getState().openTab({ filePath,
      workspacePath: '/qa', content, editorKind: kind === 'code' ? 'code' : 'prose', viewMode: kind === 'code' ? 'code' : 'meo' })
  }
  const tab = useWorkspaceStore.getState().openTabs[0]
  app.docId = tab.id
  useDuoStore.getState().open('left', { kind: 'document', id: tab.id })
  useDuoStore.getState().open('right', { kind: 'panel', id: DUO_FILES_ID })
  if (duplicate) useDuoStore.getState().open('right', { kind: 'document', id: tab.id })
}
app.inspect = () => ({ ...useDuoStore.getState(), documents: useWorkspaceStore.getState().openTabs })
app.staleRequests = () => {
  app.lateLeft = captureDuoDocumentTarget('left')
  app.lateRight = captureDuoDocumentTarget('right')
}
app.cm = (side: string) => {
  const element = Array.from(document.querySelectorAll<HTMLElement>(`#duo-${side} .cm-editor`))
    .find(node => node.getBoundingClientRect().width > 0 && node.querySelector('[contenteditable="true"]'))
  return element ? EditorView.findFromDOM(element) : null
}
app.code = (side: string) => monaco.editor.getEditors().find(editor => editor.getDomNode()?.closest(`#duo-${side}`))
app.diff = () => Array.from(app.diffEditors)[0]
app.moveNow = (side: 'left' | 'right') => flushSync(() => {
  document.querySelector<HTMLButtonElement>(`#duo-${side} .file-tab.is-active .file-tab-move`)!.click()
})
app.cmSnapshot = (side: string) => {
  const view = app.cm(side)
  return { ranges: view.state.selection.toJSON(), scrollTop: view.scrollDOM.scrollTop }
}
app.setup()
function App() {
  const commands = useRef<Partial<Record<'left' | 'right', DuoPaneCommands>>>({})
  const editorRef = useRef(null)
  const configuration = {
    editor: {
      navigation: { activeTab: 'file', treePanel: { expandedPaths: new Set(), nodes: [] }, gitPanel: {} },
      editorContent: { workspacePath: '/qa', meoEditorHostRef: editorRef,
        fileActions: { compositionChange: noop, saveFile: noop }, diffActions: {},
        meoSettings: useSettingsStore.getState().meo, theme: 'light' },
      fileTabs: { iconTheme: null, workspacePath: '/qa' }, fileSystemPanel: {}, emptyState: {},
    }, conversations: {}, documentNavigation: {}, refreshGitState: noop,
    onCloseDocument: async () => { app.closeCalls++; return false }, confirmCloseConversation: async () => true,
  } as unknown as DuoPaneConfiguration
  return <div className='app-shell duo-shell' data-app-layout='duo' style={{ '--left-panel-toggle-anchor': '6px' } as React.CSSProperties}>
    <div className='duo-panes' style={{ '--duo-left-ratio': '50%' } as React.CSSProperties}>
      <DuoPane pane='left' configuration={configuration} commands={commands} isActive />
      <div className='duo-separator' />
      <DuoPane pane='right' configuration={configuration} commands={commands} isActive />
      <DuoPanelLayer configuration={configuration} commands={commands} />
    </div>
  </div>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
