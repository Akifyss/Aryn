import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PersistedLayoutState } from '@/features/persistence/types'
import { useSidebarLayoutTransition } from '@/features/layout/hooks/use-sidebar-layout-transition'
import { useShellDrawerController } from '@/features/layout/hooks/use-shell-drawer-controller'
import {
  readStoredLayoutBoolean,
  readStoredLayoutNumber,
  readStoredLeftSidebarTab,
} from '@/features/persistence/renderer-state'
import {
  AGENT_CHAT_MIN_WIDTH,
  AGENT_EDITOR_MIN_WIDTH,
  clampAgentChatWidth,
  clampEditorRightSidebarWidth,
  clampLeftSidebarWidth,
  deriveLayoutMode,
  deriveShellPlatform,
  EDITOR_MAIN_MIN_WIDTH,
  EDITOR_RIGHT_SIDEBAR_MAX_WIDTH,
  EDITOR_RIGHT_SIDEBAR_MIN_WIDTH,
  FULL_LAYOUT_BREAKPOINT,
  getShellChromeVars,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  resolveAgentLayoutWidths,
  RIGHT_DRAWER_MAX_WIDTH,
  SIDEBAR_RESIZE_END_EVENT,
} from '@/features/layout/shell-layout'

const DEFAULT_LEFT_SIDEBAR_WIDTH = 320
const DEFAULT_RIGHT_SIDEBAR_WIDTH = 368
type ResizePanel = 'left' | 'right'

type SidebarResizePreview = {
  agentChatWidth: number
  editorRightSidebarWidth: number
  leftSidebarWidth: number
}

type SidebarResizeSession = {
  left: number
  right: number
  width: number
}

type UseShellLayoutControllerOptions = {
  gitPanelLayout: PersistedLayoutState['gitPanelLayout']
  isAgentLayout: boolean
  platform: string
  shouldExposeRightSidebar: boolean
}

export function useShellLayoutController({
  gitPanelLayout,
  isAgentLayout,
  platform,
  shouldExposeRightSidebar,
}: UseShellLayoutControllerOptions) {
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(
    () => readStoredLayoutNumber('leftSidebarWidth', DEFAULT_LEFT_SIDEBAR_WIDTH),
  )
  const [editorRightSidebarWidth, setEditorRightSidebarWidth] = useState(
    () => readStoredLayoutNumber('editorRightSidebarWidth', DEFAULT_RIGHT_SIDEBAR_WIDTH),
  )
  const [agentChatWidth, setAgentChatWidth] = useState(
    () => readStoredLayoutNumber('agentChatWidth', AGENT_CHAT_MIN_WIDTH),
  )
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(
    () => readStoredLayoutBoolean('leftSidebarCollapsed', false),
  )
  const [isEditorRightSidebarCollapsed, setIsEditorRightSidebarCollapsed] = useState(
    () => readStoredLayoutBoolean('editorRightSidebarCollapsed', false),
  )
  const [isAgentRightSidebarCollapsed, setIsAgentRightSidebarCollapsed] = useState(
    () => readStoredLayoutBoolean('agentRightSidebarCollapsed', false),
  )
  const [activeResizePanel, setActiveResizePanel] = useState<ResizePanel | null>(null)
  const [activeLeftSidebarTab, setActiveLeftSidebarTab] = useState(readStoredLeftSidebarTab)
  const [shellWidth, setShellWidth] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth : FULL_LAYOUT_BREAKPOINT + 1
  ))
  const [isWindowFullScreen, setIsWindowFullScreen] = useState(false)

  const resizeSidebarRef = useRef<(panel: ResizePanel, pointerClientX: number) => void>(() => undefined)
  const finishSidebarResizeRef = useRef<(panel: ResizePanel) => void>(() => undefined)
  const sidebarResizePreviewRef = useRef<SidebarResizePreview | null>(null)
  const sidebarResizeSessionRef = useRef<SidebarResizeSession | null>(null)
  const {
    appShellRef,
    finishSidebarLayoutTransition,
    handleSidebarLayoutTransitionEnd,
    runSidebarLayoutTransition,
  } = useSidebarLayoutTransition(activeResizePanel !== null)

  const shellPlatform = deriveShellPlatform(platform)
  const shellChromeVars = getShellChromeVars(shellPlatform, {
    isFullScreen: isWindowFullScreen,
  }) as CSSProperties
  const layoutMode = deriveLayoutMode(shellWidth)
  const isLeftSidebarDrawer = layoutMode !== 'full'
  const isRightSidebarDrawer = !isAgentLayout && layoutMode === 'focus'
  const isRightDrawerFullWidth = shellWidth <= RIGHT_DRAWER_MAX_WIDTH
  const isLeftSidebarVisible = !isLeftSidebarDrawer && !isLeftSidebarCollapsed
  const isRightSidebarCollapsed = isAgentLayout
    ? isAgentRightSidebarCollapsed
    : isEditorRightSidebarCollapsed
  const isRightSidebarVisible = !isRightSidebarDrawer
    && !isRightSidebarCollapsed
    && shouldExposeRightSidebar
  const sidebarResizePreview = activeResizePanel ? sidebarResizePreviewRef.current : null
  const renderedLeftSidebarWidth = sidebarResizePreview?.leftSidebarWidth ?? leftSidebarWidth
  const renderedAgentChatWidth = sidebarResizePreview?.agentChatWidth ?? agentChatWidth
  const renderedEditorRightSidebarWidth = sidebarResizePreview?.editorRightSidebarWidth
    ?? editorRightSidebarWidth
  const effectiveLeftSidebarWidth = isLeftSidebarVisible ? renderedLeftSidebarWidth : 0
  const agentLayoutWidths = isAgentLayout
    ? resolveAgentLayoutWidths({
        agentChatWidth: renderedAgentChatWidth,
        isEditorVisible: isRightSidebarVisible,
        leftSidebarWidth: effectiveLeftSidebarWidth,
        shellWidth,
      })
    : null
  const effectiveAgentChatWidth = agentLayoutWidths?.chatWidth ?? 0
  const effectiveAgentChatTrackWidth = agentLayoutWidths?.chatTrackWidth ?? 0
  const effectiveAgentEditorTrackWidth = agentLayoutWidths?.editorTrackWidth ?? 0
  const effectiveRightSidebarWidth = isRightSidebarVisible
    ? (isAgentLayout ? effectiveAgentEditorTrackWidth : renderedEditorRightSidebarWidth)
    : 0
  const rightSidebarWidthReservedForLeftClamp = isAgentLayout
    ? (isRightSidebarVisible ? AGENT_EDITOR_MIN_WIDTH : 0)
    : effectiveRightSidebarWidth
  const {
    closeDrawers,
    closeLeftDrawer,
    closeRightDrawer,
    drawerDragRegion,
    handleLeftDrawerOpenChange,
    handleRightDrawerOpenChange,
    isLeftDrawerOpen,
    isRightDrawerOpen,
    leftDrawerOverlayRoot,
    leftDrawerSurfaceRef,
    rightDrawerOverlayRoot,
    rightDrawerSurfaceRef,
    setLeftDrawerOverlayRoot,
    setRightDrawerOverlayRoot,
  } = useShellDrawerController({
    isLeftSidebarDrawer,
    isRightSidebarDrawer,
    shellWidth,
  })

  function getShellWidth() {
    return appShellRef.current?.clientWidth ?? window.innerWidth
  }

  function clampLeftWidth(nextWidth: number, currentShellWidth: number, currentRightWidth: number) {
    const centerMinWidth = isAgentLayout && currentRightWidth > 0
      ? effectiveAgentChatWidth
      : (isAgentLayout ? AGENT_CHAT_MIN_WIDTH : EDITOR_MAIN_MIN_WIDTH)

    return clampLeftSidebarWidth({
      centerMinWidth,
      nextWidth,
      rightSidebarWidth: currentRightWidth,
      shellWidth: currentShellWidth,
    })
  }

  function clampEditorRightWidth(
    nextWidth: number,
    currentShellWidth: number,
    currentLeftWidth: number,
  ) {
    return clampEditorRightSidebarWidth(nextWidth, currentShellWidth, currentLeftWidth)
  }

  function applySidebarResizePreview(preview: SidebarResizePreview, session: SidebarResizeSession) {
    const shell = appShellRef.current

    if (!shell) {
      return
    }

    const nextLeftWidth = isLeftSidebarVisible ? preview.leftSidebarWidth : 0
    shell.style.setProperty('--left-sidebar-width', `${nextLeftWidth}px`)
    shell.style.setProperty('--left-sidebar-content-width', `${preview.leftSidebarWidth}px`)

    if (isAgentLayout) {
      const nextAgentLayoutWidths = resolveAgentLayoutWidths({
        agentChatWidth: preview.agentChatWidth,
        isEditorVisible: isRightSidebarVisible,
        leftSidebarWidth: nextLeftWidth,
        shellWidth: session.width,
      })

      if (isRightSidebarVisible) {
        preview.agentChatWidth = nextAgentLayoutWidths.chatWidth
      }

      shell.style.setProperty('--agent-chat-track-width', `${nextAgentLayoutWidths.chatTrackWidth}px`)
      shell.style.setProperty('--agent-editor-track-width', `${nextAgentLayoutWidths.editorTrackWidth}px`)
      shell.style.setProperty('--right-sidebar-width', `${nextAgentLayoutWidths.editorTrackWidth}px`)
      return
    }

    const nextRightWidth = isRightSidebarVisible
      ? clampEditorRightWidth(preview.editorRightSidebarWidth, session.width, nextLeftWidth)
      : 0

    preview.editorRightSidebarWidth = nextRightWidth
    shell.style.setProperty('--right-sidebar-content-width', `${nextRightWidth}px`)
    shell.style.setProperty('--right-sidebar-width', `${nextRightWidth}px`)
  }

  function notifySidebarResizeEnd() {
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event(SIDEBAR_RESIZE_END_EVENT))
    })
  }

  function resizeSidebar(panel: ResizePanel, pointerClientX: number) {
    if (
      (panel === 'left' && !isLeftSidebarVisible)
      || (panel === 'right' && !isRightSidebarVisible)
    ) {
      return
    }

    const preview = sidebarResizePreviewRef.current
    const session = sidebarResizeSessionRef.current

    if (!preview || !session) {
      return
    }

    if (panel === 'left') {
      const nextWidth = pointerClientX - session.left
      preview.leftSidebarWidth = clampLeftWidth(
        nextWidth,
        session.width,
        rightSidebarWidthReservedForLeftClamp,
      )
      applySidebarResizePreview(preview, session)
      return
    }

    if (isAgentLayout) {
      const nextWidth = pointerClientX - session.left - effectiveLeftSidebarWidth
      preview.agentChatWidth = clampAgentChatWidth(
        nextWidth,
        session.width,
        effectiveLeftSidebarWidth,
      )
      applySidebarResizePreview(preview, session)
      return
    }

    const nextWidth = session.right - pointerClientX
    preview.editorRightSidebarWidth = clampEditorRightWidth(
      nextWidth,
      session.width,
      effectiveLeftSidebarWidth,
    )
    applySidebarResizePreview(preview, session)
  }

  resizeSidebarRef.current = resizeSidebar

  function finishSidebarResize(panel: ResizePanel) {
    const preview = sidebarResizePreviewRef.current

    sidebarResizePreviewRef.current = null
    sidebarResizeSessionRef.current = null

    if (!preview) {
      setActiveResizePanel(null)
      return
    }

    if (panel === 'left') {
      setLeftSidebarWidth(preview.leftSidebarWidth)
      if (isAgentLayout) {
        if (isRightSidebarVisible) {
          setAgentChatWidth(preview.agentChatWidth)
        }
      } else {
        setEditorRightSidebarWidth(preview.editorRightSidebarWidth)
      }
    } else if (isAgentLayout) {
      setAgentChatWidth(preview.agentChatWidth)
    } else {
      setEditorRightSidebarWidth(preview.editorRightSidebarWidth)
    }

    setActiveResizePanel(null)
    notifySidebarResizeEnd()
  }

  finishSidebarResizeRef.current = finishSidebarResize

  function handleResizeKeyDown(panel: ResizePanel, event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented) {
      return
    }

    if (
      event.key !== 'ArrowLeft'
      && event.key !== 'ArrowRight'
      && event.key !== 'Home'
      && event.key !== 'End'
    ) {
      return
    }

    if (
      (panel === 'left' && !isLeftSidebarVisible)
      || (panel === 'right' && !isRightSidebarVisible)
    ) {
      return
    }

    event.preventDefault()

    const resizeStep = event.shiftKey ? 32 : 8
    const currentShellWidth = getShellWidth()

    if (panel === 'left') {
      const nextWidth = event.key === 'Home'
        ? LEFT_SIDEBAR_MIN_WIDTH
        : event.key === 'End'
          ? LEFT_SIDEBAR_MAX_WIDTH
          : renderedLeftSidebarWidth + (event.key === 'ArrowLeft' ? -resizeStep : resizeStep)
      const nextLeftSidebarWidth = clampLeftWidth(
        nextWidth,
        currentShellWidth,
        rightSidebarWidthReservedForLeftClamp,
      )

      setLeftSidebarWidth(nextLeftSidebarWidth)

      if (isAgentLayout && isRightSidebarVisible) {
        setAgentChatWidth((currentWidth) => (
          clampAgentChatWidth(
            currentWidth,
            currentShellWidth,
            isLeftSidebarVisible ? nextLeftSidebarWidth : 0,
          )
        ))
      } else if (isRightSidebarVisible) {
        setEditorRightSidebarWidth((currentWidth) => (
          clampEditorRightWidth(currentWidth, currentShellWidth, nextLeftSidebarWidth)
        ))
      }

      notifySidebarResizeEnd()
      return
    }

    if (isAgentLayout) {
      const nextWidth = event.key === 'Home'
        ? AGENT_CHAT_MIN_WIDTH
        : event.key === 'End'
          ? Number.POSITIVE_INFINITY
          : effectiveAgentChatWidth + (event.key === 'ArrowLeft' ? -resizeStep : resizeStep)

      setAgentChatWidth(clampAgentChatWidth(
        nextWidth,
        currentShellWidth,
        effectiveLeftSidebarWidth,
      ))
      notifySidebarResizeEnd()
      return
    }

    const nextWidth = event.key === 'Home'
      ? EDITOR_RIGHT_SIDEBAR_MIN_WIDTH
      : event.key === 'End'
        ? EDITOR_RIGHT_SIDEBAR_MAX_WIDTH
        : renderedEditorRightSidebarWidth + (event.key === 'ArrowLeft' ? resizeStep : -resizeStep)

    setEditorRightSidebarWidth(clampEditorRightWidth(
      nextWidth,
      currentShellWidth,
      effectiveLeftSidebarWidth,
    ))
    notifySidebarResizeEnd()
  }

  function handleResizeStart(panel: ResizePanel) {
    if (
      (panel === 'left' && !isLeftSidebarVisible)
      || (panel === 'right' && !isRightSidebarVisible)
    ) {
      return
    }

    const shell = appShellRef.current

    if (!shell) {
      return
    }

    const shellRect = shell.getBoundingClientRect()
    sidebarResizePreviewRef.current = {
      agentChatWidth: isRightSidebarVisible ? effectiveAgentChatWidth : agentChatWidth,
      editorRightSidebarWidth,
      leftSidebarWidth,
    }
    sidebarResizeSessionRef.current = {
      left: shellRect.left,
      right: shellRect.right,
      width: shellRect.width,
    }
    setActiveResizePanel(panel)
  }

  const revealEditorAssistantSurface = useCallback(() => {
    if (isAgentLayout) {
      return
    }

    if (isRightSidebarDrawer) {
      handleRightDrawerOpenChange(true)
      return
    }

    setIsEditorRightSidebarCollapsed(false)
  }, [handleRightDrawerOpenChange, isAgentLayout, isRightSidebarDrawer])

  const expandAgentEditorSurface = useCallback(() => {
    if (!isAgentLayout) {
      return
    }

    setIsAgentRightSidebarCollapsed((currentValue) => (
      currentValue ? false : currentValue
    ))
  }, [isAgentLayout])

  const toggleAssistantSurface = useCallback(() => {
    if (isRightSidebarDrawer) {
      handleRightDrawerOpenChange(!isRightDrawerOpen)
      return
    }

    runSidebarLayoutTransition(() => {
      const setIsRightSidebarCollapsed = isAgentLayout
        ? setIsAgentRightSidebarCollapsed
        : setIsEditorRightSidebarCollapsed

      setIsRightSidebarCollapsed((currentValue) => {
        if (currentValue && !isAgentLayout) {
          setEditorRightSidebarWidth(
            clampEditorRightWidth(
              editorRightSidebarWidth,
              getShellWidth(),
              effectiveLeftSidebarWidth,
            ),
          )
        }

        return !currentValue
      })
    })
  }, [
    editorRightSidebarWidth,
    effectiveLeftSidebarWidth,
    handleRightDrawerOpenChange,
    isAgentLayout,
    isRightDrawerOpen,
    isRightSidebarDrawer,
    runSidebarLayoutTransition,
  ])

  const expandCollapsedAssistantSurface = useCallback(() => {
    if (isRightSidebarDrawer) {
      handleRightDrawerOpenChange(true)
      return
    }

    if (!isRightSidebarCollapsed) {
      return
    }

    runSidebarLayoutTransition(() => {
      const setIsRightSidebarCollapsed = isAgentLayout
        ? setIsAgentRightSidebarCollapsed
        : setIsEditorRightSidebarCollapsed

      setIsRightSidebarCollapsed((currentValue) => {
        if (!currentValue) {
          return currentValue
        }

        if (!isAgentLayout) {
          setEditorRightSidebarWidth(
            clampEditorRightWidth(
              editorRightSidebarWidth,
              getShellWidth(),
              effectiveLeftSidebarWidth,
            ),
          )
        }

        return false
      })
    })
  }, [
    editorRightSidebarWidth,
    effectiveLeftSidebarWidth,
    handleRightDrawerOpenChange,
    isAgentLayout,
    isRightSidebarCollapsed,
    isRightSidebarDrawer,
    runSidebarLayoutTransition,
  ])

  const toggleWorkspaceSidebar = useCallback(() => {
    if (isLeftSidebarDrawer) {
      handleLeftDrawerOpenChange(!isLeftDrawerOpen)
      return
    }

    runSidebarLayoutTransition(() => {
      setIsLeftSidebarCollapsed((currentValue) => !currentValue)
    })
  }, [
    handleLeftDrawerOpenChange,
    isLeftDrawerOpen,
    isLeftSidebarDrawer,
    runSidebarLayoutTransition,
  ])

  useEffect(() => {
    let mounted = true

    void window.appApi.isWindowMaximized().then(({ isFullScreen }) => {
      if (mounted) {
        setIsWindowFullScreen(isFullScreen)
      }
    })

    const unsubscribe = window.appApi.onWindowStateChanged(({ isFullScreen }) => {
      setIsWindowFullScreen(isFullScreen)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!activeResizePanel) {
      return
    }

    const resizePanel = activeResizePanel
    let animationFrameId: number | null = null
    let latestPointerClientX: number | null = null

    function applyLatestPointerPosition() {
      if (latestPointerClientX === null) {
        return
      }

      const pointerClientX = latestPointerClientX
      latestPointerClientX = null
      resizeSidebarRef.current(resizePanel, pointerClientX)
    }

    function handlePointerMove(event: PointerEvent) {
      latestPointerClientX = event.clientX

      if (animationFrameId !== null) {
        return
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null
        applyLatestPointerPosition()
      })
    }

    function stopResizing(event: PointerEvent) {
      if (event.type === 'pointerup') {
        latestPointerClientX = event.clientX
      }

      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
        animationFrameId = null
      }

      applyLatestPointerPosition()
      finishSidebarResizeRef.current(resizePanel)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('pointercancel', stopResizing)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
      }

      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('pointercancel', stopResizing)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [activeResizePanel])

  useEffect(() => {
    let syncFrameId: number | null = null

    function syncShellWidth() {
      const nextShellWidth = getShellWidth()
      setShellWidth((currentWidth) => (
        currentWidth === nextShellWidth ? currentWidth : nextShellWidth
      ))
    }

    function scheduleShellWidthSync() {
      finishSidebarLayoutTransition()

      if (syncFrameId !== null) {
        return
      }

      syncFrameId = window.requestAnimationFrame(() => {
        syncFrameId = null
        syncShellWidth()
      })
    }

    syncShellWidth()

    const shell = appShellRef.current
    const resizeObserver = typeof ResizeObserver !== 'undefined' && shell
      ? new ResizeObserver(scheduleShellWidthSync)
      : null

    if (shell && resizeObserver) {
      resizeObserver.observe(shell)
    }
    window.addEventListener('resize', scheduleShellWidthSync)

    return () => {
      if (syncFrameId !== null) {
        window.cancelAnimationFrame(syncFrameId)
      }

      resizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleShellWidthSync)
    }
  }, [finishSidebarLayoutTransition])

  useEffect(() => {
    if (activeResizePanel) {
      return
    }

    const timeout = window.setTimeout(() => {
      void window.appApi.updateLayoutState({
        activeLeftSidebarTab,
        agentChatWidth,
        agentRightSidebarCollapsed: isAgentRightSidebarCollapsed,
        editorRightSidebarCollapsed: isEditorRightSidebarCollapsed,
        editorRightSidebarWidth,
        gitPanelLayout,
        leftSidebarCollapsed: isLeftSidebarCollapsed,
        leftSidebarWidth,
      }).catch(() => undefined)
    }, 180)

    return () => window.clearTimeout(timeout)
  }, [
    activeLeftSidebarTab,
    activeResizePanel,
    agentChatWidth,
    editorRightSidebarWidth,
    gitPanelLayout,
    isAgentRightSidebarCollapsed,
    isEditorRightSidebarCollapsed,
    isLeftSidebarCollapsed,
    leftSidebarWidth,
  ])

  useEffect(() => {
    if (activeResizePanel) {
      return
    }

    const nextLeftWidth = clampLeftWidth(
      leftSidebarWidth,
      shellWidth,
      rightSidebarWidthReservedForLeftClamp,
    )

    if (nextLeftWidth !== leftSidebarWidth) {
      setLeftSidebarWidth(nextLeftWidth)
    }

    if (isAgentLayout) {
      if (!isRightSidebarVisible) {
        return
      }

      const nextAgentChatWidth = clampAgentChatWidth(
        agentChatWidth,
        shellWidth,
        isLeftSidebarVisible ? nextLeftWidth : 0,
      )

      if (nextAgentChatWidth !== agentChatWidth) {
        setAgentChatWidth(nextAgentChatWidth)
      }

      return
    }

    if (!isRightSidebarVisible) {
      return
    }

    const nextRightWidth = clampEditorRightWidth(
      editorRightSidebarWidth,
      shellWidth,
      isLeftSidebarVisible ? nextLeftWidth : 0,
    )
    if (nextRightWidth !== editorRightSidebarWidth) {
      setEditorRightSidebarWidth(nextRightWidth)
    }
  }, [
    activeResizePanel,
    agentChatWidth,
    editorRightSidebarWidth,
    isAgentLayout,
    isLeftSidebarVisible,
    isRightSidebarVisible,
    leftSidebarWidth,
    rightSidebarWidthReservedForLeftClamp,
    shellWidth,
  ])

  useEffect(() => {
    if (!isLeftSidebarVisible && activeResizePanel === 'left') {
      sidebarResizePreviewRef.current = null
      sidebarResizeSessionRef.current = null
      setActiveResizePanel(null)
    }

    if (!isRightSidebarVisible && activeResizePanel === 'right') {
      sidebarResizePreviewRef.current = null
      sidebarResizeSessionRef.current = null
      setActiveResizePanel(null)
    }
  }, [activeResizePanel, isLeftSidebarVisible, isRightSidebarVisible])

  const leftSidebarResizeBounds = {
    max: Math.round(clampLeftWidth(
      LEFT_SIDEBAR_MAX_WIDTH,
      shellWidth,
      rightSidebarWidthReservedForLeftClamp,
    )),
    min: LEFT_SIDEBAR_MIN_WIDTH,
    value: Math.round(renderedLeftSidebarWidth),
  }
  const rightSidebarResizeBounds = {
    max: Math.round(isAgentLayout
      ? clampAgentChatWidth(Number.POSITIVE_INFINITY, shellWidth, effectiveLeftSidebarWidth)
      : clampEditorRightWidth(
          EDITOR_RIGHT_SIDEBAR_MAX_WIDTH,
          shellWidth,
          effectiveLeftSidebarWidth,
        )),
    min: isAgentLayout ? AGENT_CHAT_MIN_WIDTH : EDITOR_RIGHT_SIDEBAR_MIN_WIDTH,
    value: Math.round(isAgentLayout ? effectiveAgentChatWidth : renderedEditorRightSidebarWidth),
  }

  return {
    activeLeftSidebarTab,
    activeResizePanel,
    appShellRef,
    closeDrawers,
    closeLeftDrawer,
    closeRightDrawer,
    drawerDragRegion,
    effectiveAgentChatTrackWidth,
    effectiveAgentEditorTrackWidth,
    effectiveLeftSidebarWidth,
    effectiveRightSidebarWidth,
    expandAgentEditorSurface,
    expandCollapsedAssistantSurface,
    handleLeftDrawerOpenChange,
    handleResizeKeyDown,
    handleResizeStart,
    handleRightDrawerOpenChange,
    handleSidebarLayoutTransitionEnd,
    isLeftDrawerOpen,
    isLeftSidebarDrawer,
    isLeftSidebarVisible,
    isRightDrawerFullWidth,
    isRightDrawerOpen,
    isRightSidebarDrawer,
    isRightSidebarVisible,
    isWindowFullScreen,
    layoutMode,
    leftDrawerOverlayRoot,
    leftDrawerSurfaceRef,
    leftSidebarResizeBounds,
    renderedEditorRightSidebarWidth,
    renderedLeftSidebarWidth,
    revealEditorAssistantSurface,
    rightDrawerOverlayRoot,
    rightDrawerSurfaceRef,
    rightSidebarResizeBounds,
    setActiveLeftSidebarTab,
    setLeftDrawerOverlayRoot,
    setRightDrawerOverlayRoot,
    shellChromeVars,
    shellPlatform,
    toggleAssistantSurface,
    toggleWorkspaceSidebar,
  }
}
