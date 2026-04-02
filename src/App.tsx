import type { CSSProperties } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
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

const DESKTOP_AGENT_BREAKPOINT = 1160
const MOBILE_STACK_BREAKPOINT = 860
const RESIZE_HANDLE_WIDTH = 12
const MIN_EDITOR_WIDTH = 480
const LEFT_SIDEBAR_MIN_WIDTH = 240
const LEFT_SIDEBAR_MAX_WIDTH = 520
const RIGHT_SIDEBAR_MIN_WIDTH = 300
const RIGHT_SIDEBAR_MAX_WIDTH = 560
const DEFAULT_LEFT_SIDEBAR_WIDTH = 320
const DEFAULT_RIGHT_SIDEBAR_WIDTH = 368

type ResizePanel = 'left' | 'right'

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function App() {
  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false)
  const [, setStatusMessage] = useState('Open a folder to start.')
  const [isCreatingFile, setIsCreatingFile] = useState(false)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(DEFAULT_LEFT_SIDEBAR_WIDTH)
  const [rightSidebarWidth, setRightSidebarWidth] = useState(DEFAULT_RIGHT_SIDEBAR_WIDTH)
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false)
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(false)
  const [activeResizePanel, setActiveResizePanel] = useState<ResizePanel | null>(null)
  const appShellRef = useRef<HTMLDivElement | null>(null)
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
  const isMobileStacked = typeof window !== 'undefined' && window.innerWidth <= MOBILE_STACK_BREAKPOINT
  const isAgentPanelVisible = typeof window !== 'undefined' && window.innerWidth > DESKTOP_AGENT_BREAKPOINT
  const isLeftSidebarVisible = !isLeftSidebarCollapsed
  const isRightSidebarVisible = isAgentPanelVisible && !isRightSidebarCollapsed
  const effectiveLeftSidebarWidth = isLeftSidebarVisible ? leftSidebarWidth : 0
  const effectiveRightSidebarWidth = isRightSidebarVisible ? rightSidebarWidth : 0

  function getShellWidth() {
    return appShellRef.current?.clientWidth ?? window.innerWidth
  }

  function clampLeftWidth(nextWidth: number, shellWidth: number, currentRightWidth: number) {
    const reservedWidth = MIN_EDITOR_WIDTH + RESIZE_HANDLE_WIDTH + (currentRightWidth > 0 ? currentRightWidth + RESIZE_HANDLE_WIDTH : 0)
    const maxWidth = Math.min(LEFT_SIDEBAR_MAX_WIDTH, Math.max(LEFT_SIDEBAR_MIN_WIDTH, shellWidth - reservedWidth))

    return clamp(nextWidth, LEFT_SIDEBAR_MIN_WIDTH, maxWidth)
  }

  function clampRightWidth(nextWidth: number, shellWidth: number, currentLeftWidth: number) {
    const reservedWidth = MIN_EDITOR_WIDTH + currentLeftWidth + RESIZE_HANDLE_WIDTH * 2
    const maxWidth = Math.min(RIGHT_SIDEBAR_MAX_WIDTH, Math.max(RIGHT_SIDEBAR_MIN_WIDTH, shellWidth - reservedWidth))

    return clamp(nextWidth, RIGHT_SIDEBAR_MIN_WIDTH, maxWidth)
  }

  function resizeSidebar(panel: ResizePanel, pointerClientX: number) {
    if (isMobileStacked) {
      return
    }

    const shell = appShellRef.current

    if (!shell) {
      return
    }

    const shellRect = shell.getBoundingClientRect()
    const shellWidth = shellRect.width

    if (panel === 'left') {
      const nextWidth = pointerClientX - shellRect.left
      setLeftSidebarWidth(clampLeftWidth(nextWidth, shellWidth, effectiveRightSidebarWidth))
      return
    }

    if (!isAgentPanelVisible) {
      return
    }

    const nextWidth = shellRect.right - pointerClientX
    setRightSidebarWidth(clampRightWidth(nextWidth, shellWidth, effectiveLeftSidebarWidth))
  }

  function handleResizeStart(panel: ResizePanel) {
    if (
      isMobileStacked
      || (panel === 'left' && !isLeftSidebarVisible)
      || (panel === 'right' && !isRightSidebarVisible)
    ) {
      return
    }

    setActiveResizePanel(panel)
  }

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
    if (!activeResizePanel) {
      return
    }

    const resizePanel = activeResizePanel

    function handlePointerMove(event: PointerEvent) {
      resizeSidebar(resizePanel, event.clientX)
    }

    function stopResizing() {
      setActiveResizePanel(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('pointercancel', stopResizing)

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('pointercancel', stopResizing)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [activeResizePanel, isAgentPanelVisible, isMobileStacked, leftSidebarWidth, rightSidebarWidth])

  useEffect(() => {
    const storage = window.localStorage
    const savedLeftWidth = storage.getItem('writing-workspace:left-sidebar-width')
    const savedRightWidth = storage.getItem('writing-workspace:right-sidebar-width')
    const savedLeftCollapsed = storage.getItem('writing-workspace:left-sidebar-collapsed')
    const savedRightCollapsed = storage.getItem('writing-workspace:right-sidebar-collapsed')

    if (savedLeftWidth) {
      const parsedLeftWidth = Number(savedLeftWidth)
      if (Number.isFinite(parsedLeftWidth)) {
        setLeftSidebarWidth(parsedLeftWidth)
      }
    }

    if (savedRightWidth) {
      const parsedRightWidth = Number(savedRightWidth)
      if (Number.isFinite(parsedRightWidth)) {
        setRightSidebarWidth(parsedRightWidth)
      }
    }

    if (savedLeftCollapsed) {
      setIsLeftSidebarCollapsed(savedLeftCollapsed === 'true')
    }

    if (savedRightCollapsed) {
      setIsRightSidebarCollapsed(savedRightCollapsed === 'true')
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem('writing-workspace:left-sidebar-width', String(leftSidebarWidth))
  }, [leftSidebarWidth])

  useEffect(() => {
    window.localStorage.setItem('writing-workspace:right-sidebar-width', String(rightSidebarWidth))
  }, [rightSidebarWidth])

  useEffect(() => {
    window.localStorage.setItem('writing-workspace:left-sidebar-collapsed', String(isLeftSidebarCollapsed))
  }, [isLeftSidebarCollapsed])

  useEffect(() => {
    window.localStorage.setItem('writing-workspace:right-sidebar-collapsed', String(isRightSidebarCollapsed))
  }, [isRightSidebarCollapsed])

  useEffect(() => {
    function syncSidebarWidths() {
      const shellWidth = getShellWidth()
      const nextLeftWidth = clampLeftWidth(leftSidebarWidth, shellWidth, effectiveRightSidebarWidth)
      const nextRightWidth = isRightSidebarVisible
        ? clampRightWidth(rightSidebarWidth, shellWidth, isLeftSidebarVisible ? nextLeftWidth : 0)
        : rightSidebarWidth

      if (nextLeftWidth !== leftSidebarWidth) {
        setLeftSidebarWidth(nextLeftWidth)
      }

      if (nextRightWidth !== rightSidebarWidth) {
        setRightSidebarWidth(nextRightWidth)
      }
    }

    syncSidebarWidths()
    window.addEventListener('resize', syncSidebarWidths)

    return () => window.removeEventListener('resize', syncSidebarWidths)
  }, [effectiveRightSidebarWidth, isLeftSidebarVisible, isRightSidebarVisible, leftSidebarWidth, rightSidebarWidth])

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

  useEffect(() => {
    if (!isLeftSidebarVisible && activeResizePanel === 'left') {
      setActiveResizePanel(null)
    }

    if (!isRightSidebarVisible && activeResizePanel === 'right') {
      setActiveResizePanel(null)
    }
  }, [activeResizePanel, isLeftSidebarVisible, isRightSidebarVisible])

  return (
    <div
      ref={appShellRef}
      className='app-shell'
      data-resizing={activeResizePanel ? 'true' : 'false'}
      style={
        {
          '--left-sidebar-width': `${effectiveLeftSidebarWidth}px`,
          '--right-sidebar-width': `${effectiveRightSidebarWidth}px`,
        } as CSSProperties
      }
    >
      <AppTitlebar
        isLeftSidebarVisible={isLeftSidebarVisible}
        isRightSidebarVisible={isRightSidebarVisible}
        showRightSidebarToggle={isAgentPanelVisible}
        onToggleLeftSidebar={() => {
          setIsLeftSidebarCollapsed((currentValue) => !currentValue)
        }}
        onToggleRightSidebar={() => {
          setIsRightSidebarCollapsed((currentValue) => !currentValue)
        }}
      />

      <aside className={`panel panel-sidebar${isLeftSidebarVisible ? '' : ' is-collapsed'}`}>
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

      <div className={`panel-resize-slot panel-resize-slot-left${isLeftSidebarVisible ? '' : ' is-hidden'}`}>
        <div
          role='separator'
          className={`panel-resize-handle${activeResizePanel === 'left' ? ' is-active' : ''}`}
          aria-label='Resize workspace sidebar'
          aria-controls='editor-main'
          aria-orientation='vertical'
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return
            }

            handleResizeStart('left')
          }}
        />
      </div>

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

      <div className={`panel-resize-slot panel-resize-slot-right${isRightSidebarVisible ? '' : ' is-hidden'}`}>
        <div
          role='separator'
          className={`panel-resize-handle${activeResizePanel === 'right' ? ' is-active' : ''}`}
          aria-label='Resize assistant sidebar'
          aria-controls='editor-main'
          aria-orientation='vertical'
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return
            }

            handleResizeStart('right')
          }}
        />
      </div>

      <aside className={`panel panel-agent${isRightSidebarVisible ? '' : ' is-collapsed'}`}>
        <AgentSidebar workspacePath={currentPath} />
      </aside>
    </div>
  )
}

export default App
