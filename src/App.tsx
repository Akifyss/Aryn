import { useEffect, useMemo, useState } from 'react'
import { Button, Chip, ScrollShadow, Separator } from '@heroui/react'
import {
  FolderFill,
  FolderOpenFill,
  FileFill,
  SaveFill,
} from '@mingcute/react'
import { AppTitlebar } from '@/components/app-titlebar'
import { WritingEditor } from '@/features/editor/components/writing-editor'
import { WorkspaceTree } from '@/features/workspace/components/workspace-tree'
import { useWorkspaceStore } from '@/features/workspace/store/use-workspace-store'
import type { WorkspaceNode } from '@/features/workspace/types'
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

function countTree(nodes: WorkspaceNode[]) {
  let fileCount = 0
  let directoryCount = 0

  function visit(branch: WorkspaceNode[]) {
    branch.forEach((node) => {
      if (node.kind === 'file') {
        fileCount += 1
        return
      }

      directoryCount += 1
      if (node.children?.length) {
        visit(node.children)
      }
    })
  }

  visit(nodes)

  return { directoryCount, fileCount }
}

function App() {
  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [, setStatusMessage] = useState('Open a folder to start.')
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
  const treeCounts = useMemo(() => countTree(tree), [tree])
  const workspaceName = currentPath ? getBaseName(currentPath) : null

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
        setStatusMessage('Workspace connected')
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
    if (!currentFilePath) {
      return
    }

    setIsSaving(true)
    try {
      await window.appApi.saveWorkspaceFile(currentFilePath, currentFileContent)
      setDirty(false)
      setStatusMessage('Changes saved')
      if (currentPath) {
        await loadTree(currentPath)
      }
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
      if (!currentPath || event.rootPath !== currentPath) {
        return
      }

      await loadTree(currentPath)

      if (currentFilePath === event.path && !isDirty && event.type === 'change') {
        const updatedContent = await window.appApi.readWorkspaceFile(event.path)
        setCurrentFileContent(updatedContent)
        setStatusMessage('Synced with external edits')
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
      <a className='skip-link' href='#editor-main'>
        Skip to editor
      </a>

      <div className='app-orb app-orb-left' aria-hidden='true' />
      <div className='app-orb app-orb-right' aria-hidden='true' />

      <AppTitlebar />

      <aside className='panel panel-sidebar'>
        <div className='sidebar-actions'>
          <Button
            variant='primary'
            onPress={handlePickWorkspace}
            isDisabled={isPickingWorkspace}
            className='workspace-primary-action'
          >
            <FolderOpenFill className='mr-2' size={16} />
            {isPickingWorkspace ? 'Opening...' : 'Open Folder'}
          </Button>

          <Button
            variant='outline'
            onPress={() => {
              void handleCreateFile()
            }}
            isDisabled={!currentPath || isCreatingFile}
            className='workspace-secondary-action'
          >
            <FileFill className='mr-2' size={16} />
            {isCreatingFile ? 'Creating...' : 'New File'}
          </Button>

          <Button
            variant='secondary'
            onPress={() => {
              void handleSave()
            }}
            isDisabled={!currentFilePath || !isDirty || isSaving}
            className='save-action'
          >
            <SaveFill className='mr-2' size={16} />
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>

        <div className='workspace-inline-meta'>
          <div className='workspace-inline-title'>
            <span className='workspace-name'>{workspaceName ?? 'No workspace selected'}</span>
            <Chip
              className='workspace-chip'
              color={currentPath ? 'success' : 'default'}
              size='sm'
              variant='soft'
            >
              {currentPath ? 'Connected' : 'Waiting'}
            </Chip>
          </div>
        </div>

        <Separator className='section-separator' />

        <div className='section-title'>
          <div className='label label-with-icon'>
            <FileFill size={14} />
            <span>Explorer</span>
          </div>
          <span className='section-count'>{treeCounts.fileCount}</span>
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

      <main className='panel panel-editor' id='editor-main'>
        <div className='editor-frame'>
          {!currentFilePath ? (
            <div className='editor-empty-state'>
              <div className='editor-empty-content'>
                <div className='editor-empty-icon'>
                  <FileFill size={24} />
                </div>
                <div className='editor-empty-copy'>
                  <h3>Writing starts with a file.</h3>
                  <p>
                    Connect a workspace, then create or open a markdown file.
                  </p>
                </div>
                <div className='editor-empty-actions'>
                  <Button variant='primary' onPress={handlePickWorkspace} isDisabled={isPickingWorkspace}>
                    <FolderOpenFill className='mr-2' size={16} />
                    Open Folder
                  </Button>
                  <Button
                    variant='outline'
                    onPress={() => {
                      void handleCreateFile()
                    }}
                    isDisabled={!currentPath || isCreatingFile}
                  >
                    <FileFill className='mr-2' size={16} />
                    Create Draft
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

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
        <div className='agent-empty-shell' />
      </aside>
    </div>
  )
}

export default App
