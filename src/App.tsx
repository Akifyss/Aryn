import { useEffect, useMemo, useState } from 'react'
import { Button, ScrollShadow, Separator, Card, Chip } from '@heroui/react'
import { AppTitlebar } from '@/components/app-titlebar'
import { WritingEditor } from '@/features/editor/components/writing-editor'
import { WorkspaceTree } from '@/features/workspace/components/workspace-tree'
import { useWorkspaceStore } from '@/features/workspace/store/use-workspace-store'
import { 
  FolderOpenFill, 
  FileFill, 
  AiLine, 
  CheckCircleFill, 
  InformationLine,
  SaveFill,
  FolderFill
} from '@mingcute/react'
import './App.css'

function getBaseName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

function getRelativePath(rootPath: string, filePath: string) {
  const normalizedRoot = rootPath.replace(/[\\/]+$/, '')
  const normalizedFilePath = filePath.replace(/[\\/]+/g, '/')
  const normalizedRootPath = normalizedRoot.replace(/[\\/]+/g, '/')

  if (!normalizedFilePath.startsWith(normalizedRootPath)) {
    return getBaseName(filePath)
  }

  return normalizedFilePath.slice(normalizedRootPath.length).replace(/^\/+/, '')
}

function getDirectoryRelativePath(rootPath: string, filePath: string) {
  const relativePath = getRelativePath(rootPath, filePath)
  const segments = relativePath.split('/').filter(Boolean)
  segments.pop()
  return segments.join('/')
}

function getNextUntitledFileName(existingNames: string[]) {
  const occupiedNames = new Set(existingNames.map((name) => name.toLowerCase()))

  if (!occupiedNames.has('untitled.md')) {
    return 'untitled.md'
  }

  let index = 2
  while (occupiedNames.has(`untitled-${index}.md`)) {
    index += 1
  }

  return `untitled-${index}.md`
}

function App() {
  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState('Open a folder to start.')
  const [isCreatingFile, setIsCreatingFile] = useState(false)
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
  const rootFileNames = useMemo(
    () => tree.filter((node) => node.kind === 'file').map((node) => node.name),
    [tree],
  )

  async function connectWorkspace(nextPath: string) {
    await window.appApi.stopWorkspaceWatch()
    setCurrentPath(nextPath)
    setCurrentFilePath(null)
    setCurrentFileContent('')
    setDirty(false)
    await loadTree(nextPath)
    await window.appApi.startWorkspaceWatch(nextPath)
  }

  async function loadTree(rootPath: string) {
    const nextTree = await window.appApi.loadWorkspaceTree(rootPath)
    setTree(nextTree)
  }

  async function openFile(filePath: string) {
    const fileContent = await window.appApi.readWorkspaceFile(filePath)
    setCurrentFilePath(filePath)
    setCurrentFileContent(fileContent)
    setDirty(false)
    setStatusMessage(`${filePath.split(/[\\/]/).pop()} opened`)
  }

  async function handlePickWorkspace() {
    setIsPickingWorkspace(true)
    try {
      const nextPath = await window.appApi.pickWorkspace()
      if (nextPath) {
        await connectWorkspace(nextPath)
        setStatusMessage(`Workspace connected`)
      }
    } finally {
      setIsPickingWorkspace(false)
    }
  }

  async function handleCreateFile() {
    if (!currentPath) {
      return
    }

    const nextRelativePath = getNextUntitledFileName(rootFileNames)

    try {
      setIsCreatingFile(true)
      const { filePath } = await window.appApi.createWorkspaceFile(currentPath, nextRelativePath)
      await loadTree(currentPath)
      await openFile(filePath)
      setStatusMessage(`${nextRelativePath} created`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create file.'
      setStatusMessage(message)
    } finally {
      setIsCreatingFile(false)
    }
  }

  async function handleRenameFile(filePath: string, nextName: string) {
    if (!currentPath) {
      throw new Error('Open a workspace first.')
    }

    const trimmedName = nextName.trim()
    if (!trimmedName) {
      throw new Error('File name is required.')
    }

    const nextBaseName = /\.[a-z0-9]+$/i.test(trimmedName) ? trimmedName : `${trimmedName}.md`
    const parentDirectory = getDirectoryRelativePath(currentPath, filePath)
    const nextRelativePath = parentDirectory ? `${parentDirectory}/${nextBaseName}` : nextBaseName

    const { filePath: nextFilePath } = await window.appApi.renameWorkspaceFile(currentPath, filePath, nextRelativePath)
    await loadTree(currentPath)

    if (currentFilePath === filePath) {
      setCurrentFilePath(nextFilePath)
    }

    setStatusMessage(`${nextBaseName} renamed`)
  }

  async function handleDeleteFile(filePath: string) {
    if (!currentPath) {
      throw new Error('Open a workspace first.')
    }

    await window.appApi.deleteWorkspaceFile(currentPath, filePath)
    await loadTree(currentPath)

    if (currentFilePath === filePath) {
      setCurrentFilePath(null)
      setCurrentFileContent('')
      setDirty(false)
    }

    setStatusMessage(`${getBaseName(filePath)} deleted`)
  }

  async function handleSave() {
    if (!currentFilePath) return
    setIsSaving(true)
    try {
      await window.appApi.saveWorkspaceFile(currentFilePath, currentFileContent)
      setDirty(false)
      setStatusMessage('Changes saved')
      if (currentPath) await loadTree(currentPath)
    } finally {
      setIsSaving(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const lastWorkspacePath = await window.appApi.getLastWorkspace()

      if (!lastWorkspacePath || cancelled) {
        return
      }

      try {
        await connectWorkspace(lastWorkspacePath)
        if (!cancelled) {
          setStatusMessage('Last workspace restored')
        }
      } catch {
        if (!cancelled) {
          setStatusMessage('Open a folder to start.')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.appApi.onWorkspaceChanged(async (event) => {
      if (!currentPath || event.rootPath !== currentPath) return
      await loadTree(currentPath)
      if (currentFilePath === event.path && !isDirty && event.type === 'change') {
        const updatedContent = await window.appApi.readWorkspaceFile(event.path)
        setCurrentFileContent(updatedContent)
        setStatusMessage(`Synced with external edits`)
        return
      }
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
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [currentFileContent, currentFilePath])

  return (
    <div className='app-shell'>
      <AppTitlebar />

      <aside className='panel panel-sidebar'>
        <div className='panel-header'>
          <p className='eyebrow'>Workspace</p>
          <h1>Drafts</h1>
        </div>

        <Button
          variant='primary'
          onPress={handlePickWorkspace}
          isDisabled={isPickingWorkspace}
          className="font-medium"
        >
          {isPickingWorkspace ? (
            <div className="animate-spin mr-2 h-4 w-4 border-2 border-white/20 border-t-white rounded-full" />
          ) : (
            <FolderOpenFill className="mr-2" size={16} />
          )}
          {isPickingWorkspace ? 'Opening...' : 'Open Folder'}
        </Button>

        <Button
          variant='secondary'
          onPress={() => {
            void handleCreateFile()
          }}
          isDisabled={!currentPath || isCreatingFile}
          className="font-medium"
        >
          <FileFill className="mr-2" size={16} />
          {isCreatingFile ? 'Creating...' : 'New File'}
        </Button>

        <Card className="bg-slate-50/50 border border-slate-100 shadow-none">
          <Card.Content className="p-3">
            <div className='label flex items-center gap-1.5 mb-1'>
              <FolderFill size={12} />
              <span>Current Path</span>
            </div>
            <p className='meta-path'>{currentPath ?? 'Not selected'}</p>
          </Card.Content>
        </Card>

        <Separator className="my-2" />

        <div className='section-title flex items-center gap-2'>
          <FileFill size={14} className="text-slate-400" />
          <span>Explorer</span>
        </div>
        
        <ScrollShadow className='tree-scroll' hideScrollBar>
          <WorkspaceTree
            activeFilePath={currentFilePath}
            nodes={tree}
            onSelectFile={(filePath) => {
              void openFile(filePath)
            }}
            onRenameFile={(filePath, nextName) => handleRenameFile(filePath, nextName)}
            onDeleteFile={(filePath) => handleDeleteFile(filePath)}
          />
        </ScrollShadow>
      </aside>

      <main className='panel panel-editor'>
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
          <p className='eyebrow'>Assistant</p>
          <h2>AWA Intelligence</h2>
          <p className='agent-subtitle'>Writing support and context-aware insights.</p>
        </div>

        <Card className="border-none bg-gradient-to-br from-blue-50 to-indigo-50 shadow-sm">
          <Card.Content className="p-4 gap-4">
            <div className='agent-stat'>
              <div className='label flex items-center gap-1.5'>
                <InformationLine size={12} />
                <span>Status</span>
              </div>
              <strong className="text-blue-700">{statusMessage}</strong>
            </div>
            
            <div className='agent-stat'>
              <div className='label flex items-center gap-1.5'>
                <FileFill size={12} />
                <span>Active Document</span>
              </div>
              <strong className="truncate block" title={currentFilePath ?? ''}>
                {currentFilePath ? currentFilePath.split(/[\\/]/).pop() : 'None selected'}
              </strong>
            </div>

            <div className='agent-stat'>
              <div className='label flex items-center gap-1.5'>
                <SaveFill size={12} />
                <span>Save State</span>
              </div>
              {isDirty ? (
                <Chip size="sm" variant="soft" color="warning">Unsaved Changes</Chip>
              ) : (
                <Chip size="sm" variant="soft" color="success">
                  <div className="flex items-center gap-1">
                    <CheckCircleFill size={12} />
                    <span>Up to date</span>
                  </div>
                </Chip>
              )}
            </div>
          </Card.Content>
        </Card>

        <div className='agent-actions flex flex-col gap-2'>
          <Button variant='primary' className="w-full font-semibold shadow-md shadow-blue-200">
            <AiLine className="mr-2" size={16} />
            Ask AWA Agent
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1 text-xs px-0" size="sm">Insight</Button>
            <Button variant="secondary" className="flex-1 text-xs px-0" size="sm">Outline</Button>
          </div>
        </div>
      </aside>
    </div>
  )
}

export default App
