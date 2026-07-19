import { useCallback, useEffect, useRef, useState } from 'react'

const DRAWER_INTERACTION_REFRESH_STABLE_FRAMES = 2
const DRAWER_INTERACTION_REFRESH_MAX_FRAMES = 36

type DrawerDragRegion = {
  height: number
  left: number
  top: number
  width: number
}

type UseShellDrawerControllerOptions = {
  isLeftSidebarDrawer: boolean
  isRightSidebarDrawer: boolean
  shellWidth: number
}

export function useShellDrawerController({
  isLeftSidebarDrawer,
  isRightSidebarDrawer,
  shellWidth,
}: UseShellDrawerControllerOptions) {
  const [isLeftDrawerOpen, setIsLeftDrawerOpen] = useState(false)
  const [isRightDrawerOpen, setIsRightDrawerOpen] = useState(false)
  const [drawerDragRegion, setDrawerDragRegion] = useState<DrawerDragRegion | null>(null)
  const [leftDrawerOverlayRoot, setLeftDrawerOverlayRoot] = useState<HTMLDivElement | null>(null)
  const [rightDrawerOverlayRoot, setRightDrawerOverlayRoot] = useState<HTMLDivElement | null>(null)
  const leftDrawerSurfaceRef = useRef<HTMLDivElement | null>(null)
  const rightDrawerSurfaceRef = useRef<HTMLDivElement | null>(null)

  const handleLeftDrawerOpenChange = useCallback((isOpen: boolean) => {
    if (isOpen) {
      setIsRightDrawerOpen(false)
    }

    setIsLeftDrawerOpen(isOpen)
  }, [])

  const handleRightDrawerOpenChange = useCallback((isOpen: boolean) => {
    if (isOpen) {
      setIsLeftDrawerOpen(false)
    }

    setIsRightDrawerOpen(isOpen)
  }, [])

  const closeLeftDrawer = useCallback(() => {
    setIsLeftDrawerOpen(false)
  }, [])

  const closeRightDrawer = useCallback(() => {
    setIsRightDrawerOpen(false)
  }, [])

  const closeDrawers = useCallback(() => {
    setIsLeftDrawerOpen(false)
    setIsRightDrawerOpen(false)
  }, [])

  useEffect(() => {
    if (!isLeftSidebarDrawer && isLeftDrawerOpen) {
      setIsLeftDrawerOpen(false)
    }

    if (!isRightSidebarDrawer && isRightDrawerOpen) {
      setIsRightDrawerOpen(false)
    }
  }, [isLeftDrawerOpen, isLeftSidebarDrawer, isRightDrawerOpen, isRightSidebarDrawer])

  useEffect(() => {
    const openDrawerSide = isLeftDrawerOpen ? 'left' : isRightDrawerOpen ? 'right' : null

    if (!openDrawerSide) {
      return
    }

    let cancelled = false
    let rafId = 0
    let frameCount = 0
    let stableFrameCount = 0
    let previousRectSignature = ''

    // Drawer animation changes frameless-window hit regions before its bounds settle.
    void window.appApi.refreshWindowInteractionRegions('soft').catch(() => {})

    const getDrawerSurface = () => (
      openDrawerSide === 'left'
        ? leftDrawerSurfaceRef.current
        : rightDrawerSurfaceRef.current
    )

    const tick = () => {
      if (cancelled) {
        return
      }

      frameCount += 1

      const drawerSurface = getDrawerSurface()
      if (!drawerSurface) {
        if (frameCount < DRAWER_INTERACTION_REFRESH_MAX_FRAMES) {
          rafId = window.requestAnimationFrame(tick)
        }
        return
      }

      const rect = drawerSurface.getBoundingClientRect()
      const rectSignature = [
        Math.round(rect.x * 10) / 10,
        Math.round(rect.y * 10) / 10,
        Math.round(rect.width * 10) / 10,
        Math.round(rect.height * 10) / 10,
      ].join(':')

      stableFrameCount = rectSignature === previousRectSignature ? stableFrameCount + 1 : 0
      previousRectSignature = rectSignature

      if (
        stableFrameCount >= DRAWER_INTERACTION_REFRESH_STABLE_FRAMES
        || frameCount >= DRAWER_INTERACTION_REFRESH_MAX_FRAMES
      ) {
        // Rebuild the regions once the final drawer geometry is stable.
        void window.appApi.refreshWindowInteractionRegions('hard').catch(() => {})
        return
      }

      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(rafId)
    }
  }, [isLeftDrawerOpen, isRightDrawerOpen])

  useEffect(() => {
    const hasDrawerDragTarget = (isLeftDrawerOpen && isLeftSidebarDrawer)
      || (isRightDrawerOpen && isRightSidebarDrawer)

    if (!hasDrawerDragTarget) {
      setDrawerDragRegion(null)
      return
    }

    let cancelled = false
    let rafId = 0
    let frameCount = 0
    let stableFrameCount = 0
    let previousRectSignature = ''
    let resizeObserver: ResizeObserver | null = null
    let observedDragSpacer: HTMLElement | null = null

    const publishDragRegion = (rect: DOMRect) => {
      setDrawerDragRegion((currentRegion) => {
        const nextRegion = {
          height: Math.round(rect.height),
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
        }

        if (
          currentRegion
          && currentRegion.height === nextRegion.height
          && currentRegion.left === nextRegion.left
          && currentRegion.top === nextRegion.top
          && currentRegion.width === nextRegion.width
        ) {
          return currentRegion
        }

        return nextRegion
      })
    }

    const resolveDragSpacer = () => {
      if (isLeftDrawerOpen && isLeftSidebarDrawer) {
        return leftDrawerSurfaceRef.current?.querySelector<HTMLElement>(
          '.section-title-drag-spacer',
        ) ?? null
      }

      if (isRightDrawerOpen && isRightSidebarDrawer) {
        return rightDrawerSurfaceRef.current?.querySelector<HTMLElement>(
          '.agent-threadbar-drag-spacer, .file-tabs-drag-spacer',
        ) ?? null
      }

      return null
    }

    const syncResizeObserver = (dragSpacer: HTMLElement) => {
      if (typeof ResizeObserver === 'undefined' || observedDragSpacer === dragSpacer) {
        return
      }

      resizeObserver?.disconnect()
      resizeObserver = new ResizeObserver(() => {
        publishDragRegion(dragSpacer.getBoundingClientRect())
      })
      resizeObserver.observe(dragSpacer)
      observedDragSpacer = dragSpacer
    }

    const tick = () => {
      if (cancelled) {
        return
      }

      frameCount += 1

      const dragSpacer = resolveDragSpacer()
      if (!dragSpacer) {
        if (frameCount < DRAWER_INTERACTION_REFRESH_MAX_FRAMES) {
          rafId = window.requestAnimationFrame(tick)
        }
        return
      }

      const rect = dragSpacer.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        if (frameCount < DRAWER_INTERACTION_REFRESH_MAX_FRAMES) {
          rafId = window.requestAnimationFrame(tick)
        }
        return
      }

      publishDragRegion(rect)
      syncResizeObserver(dragSpacer)

      const rectSignature = [
        Math.round(rect.x * 10) / 10,
        Math.round(rect.y * 10) / 10,
        Math.round(rect.width * 10) / 10,
        Math.round(rect.height * 10) / 10,
      ].join(':')

      stableFrameCount = rectSignature === previousRectSignature ? stableFrameCount + 1 : 0
      previousRectSignature = rectSignature

      if (
        stableFrameCount >= DRAWER_INTERACTION_REFRESH_STABLE_FRAMES
        || frameCount >= DRAWER_INTERACTION_REFRESH_MAX_FRAMES
      ) {
        return
      }

      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(rafId)
      resizeObserver?.disconnect()
    }
  }, [isLeftDrawerOpen, isLeftSidebarDrawer, isRightDrawerOpen, isRightSidebarDrawer, shellWidth])

  useEffect(() => {
    if (!isLeftDrawerOpen && !isRightDrawerOpen) {
      return
    }

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape') {
        return
      }

      if (isRightDrawerOpen) {
        handleRightDrawerOpenChange(false)
        return
      }

      if (isLeftDrawerOpen) {
        handleLeftDrawerOpenChange(false)
      }
    }

    window.addEventListener('keydown', handleWindowKeyDown)
    return () => window.removeEventListener('keydown', handleWindowKeyDown)
  }, [handleLeftDrawerOpenChange, handleRightDrawerOpenChange, isLeftDrawerOpen, isRightDrawerOpen])

  return {
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
  }
}
