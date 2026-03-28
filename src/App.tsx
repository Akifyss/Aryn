import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Chip, Separator } from '@heroui/react'
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
      <aside className='panel panel-sidebar'>
        <div className='panel-header'>
          <div>
            <p className='eyebrow'>Workspace</p>
            <h1>AWA</h1>
          </div>
          <Button
            variant='primary'
            onPress={handlePickWorkspace}
            isDisabled={isPickingWorkspace}
          >
            {isPickingWorkspace ? 'Opening...' : 'Open Folder'}
          </Button>
        </div>

        <Card className='workspace-card'>
          <Card.Content>
            <span className='label'>Current folder</span>
            <strong>{currentPath ?? 'No folder selected yet'}</strong>
          </Card.Content>
        </Card>

        <Card className='panel-section'>
          <Card.Content>
            <span className='label'>Files</span>
            <WorkspaceTree
              activeFilePath={currentFilePath}
              nodes={tree}
              onSelectFile={(filePath) => {
                void openFile(filePath)
              }}
            />
          </Card.Content>
        </Card>
      </aside>

      <main className='panel panel-editor'>
        <div className='panel-header panel-header-inline'>
          <div>
            <p className='eyebrow'>Editor</p>
            <h2>{currentFileName}</h2>
          </div>
          <Chip className='status-pill' color='accent' variant='soft'>
            {isDirty ? 'Unsaved' : 'Saved'}
          </Chip>
        </div>

        <Separator className='panel-divider' />

        <WritingEditor
          disabled={!currentFilePath}
          onChange={(nextValue) => {
            setCurrentFileContent(nextValue)
            setDirty(true)
          }}
          value={currentFileContent}
        />
      </main>

      <aside className='panel panel-agent'>
        <div className='panel-header'>
          <div>
            <p className='eyebrow'>Agent</p>
            <h2>Assistant Panel</h2>
          </div>
        </div>

        <Card className='agent-card'>
          <Card.Content>
            <h3>Workspace status</h3>
            <ul>
              <li>{statusMessage}</li>
              <li>{currentFilePath ?? 'No active file'}</li>
              <li>{isSaving ? 'Saving file...' : 'Save ready'}</li>
              <li>{currentPath ?? 'No workspace selected'}</li>
            </ul>
            <Button
              className='save-button'
              isDisabled={!currentFilePath || !isDirty || isSaving}
              onPress={handleSave}
              variant='secondary'
            >
              {isSaving ? 'Saving...' : 'Save File'}
            </Button>
          </Card.Content>
        </Card>
      </aside>
    </div>
  )
}

export default App
