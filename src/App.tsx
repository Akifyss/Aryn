import { useEffect, useMemo, useState } from 'react'
import { Button, Chip, ScrollShadow, Separator } from '@heroui/react'
import { AppTitlebar } from '@/components/app-titlebar'
import { WritingEditor } from '@/features/editor/components/writing-editor'
import { WorkspaceTree } from '@/features/workspace/components/workspace-tree'
import { useWorkspaceStore } from '@/features/workspace/store/use-workspace-store'
import './App.css'

function App() {
  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState('Open a folder to start.')
  const currentPath = useWorkspaceStore((state) => state.currentPath)
  const currentFileContent = useWorkspaceStore((state) => state.currentFileContent)
  const currentFilePath = useWorkspaceStore((state) => state.currentFilePath)
  const isDirty = useWorkspaceStore((state) => state.isDirty)
  const setCurrentFileContent = useWorkspaceStore((state) => state.setCurrentFileContent)
  const setCurrentFilePath = useWorkspaceStore((state) => state.setCurrentFilePath)
  const setCurrentPath = useWorkspaceStore((state) => state.setCurrentPath)
  const setDirty = useWorkspaceStore((state) => state.setDirty)
  const setTree = useWorkspaceStore((state) => state.setTree)
  const tree = useWorkspaceStore((state) => state.tree)

  const currentFileName = useMemo(() => {
    if (!currentFilePath) {
      return 'Draft'
    }

    return currentFilePath.split(/[\\/]/).pop() ?? currentFilePath
  }, [currentFilePath])

  async function loadTree(rootPath: string) {
    const nextTree = await window.appApi.loadWorkspaceTree(rootPath)
    setTree(nextTree)
  }

  async function openFile(filePath: string) {
    const fileContent = await window.appApi.readWorkspaceFile(filePath)
    setCurrentFilePath(filePath)
    setCurrentFileContent(fileContent)
    setDirty(false)
    setStatusMessage(`Opened ${filePath}`)
  }

  async function handlePickWorkspace() {
    setIsPickingWorkspace(true)

    try {
      const nextPath = await window.appApi.pickWorkspace()
      if (nextPath) {
        await window.appApi.stopWorkspaceWatch()
        setCurrentPath(nextPath)
        setCurrentFilePath(null)
        setCurrentFileContent('')
        setDirty(false)
        await loadTree(nextPath)
        await window.appApi.startWorkspaceWatch(nextPath)
        setStatusMessage(`Workspace ready: ${nextPath}`)
      }
    } finally {
      setIsPickingWorkspace(false)
    }
  }

  async function handleSave() {
    if (!currentFilePath) {
      return
    }

    setIsSaving(true)

    try {
      await window.appApi.saveWorkspaceFile(currentFilePath, currentFileContent)
      setDirty(false)
      setStatusMessage(`Saved ${currentFilePath}`)
      if (currentPath) {
        await loadTree(currentPath)
      }
    } finally {
      setIsSaving(false)
    }
  }

  useEffect(() => {
    const unsubscribe = window.appApi.onWorkspaceChanged(async (event) => {
      if (!currentPath || event.rootPath !== currentPath) {
        return
      }

      await loadTree(currentPath)

      if (currentFilePath === event.path && !isDirty && event.type === 'change') {
        const updatedContent = await window.appApi.readWorkspaceFile(event.path)
        setCurrentFileContent(updatedContent)
        setStatusMessage(`Reloaded ${event.path} after external change`)
        return
      }

      setStatusMessage(`Workspace changed: ${event.type}`)
    })

    return unsubscribe
  }, [currentFilePath, currentPath, isDirty, setCurrentFileContent, setTree])

  useEffect(() => {
    return () => {
      void window.appApi.stopWorkspaceWatch()
    }
  }, [])

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void handleSave()
      }
    }

    window.addEventListener('keydown', handleKeydown)

    return () => {
      window.removeEventListener('keydown', handleKeydown)
    }
  }, [currentFileContent, currentFilePath])

  return (
    <div className='app-shell'>
      <AppTitlebar />

      <aside className='panel panel-sidebar'>
        <div className='panel-header'>
          <div>
            <p className='eyebrow'>Workspace</p>
            <h1>AWA</h1>
          </div>
        </div>

        <div className='toolbar-row'>
          <Button
            size='sm'
            variant='primary'
            onPress={handlePickWorkspace}
            isDisabled={isPickingWorkspace}
          >
            {isPickingWorkspace ? 'Opening...' : 'Open Folder'}
          </Button>
        </div>

        <div className='workspace-meta'>
          <span className='label'>Current folder</span>
          <strong className='meta-path'>{currentPath ?? 'No folder selected yet'}</strong>
        </div>

        <Separator className='panel-divider' />

        <div className='section-title'>Workspace</div>
        <ScrollShadow className='tree-scroll' hideScrollBar>
          <WorkspaceTree
            activeFilePath={currentFilePath}
            nodes={tree}
            onSelectFile={(filePath) => {
              void openFile(filePath)
            }}
          />
        </ScrollShadow>
      </aside>

      <main className='panel panel-editor'>
        <div className='panel-header panel-header-inline'>
          <div className='editor-heading'>
            <p className='eyebrow'>Editor</p>
            <h2>{currentFileName}</h2>
            <p className='editor-subtitle'>
              {currentPath ? 'Focused drafting environment' : 'Open a workspace to begin writing'}
            </p>
          </div>
          <div className='toolbar-row'>
            <Chip className='status-pill' color='accent' variant='soft'>
              {isDirty ? 'Unsaved' : 'Saved'}
            </Chip>
            <Button
              size='sm'
              isDisabled={!currentFilePath || !isDirty || isSaving}
              onPress={handleSave}
              variant='secondary'
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>

        <Separator className='panel-divider' />

        <div className='editor-frame'>
          <WritingEditor
            disabled={!currentFilePath}
            onChange={(nextValue) => {
              setCurrentFileContent(nextValue)
              setDirty(true)
            }}
            value={currentFileContent}
          />
        </div>
      </main>

      <aside className='panel panel-agent'>
        <div className='panel-header'>
          <div className='agent-heading'>
            <p className='eyebrow'>Agent</p>
            <h2>Writing Assistant</h2>
            <p className='agent-subtitle'>AI support, kept secondary to the draft.</p>
          </div>
        </div>

        <Separator className='panel-divider' />

        <div className='agent-block'>
          <div className='agent-status-grid'>
            <div className='agent-stat'>
              <span className='label'>Status</span>
              <strong>{statusMessage}</strong>
            </div>
            <div className='agent-stat'>
              <span className='label'>Active file</span>
              <strong>{currentFilePath ?? 'No file selected'}</strong>
            </div>
            <div className='agent-stat'>
              <span className='label'>Save state</span>
              <strong>{isSaving ? 'Saving now' : isDirty ? 'Pending changes' : 'Clean'}</strong>
            </div>
            <div className='agent-stat'>
              <span className='label'>Workspace</span>
              <strong>{currentPath ?? 'Not connected'}</strong>
            </div>
          </div>
          <div className='toolbar-row agent-actions'>
            <Button size='sm' variant='secondary'>Ask Agent</Button>
            <Button size='sm' variant='ghost'>Summarize</Button>
          </div>
        </div>
      </aside>
    </div>
  )
}

export default App
