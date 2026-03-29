import { useEffect, useMemo, useState } from 'react'
import { Button, ScrollShadow } from '@heroui/react'
import {
  AddLine,
  FileFill,
  FolderOpenFill,
  SelectorVerticalLine,
} from '@mingcute/react'
import { AppTitlebar } from '@/components/app-titlebar'
import { AgentSidebar } from '@/features/agent/components/agent-sidebar'
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

function App() {
  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false)
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
  const workspaceLabel = currentPath
    ? getBaseName(currentPath)
    : '\u5f53\u524d\u5de5\u4f5c\u533a'

  async function getWorkspaceState(workspacePath: string) {
    return window.appApi.getWorkspaceState(workspacePath)
  }

  async function updateWorkspaceState(
    workspacePath: string,
    patch: { lastFilePath?: string | null, lastAgentSessionPath?: string | null, markAsLastOpened?: boolean },
  ) {
    await window.appApi.updateWorkspaceState(workspacePath, patch)
  }

  async function connectWorkspace(nextPath: string) {
    await window.appApi.stopWorkspaceWatch()
    await loadTree(nextPath)
    setCurrentPath(nextPath)
    setCurrentFilePath(null)
    setCurrentFileContent('')
    setDirty(false)
    await window.appApi.startWorkspaceWatch(nextPath)
    await updateWorkspaceState(nextPath, { markAsLastOpened: true })
  }

  async function loadTree(rootPath: string) {
    const nextTree = await window.appApi.loadWorkspaceTree(rootPath)
    setTree(nextTree)
  }

  async function openFile(filePath: string, workspacePath: string | null = currentPath) {
    const fileContent = await window.appApi.readWorkspaceFile(filePath)
    setCurrentFilePath(filePath)
    setCurrentFileContent(fileContent)
    setDirty(false)

    if (workspacePath) {
      await updateWorkspaceState(workspacePath, { lastFilePath: filePath })
    }

    setStatusMessage(`${filePath.split(/[\\/]/).pop()} opened`)
  }

  async function restoreWorkspaceFile(workspacePath: string, fallbackFilePath?: string | null) {
    const workspaceState = await getWorkspaceState(workspacePath)
    const filePath = fallbackFilePath ?? workspaceState.lastFilePath

    if (!filePath) {
      return
    }

    await openFile(filePath, workspacePath).catch(() => undefined)
  }

  async function handlePickWorkspace() {
    setIsPickingWorkspace(true)
    try {
      const nextPath = await window.appApi.pickWorkspace()
      if (nextPath) {
        await connectWorkspace(nextPath)
        await restoreWorkspaceFile(nextPath)
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
      await updateWorkspaceState(currentPath, { lastFilePath: nextFilePath })
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
      await updateWorkspaceState(currentPath, { lastFilePath: null })
    }

    setStatusMessage(`${getBaseName(filePath)} deleted`)
  }

  async function handleSave() {
    if (!currentFilePath) {
      return
    }

    await window.appApi.saveWorkspaceFile(currentFilePath, currentFileContent)
    setDirty(false)
    setStatusMessage('Changes saved')
    if (currentPath) {
      await loadTree(currentPath)
    }
  }

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const restoreState = await window.appApi.getWorkspaceRestoreState()
      const lastWorkspacePath = restoreState.workspacePath

      if (!lastWorkspacePath || cancelled) {
        return
      }

      try {
        await connectWorkspace(lastWorkspacePath)
        if (!cancelled) {
          await restoreWorkspaceFile(lastWorkspacePath, restoreState.filePath)
        }

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

      if (currentFilePath === event.path && event.type === 'unlink') {
        if (isDirty) {
          setStatusMessage('Open file was removed externally. Save now to recreate it.')
          return
        }

        setCurrentFilePath(null)
        setCurrentFileContent('')
        setDirty(false)
        await updateWorkspaceState(currentPath, { lastFilePath: null })
        setStatusMessage('Open file was removed')
        return
      }

      if (currentFilePath === event.path && !isDirty && event.type === 'change') {
        const updatedContent = await window.appApi.readWorkspaceFile(event.path)
        setCurrentFileContent(updatedContent)
        setStatusMessage('Synced with external edits')
      }
    })

    return unsubscribe
  }, [currentFilePath, currentPath, isDirty, setCurrentFileContent])

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
        <div className='section-title'>
          <button
            type='button'
            onClick={() => {
              void handlePickWorkspace()
            }}
            disabled={isPickingWorkspace}
            className='section-title-text'
            aria-label={isPickingWorkspace ? 'Opening workspace' : 'Open workspace'}
          >
            <span className='section-title-label'>{workspaceLabel}</span>
            <SelectorVerticalLine size={24} className='section-title-icon' />
          </button>

          <div className='section-title-actions'>
            <Button
              isIconOnly
              variant='ghost'
              onPress={() => {
                void handleCreateFile()
              }}
              isDisabled={!currentPath || isCreatingFile}
              className='section-create-button'
              aria-label={isCreatingFile ? 'Creating file' : 'Create file'}
            >
              <AddLine size={18} />
            </Button>
          </div>
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
                <p className='eyebrow'>Ready</p>
                <div className='editor-empty-copy'>
                  <h3>Open a workspace, then start with a clean draft.</h3>
                  <p>
                    The file tree, editor, and assistant stay together in one calm desktop workspace.
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
        <AgentSidebar workspacePath={currentPath} />
      </aside>
    </div>
  )
}

export default App
