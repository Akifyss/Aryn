import { type AnimationEvent as ReactAnimationEvent, type DragEvent as ReactDragEvent, type ReactNode, type RefObject, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ScrollArea } from '@base-ui/react/scroll-area'
import { Tabs } from '@base-ui/react/tabs'
import { CloseLine, FolderLine, GitBranchLine, GitCompareLine } from '@mingcute/react'
import { WorkspaceFileIcon } from '@/components/file-change-visuals'
import { AppIconButton } from '@/components/app-icon-button'
import { AppTooltip } from '@/components/app-tooltip'
import {
  interpolateFileTabActiveGeometry,
  parseCssTimeInMilliseconds,
} from './file-tabs-boundary-motion'
import { createFileTabsBoundaryPaths } from './file-tabs-boundary-path'
import {
  createFileTabsShadowSnapshot,
  FileTabsBoundaryShadowLayer,
  getFileTabsShadowSnapshotCssTransform,
  type FileTabsShadowSnapshot,
} from './file-tabs-boundary-shadow'
import { parseComputedBoxShadow, type FileTabsShadowLayer } from './file-tabs-shadow'
import {
  reorderWorkspaceTabs,
  type TabDropPosition,
  type WorkspaceDisplayTab,
  type WorkspaceTab,
} from '@/features/workspace/store/use-workspace-store'
import { getBaseName, getRelativePath } from '@/features/workspace/lib/workspace-paths'
import type { WorkspaceIconTheme } from '@/features/workspace/types'
import './styles.css'

type FileTabsProps = {
  activeTabId: string | null
  actions?: ReactNode
  iconTheme: WorkspaceIconTheme | null
  tabs: WorkspaceDisplayTab[]
  workspacePath: string | null
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onMoveTab: (movingId: string, targetId: string, position: TabDropPosition) => void
  onOpenDiff?: (filePath: string) => void
  getHasDiff?: (filePath: string) => boolean
}

type DragTarget = {
  position: TabDropPosition
  targetId: string
}

type FileTabLabelTooltip = {
  tabId: string
  text: string
}

type FileTabsBoundaryGeometryBase = {
  frameHeight: number
  frameLeft: number
  frameTop: number
  frameWidth: number
  hasLeftBoundary: boolean
  hasRightBoundary: boolean
  isTabActivating: boolean
  isLayoutChanging: boolean
  radius: number
}

type FileTabsBoundaryGeometry = FileTabsBoundaryGeometryBase & ({
  kind: 'active'
  activeHeight: number
  activeLeft: number
  activeTop: number
  activeWidth: number
  tabId: string
} | {
  kind: 'empty'
  railHeight: number
})

type FileTabsShadowSlot = 'a' | 'b'

type FileTabsShadowHandoff = {
  outgoingSlot: FileTabsShadowSlot
  snapshot: FileTabsShadowSnapshot
}

const FILE_TAB_LABEL_TOOLTIP_DELAY = 500
const FILE_TAB_TEXT_OVERFLOW_EPSILON = 1
const FILE_TAB_BOUNDARY_GEOMETRY_EPSILON = 0.01
const FILE_TAB_SHADOW_HANDOFF_FALLBACK_BUFFER_MS = 100

function getTabLabel(tab: WorkspaceDisplayTab) {
  if (tab.kind === 'fixed-panel') {
    return tab.fixedTabKind === 'file-panel' ? '文件' : '更改'
  }

  return tab.kind === 'diff'
    ? tab.title
    : getBaseName(tab.filePath)
}

function getFileIconName(tab: WorkspaceDisplayTab) {
  if (tab.kind !== 'file' && tab.kind !== 'diff') {
    return null
  }

  return getBaseName(tab.filePath)
}

function getTabMetaLabel(workspacePath: string | null, tab: WorkspaceDisplayTab, hasDuplicateName: boolean) {
  if (tab.kind === 'fixed-panel') {
    return null
  }

  if (tab.kind === 'diff') {
    return tab.diff.change.scope === 'staged' ? 'Staged diff' : 'Open Changes'
  }

  if (!workspacePath || !hasDuplicateName) {
    return null
  }

  const relativePath = getRelativePath(workspacePath, tab.filePath)
  const segments = relativePath.split('/').filter(Boolean)
  segments.pop()
  const directoryLabel = segments.join(' / ')

  const locationLabel = directoryLabel || 'Workspace root'
  return locationLabel
}

function isReorderableTab(tab: WorkspaceDisplayTab): tab is WorkspaceTab {
  return tab.kind !== 'fixed-panel'
}

function getFileTabLabelOverflowTooltip(element: HTMLElement) {
  const labelElement = element.querySelector<HTMLElement>('.file-tab-label')
  const label = labelElement?.textContent?.trim()

  if (!labelElement || !label) {
    return null
  }

  return labelElement.scrollWidth > labelElement.clientWidth + FILE_TAB_TEXT_OVERFLOW_EPSILON
    ? label
    : null
}

function resolveDropPosition(event: ReactDragEvent<HTMLElement>, element: HTMLElement): TabDropPosition {
  const { left, width } = element.getBoundingClientRect()
  return event.clientX < left + width / 2 ? 'before' : 'after'
}

function isTabVisibleInScroller(tabElement: HTMLElement, scrollerElement: HTMLElement) {
  const tabRect = tabElement.getBoundingClientRect()
  const scrollerRect = scrollerElement.getBoundingClientRect()

  return tabRect.left >= scrollerRect.left && tabRect.right <= scrollerRect.right
}

function readBaseTabsIndicatorGeometry(
  indicatorElement: HTMLSpanElement | null,
  frameRect: DOMRect,
) {
  const listElement = indicatorElement?.parentElement
  if (!indicatorElement || !listElement) {
    return null
  }

  const indicatorStyle = window.getComputedStyle(indicatorElement)
  const readNumber = (property: string) => Number.parseFloat(
    indicatorStyle.getPropertyValue(property),
  )
  const activeLeft = readNumber('--active-tab-left')
  const activeTop = readNumber('--active-tab-top')
  const activeWidth = readNumber('--active-tab-width')
  const activeHeight = readNumber('--active-tab-height')

  if (
    !Number.isFinite(activeLeft)
    || !Number.isFinite(activeTop)
    || !Number.isFinite(activeWidth)
    || !Number.isFinite(activeHeight)
    || activeWidth <= 0
    || activeHeight <= 0
  ) {
    return null
  }

  const listRect = listElement.getBoundingClientRect()
  return {
    activeHeight,
    activeLeft: listRect.left - frameRect.left + activeLeft,
    activeTop: listRect.top - frameRect.top + activeTop,
    activeWidth,
  }
}

function getAlternateShadowSlot(slot: FileTabsShadowSlot): FileTabsShadowSlot {
  return slot === 'a' ? 'b' : 'a'
}

function FileTabsBoundaryChrome({
  chromeHost,
  geometry,
}: {
  chromeHost: HTMLElement
  geometry: FileTabsBoundaryGeometry
}) {
  const shadowFilterPrefix = `file-tabs-boundary-shadow-${useId().replace(/:/g, '')}`
  const shadowTokenProbeRef = useRef<HTMLSpanElement | null>(null)
  const stableShadowSnapshotRef = useRef<FileTabsShadowSnapshot | null>(null)
  const layoutShadowSnapshotRef = useRef<FileTabsShadowSnapshot | null>(null)
  const layoutWasChangingRef = useRef(false)
  const [activeShadowSlot, setActiveShadowSlot] = useState<FileTabsShadowSlot>('a')
  const [shadowHandoff, setShadowHandoff] = useState<FileTabsShadowHandoff | null>(null)
  const [shadowLayers, setShadowLayers] = useState<FileTabsShadowLayer[]>([])
  const completeShadowHandoff = useCallback(() => {
    setShadowHandoff(null)
  }, [])
  const handleShadowHandoffAnimationEnd = useCallback((
    event: ReactAnimationEvent<SVGSVGElement>,
  ) => {
    if (
      event.target === event.currentTarget
      && event.animationName === 'file-tabs-shadow-handoff-in'
    ) {
      completeShadowHandoff()
    }
  }, [completeShadowHandoff])
  useLayoutEffect(() => {
    const shadowTokenProbe = shadowTokenProbeRef.current
    if (!shadowTokenProbe) {
      return
    }

    const syncShadowLayers = () => {
      const nextShadowLayers = parseComputedBoxShadow(window.getComputedStyle(shadowTokenProbe).boxShadow)
      setShadowLayers((currentShadowLayers) => (
        JSON.stringify(currentShadowLayers) === JSON.stringify(nextShadowLayers)
          ? currentShadowLayers
          : nextShadowLayers
      ))
    }

    syncShadowLayers()

    if (typeof MutationObserver === 'undefined') {
      return
    }

    const themeObserver = new MutationObserver(syncShadowLayers)
    themeObserver.observe(document.documentElement, {
      attributeFilter: ['class', 'data-theme'],
      attributes: true,
    })

    return () => themeObserver.disconnect()
  }, [])

  const paths = useMemo(() => createFileTabsBoundaryPaths({
    frameHeight: geometry.frameHeight,
    frameWidth: geometry.frameWidth,
    radius: geometry.radius,
    shape: geometry.kind === 'active'
      ? {
          kind: 'active',
          activeHeight: geometry.activeHeight,
          activeLeft: geometry.activeLeft,
          activeTop: geometry.activeTop,
          activeWidth: geometry.activeWidth,
        }
      : {
          kind: 'empty',
          railHeight: geometry.railHeight,
        },
  }), [geometry])
  const currentShadowSnapshot = useMemo(
    () => paths ? createFileTabsShadowSnapshot(geometry, paths) : null,
    [geometry, paths],
  )

  // Keep one complete, exact shadow render as the source for the next layout
  // transition. No filter input changes while that snapshot is in motion.
  useLayoutEffect(() => {
    if (
      currentShadowSnapshot
      && (
        !stableShadowSnapshotRef.current
        || (!geometry.isTabActivating && !geometry.isLayoutChanging)
      )
    ) {
      stableShadowSnapshotRef.current = currentShadowSnapshot
    }
  }, [currentShadowSnapshot, geometry.isLayoutChanging, geometry.isTabActivating])

  useLayoutEffect(() => {
    if (geometry.isLayoutChanging) {
      if (!layoutWasChangingRef.current) {
        layoutShadowSnapshotRef.current = stableShadowSnapshotRef.current
      }

      layoutWasChangingRef.current = true
      setShadowHandoff(null)
      return
    }

    if (!layoutWasChangingRef.current) {
      return
    }

    layoutWasChangingRef.current = false
    const outgoingSnapshot = layoutShadowSnapshotRef.current
    layoutShadowSnapshotRef.current = null

    if (
      !outgoingSnapshot
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setShadowHandoff(null)
      return
    }

    setShadowHandoff({
      outgoingSlot: activeShadowSlot,
      snapshot: outgoingSnapshot,
    })
    setActiveShadowSlot(getAlternateShadowSlot(activeShadowSlot))
  }, [activeShadowSlot, geometry.isLayoutChanging])

  useEffect(() => {
    if (!shadowHandoff) {
      return
    }

    const handoffDuration = parseCssTimeInMilliseconds(
      window.getComputedStyle(chromeHost).getPropertyValue('--file-tab-shadow-handoff-duration'),
      100,
    )
    const timerId = window.setTimeout(
      completeShadowHandoff,
      handoffDuration + FILE_TAB_SHADOW_HANDOFF_FALLBACK_BUFFER_MS,
    )

    return () => window.clearTimeout(timerId)
  }, [chromeHost, completeShadowHandoff, shadowHandoff])

  if (!paths || !currentShadowSnapshot) {
    return null
  }

  const variant = geometry.hasLeftBoundary
    ? paths.withLeftBoundary
    : paths.withoutLeftBoundary
  const outlinePath = geometry.hasRightBoundary
    ? variant.outlinePathWithRightBoundary
    : variant.outlinePath

  const svgProps = {
    'aria-hidden': true,
    focusable: 'false',
    height: paths.frameHeight,
    viewBox: `0 0 ${paths.frameWidth} ${paths.frameHeight}`,
    width: paths.frameWidth,
  } as const
  const prefersReducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // useLayoutEffect finalizes the slot state before paint. This synchronous
  // projection also keeps the outgoing slot unchanged in that first commit,
  // so the browser never invalidates its frozen filter with final geometry.
  const transitionJustEnded = !geometry.isLayoutChanging && layoutWasChangingRef.current
  const pendingHandoffSnapshot = transitionJustEnded && !prefersReducedMotion
    ? layoutShadowSnapshotRef.current
    : null
  const effectiveHandoff = shadowHandoff ?? (
    pendingHandoffSnapshot
      ? {
          outgoingSlot: activeShadowSlot,
          snapshot: pendingHandoffSnapshot,
        }
      : null
  )
  const incomingShadowSlot = shadowHandoff
    ? activeShadowSlot
    : pendingHandoffSnapshot
      ? getAlternateShadowSlot(activeShadowSlot)
      : activeShadowSlot
  const layoutSnapshot = layoutShadowSnapshotRef.current
    ?? stableShadowSnapshotRef.current
    ?? currentShadowSnapshot
  const activationSnapshot = geometry.isTabActivating
    ? stableShadowSnapshotRef.current ?? currentShadowSnapshot
    : currentShadowSnapshot
  let shadowContent: ReactNode[] = []

  if (shadowLayers.length > 0 && typeof document !== 'undefined') {
    if (geometry.isLayoutChanging) {
      shadowContent = [
        <FileTabsBoundaryShadowLayer
          key={activeShadowSlot}
          className='file-tabs-boundary-shadow-layer is-layout-snapshot'
          filterId={`${shadowFilterPrefix}-${activeShadowSlot}`}
          shadowLayers={shadowLayers}
          snapshot={layoutSnapshot}
          transform={getFileTabsShadowSnapshotCssTransform(layoutSnapshot, geometry)}
        />,
      ]
    } else if (effectiveHandoff) {
      const outgoingSnapshot = effectiveHandoff.snapshot

      shadowContent = [
        <FileTabsBoundaryShadowLayer
          key={effectiveHandoff.outgoingSlot}
          className='file-tabs-boundary-shadow-layer is-shadow-handoff-outgoing'
          filterId={`${shadowFilterPrefix}-${effectiveHandoff.outgoingSlot}`}
          shadowLayers={shadowLayers}
          snapshot={outgoingSnapshot}
          transform={getFileTabsShadowSnapshotCssTransform(outgoingSnapshot, geometry)}
        />,
        <FileTabsBoundaryShadowLayer
          key={incomingShadowSlot}
          className='file-tabs-boundary-shadow-layer is-shadow-handoff-incoming'
          filterId={`${shadowFilterPrefix}-${incomingShadowSlot}`}
          onAnimationEnd={handleShadowHandoffAnimationEnd}
          shadowLayers={shadowLayers}
          snapshot={currentShadowSnapshot}
        />,
      ]
    } else {
      shadowContent = [
        <FileTabsBoundaryShadowLayer
          key={activeShadowSlot}
          className='file-tabs-boundary-shadow-layer'
          filterId={`${shadowFilterPrefix}-${activeShadowSlot}`}
          shadowLayers={shadowLayers}
          snapshot={activationSnapshot}
          transform={getFileTabsShadowSnapshotCssTransform(activationSnapshot, geometry)}
        />,
      ]
    }
  }

  const shadowLayer = shadowContent.length > 0 && typeof document !== 'undefined'
    ? createPortal(shadowContent, document.body)
    : null

  const chromeLayers = createPortal(
    <>
      <span
        ref={shadowTokenProbeRef}
        aria-hidden='true'
        className='file-tabs-boundary-shadow-token-probe'
      />

      {geometry.kind === 'active' ? (
        <svg
          {...svgProps}
          className='file-tabs-boundary-chrome file-tabs-boundary-fill-layer'
        >
          <path
            className='file-tabs-boundary-active-fill'
            d={variant.activeFillPath ?? undefined}
          />
        </svg>
      ) : null}

      <svg
        {...svgProps}
        className='file-tabs-boundary-chrome file-tabs-boundary-outline-layer'
      >
        <path
          className='file-tabs-boundary-outline'
          d={outlinePath}
          vectorEffect='non-scaling-stroke'
        />
      </svg>
    </>,
    chromeHost,
  )

  return (
    <>
      {shadowLayer}
      {chromeLayers}
    </>
  )
}

function areBoundaryGeometriesEqual(
  currentGeometry: FileTabsBoundaryGeometry | null,
  nextGeometry: FileTabsBoundaryGeometry,
) {
  const hasSameFrame = currentGeometry?.kind === nextGeometry.kind
    && Math.abs(currentGeometry.frameHeight - nextGeometry.frameHeight) < FILE_TAB_BOUNDARY_GEOMETRY_EPSILON
    && Math.abs(currentGeometry.frameLeft - nextGeometry.frameLeft) < FILE_TAB_BOUNDARY_GEOMETRY_EPSILON
    && Math.abs(currentGeometry.frameTop - nextGeometry.frameTop) < FILE_TAB_BOUNDARY_GEOMETRY_EPSILON
    && Math.abs(currentGeometry.frameWidth - nextGeometry.frameWidth) < FILE_TAB_BOUNDARY_GEOMETRY_EPSILON
    && currentGeometry.hasLeftBoundary === nextGeometry.hasLeftBoundary
    && currentGeometry.hasRightBoundary === nextGeometry.hasRightBoundary
    && currentGeometry.isTabActivating === nextGeometry.isTabActivating
    && currentGeometry.isLayoutChanging === nextGeometry.isLayoutChanging
    && Math.abs(currentGeometry.radius - nextGeometry.radius) < FILE_TAB_BOUNDARY_GEOMETRY_EPSILON

  if (!hasSameFrame || !currentGeometry) {
    return false
  }

  return nextGeometry.kind === 'empty'
    ? currentGeometry.kind === 'empty'
      && Math.abs(currentGeometry.railHeight - nextGeometry.railHeight) < FILE_TAB_BOUNDARY_GEOMETRY_EPSILON
    : currentGeometry.kind === 'active'
      && currentGeometry.tabId === nextGeometry.tabId
      && Math.abs(currentGeometry.activeHeight - nextGeometry.activeHeight) < FILE_TAB_BOUNDARY_GEOMETRY_EPSILON
      && Math.abs(currentGeometry.activeLeft - nextGeometry.activeLeft) < FILE_TAB_BOUNDARY_GEOMETRY_EPSILON
      && Math.abs(currentGeometry.activeTop - nextGeometry.activeTop) < FILE_TAB_BOUNDARY_GEOMETRY_EPSILON
      && Math.abs(currentGeometry.activeWidth - nextGeometry.activeWidth) < FILE_TAB_BOUNDARY_GEOMETRY_EPSILON
}

function canAnimateActiveBoundaryTransition(
  currentGeometry: FileTabsBoundaryGeometry | null,
  nextGeometry: FileTabsBoundaryGeometry,
) {
  if (
    currentGeometry?.kind !== 'active'
    || nextGeometry.kind !== 'active'
    || currentGeometry.tabId === nextGeometry.tabId
    || currentGeometry.isLayoutChanging
    || nextGeometry.isLayoutChanging
  ) {
    return false
  }

  return (
    Math.abs(currentGeometry.frameHeight - nextGeometry.frameHeight) < FILE_TAB_BOUNDARY_GEOMETRY_EPSILON
    && Math.abs(currentGeometry.frameLeft - nextGeometry.frameLeft) < FILE_TAB_BOUNDARY_GEOMETRY_EPSILON
    && Math.abs(currentGeometry.frameTop - nextGeometry.frameTop) < FILE_TAB_BOUNDARY_GEOMETRY_EPSILON
    && Math.abs(currentGeometry.frameWidth - nextGeometry.frameWidth) < FILE_TAB_BOUNDARY_GEOMETRY_EPSILON
    && currentGeometry.hasLeftBoundary === nextGeometry.hasLeftBoundary
    && currentGeometry.hasRightBoundary === nextGeometry.hasRightBoundary
    && Math.abs(currentGeometry.radius - nextGeometry.radius) < FILE_TAB_BOUNDARY_GEOMETRY_EPSILON
  )
}

function FileTabsBoundaryChromeController({
  activeTabId,
  indicatorRef,
  scrollerRef,
  shellRef,
  tabContainerRefs,
  tabCount,
  tabGeometryKey,
}: {
  activeTabId: string | null
  indicatorRef: RefObject<HTMLSpanElement | null>
  scrollerRef: RefObject<HTMLDivElement | null>
  shellRef: RefObject<HTMLDivElement | null>
  tabContainerRefs: RefObject<Record<string, HTMLDivElement | null>>
  tabCount: number
  tabGeometryKey: string
}) {
  const [boundaryGeometry, setBoundaryGeometry] = useState<FileTabsBoundaryGeometry | null>(null)
  const boundaryGeometryRef = useRef<FileTabsBoundaryGeometry | null>(null)
  const boundaryMotionFrameRef = useRef<number | null>(null)
  const boundaryMotionTargetRef = useRef<FileTabsBoundaryGeometry | null>(null)

  const cancelBoundaryMotion = useCallback(() => {
    if (boundaryMotionFrameRef.current !== null) {
      window.cancelAnimationFrame(boundaryMotionFrameRef.current)
      boundaryMotionFrameRef.current = null
    }
    boundaryMotionTargetRef.current = null
  }, [])

  const commitBoundaryGeometry = useCallback((nextGeometry: FileTabsBoundaryGeometry | null) => {
    boundaryGeometryRef.current = nextGeometry
    setBoundaryGeometry((currentGeometry) => (
      nextGeometry && areBoundaryGeometriesEqual(currentGeometry, nextGeometry)
        ? currentGeometry
        : nextGeometry
    ))
  }, [])

  const transitionBoundaryGeometry = useCallback((nextGeometry: FileTabsBoundaryGeometry) => {
    if (
      boundaryMotionFrameRef.current !== null
      && boundaryMotionTargetRef.current
      && areBoundaryGeometriesEqual(boundaryMotionTargetRef.current, nextGeometry)
    ) {
      return
    }

    const currentGeometry = boundaryGeometryRef.current
    cancelBoundaryMotion()

    const shellElement = shellRef.current
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const activationDuration = shellElement
      ? parseCssTimeInMilliseconds(
          window.getComputedStyle(shellElement).getPropertyValue('--file-tab-activation-duration'),
        )
      : 0

    if (
      prefersReducedMotion
      || activationDuration <= 0
      || !canAnimateActiveBoundaryTransition(currentGeometry, nextGeometry)
      || currentGeometry?.kind !== 'active'
      || nextGeometry.kind !== 'active'
    ) {
      commitBoundaryGeometry(nextGeometry)
      return
    }

    const fromGeometry = currentGeometry
    const startedAt = window.performance.now()
    boundaryMotionTargetRef.current = nextGeometry
    commitBoundaryGeometry({
      ...nextGeometry,
      activeHeight: fromGeometry.activeHeight,
      activeLeft: fromGeometry.activeLeft,
      activeTop: fromGeometry.activeTop,
      activeWidth: fromGeometry.activeWidth,
      isTabActivating: true,
    })

    const animateBoundary = (timestamp: number) => {
      const progress = Math.min(1, (timestamp - startedAt) / activationDuration)
      const activeGeometry = interpolateFileTabActiveGeometry(
        fromGeometry,
        nextGeometry,
        progress,
      )

      commitBoundaryGeometry({
        ...nextGeometry,
        ...activeGeometry,
        isTabActivating: progress < 1,
      })

      if (progress < 1) {
        boundaryMotionFrameRef.current = window.requestAnimationFrame(animateBoundary)
        return
      }

      boundaryMotionFrameRef.current = null
      boundaryMotionTargetRef.current = null
    }

    boundaryMotionFrameRef.current = window.requestAnimationFrame(animateBoundary)
  }, [cancelBoundaryMotion, commitBoundaryGeometry, shellRef])

  useLayoutEffect(() => {
    const shellElement = shellRef.current
    const scrollerElement = scrollerRef.current
    const activeTabElement = activeTabId ? tabContainerRefs.current[activeTabId] : null
    const frameElement = shellElement?.closest<HTMLElement>('.editor-frame') ?? null
    const appShellElement = shellElement?.closest<HTMLElement>('.app-shell') ?? null
    const isEmpty = tabCount === 0

    if (
      !shellElement
      || !frameElement
      || !scrollerElement
      || (!isEmpty && (!activeTabId || !activeTabElement))
    ) {
      cancelBoundaryMotion()
      commitBoundaryGeometry(null)
      return
    }

    const isLayoutChanging = () => Boolean(
      appShellElement?.hasAttribute('data-sidebar-transition')
      || appShellElement?.dataset.resizing === 'true',
    )
    const syncBoundaryGeometry = () => {
      const frameRect = frameElement.getBoundingClientRect()
      const computedStyle = window.getComputedStyle(shellElement)
      const radius = Number.parseFloat(computedStyle.getPropertyValue('--file-tab-radius')) || 0
      const panelElement = frameElement.parentElement
      const appLayout = appShellElement?.dataset.appLayout
      const isEditorPanel = panelElement?.classList.contains('panel-editor') ?? false
      const isAgentPanel = panelElement?.classList.contains('panel-agent') ?? false
      const hasLeftBoundary = (
        (appLayout === 'agent' && isAgentPanel)
        || (
          appLayout === 'editor'
          && isEditorPanel
          && appShellElement?.dataset.leftCollapsed === 'false'
        )
      )
      const hasRightBoundary = (
        appLayout === 'editor'
        && isEditorPanel
        && appShellElement?.dataset.rightCollapsed === 'false'
      )
      const frameIsChanging = isLayoutChanging()
      let nextGeometry: FileTabsBoundaryGeometry

      if (isEmpty) {
        const shellRect = shellElement.getBoundingClientRect()
        nextGeometry = {
          frameHeight: frameRect.height,
          frameLeft: frameRect.left,
          frameTop: frameRect.top,
          frameWidth: frameRect.width,
          hasLeftBoundary,
          hasRightBoundary,
          isTabActivating: false,
          isLayoutChanging: frameIsChanging,
          kind: 'empty',
          radius,
          railHeight: shellRect.bottom - frameRect.top,
        }
      } else {
        if (!activeTabId || !activeTabElement) {
          cancelBoundaryMotion()
          commitBoundaryGeometry(null)
          return
        }

        const activeRect = activeTabElement.getBoundingClientRect()
        const indicatorGeometry = readBaseTabsIndicatorGeometry(
          indicatorRef.current,
          frameRect,
        )
        nextGeometry = {
          activeHeight: indicatorGeometry?.activeHeight ?? activeRect.height,
          activeLeft: indicatorGeometry?.activeLeft ?? activeRect.left - frameRect.left,
          activeTop: indicatorGeometry?.activeTop ?? activeRect.top - frameRect.top,
          activeWidth: indicatorGeometry?.activeWidth ?? activeRect.width,
          frameHeight: frameRect.height,
          frameLeft: frameRect.left,
          frameTop: frameRect.top,
          frameWidth: frameRect.width,
          hasLeftBoundary,
          hasRightBoundary,
          isTabActivating: false,
          isLayoutChanging: frameIsChanging,
          kind: 'active',
          radius,
          tabId: activeTabId,
        }
      }

      transitionBoundaryGeometry(nextGeometry)
    }

    let syncFrameId: number | null = null
    const scheduleBoundaryGeometrySync = () => {
      if (syncFrameId !== null) {
        return
      }

      syncFrameId = window.requestAnimationFrame(() => {
        syncFrameId = null
        syncBoundaryGeometry()
      })
    }

    syncBoundaryGeometry()

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleBoundaryGeometrySync)

    for (const tabElement of Object.values(tabContainerRefs.current)) {
      if (tabElement) {
        resizeObserver?.observe(tabElement)
      }
    }

    resizeObserver?.observe(shellElement)
    resizeObserver?.observe(frameElement)

    const mutationObserver = appShellElement && typeof MutationObserver !== 'undefined'
      ? new MutationObserver((records) => {
          const layoutActivityChanged = records.some(({ attributeName }) => (
            attributeName === 'data-resizing'
            || attributeName === 'data-sidebar-transition'
          ))

          if (layoutActivityChanged && isLayoutChanging()) {
            const currentGeometry = boundaryGeometryRef.current
            if (currentGeometry && !currentGeometry.isLayoutChanging) {
              cancelBoundaryMotion()
              commitBoundaryGeometry({
                ...currentGeometry,
                isTabActivating: false,
                isLayoutChanging: true,
              })
            }
            return
          }

          scheduleBoundaryGeometrySync()
        })
      : null
    if (mutationObserver && appShellElement) {
      mutationObserver.observe(appShellElement, {
        attributeFilter: [
          'data-app-layout',
          'data-layout',
          'data-left-collapsed',
          'data-resizing',
          'data-right-collapsed',
          'data-sidebar-transition',
        ],
        attributes: true,
      })
    }

    scrollerElement.addEventListener('scroll', scheduleBoundaryGeometrySync, { passive: true })
    window.addEventListener('resize', scheduleBoundaryGeometrySync)

    return () => {
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      scrollerElement.removeEventListener('scroll', scheduleBoundaryGeometrySync)
      window.removeEventListener('resize', scheduleBoundaryGeometrySync)
      if (syncFrameId !== null) {
        window.cancelAnimationFrame(syncFrameId)
      }
      cancelBoundaryMotion()
    }
  }, [
    activeTabId,
    cancelBoundaryMotion,
    commitBoundaryGeometry,
    indicatorRef,
    scrollerRef,
    shellRef,
    tabContainerRefs,
    tabCount,
    tabGeometryKey,
    transitionBoundaryGeometry,
  ])

  const chromeHost = shellRef.current
  if (!chromeHost || !boundaryGeometry || (
    (boundaryGeometry.kind === 'empty' && tabCount !== 0)
    || (boundaryGeometry.kind === 'active' && boundaryGeometry.tabId !== activeTabId)
  )) {
    return null
  }

  return <FileTabsBoundaryChrome chromeHost={chromeHost} geometry={boundaryGeometry} />
}

export function FileTabs({
  activeTabId,
  actions,
  iconTheme,
  tabs,
  workspacePath,
  onActivate,
  onClose,
  onMoveTab,
  onOpenDiff,
  getHasDiff,
}: FileTabsProps) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const indicatorRef = useRef<HTMLSpanElement | null>(null)
  const tabRefs = useRef<Record<string, HTMLElement | null>>({})
  const tabContainerRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const dragPreviewRef = useRef<HTMLDivElement | null>(null)
  const labelTooltipTimerRef = useRef<number | null>(null)
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null)
  const [labelTooltip, setLabelTooltip] = useState<FileTabLabelTooltip | null>(null)
  const reorderableTabs = useMemo(
    () => tabs.filter(isReorderableTab),
    [tabs],
  )
  const activeFileTab = useMemo(
    () => tabs.find((tab): tab is WorkspaceDisplayTab & { kind: 'file' } => tab.id === activeTabId && tab.kind === 'file') ?? null,
    [activeTabId, tabs],
  )
  const canOpenActiveDiff = Boolean(
    activeFileTab
    && onOpenDiff
    && getHasDiff?.(activeFileTab.filePath),
  )
  const isFirstTabActive = tabs[0]?.id === activeTabId
  const tabGeometryKey = useMemo(() => tabs.map((tab) => tab.id).join('\u0000'), [tabs])
  const hasFileTabActions = canOpenActiveDiff || Boolean(actions)
  const duplicateNameSet = useMemo(() => {
    const counts = new Map<string, number>()

    for (const tab of tabs) {
      const baseName = getTabLabel(tab)
      counts.set(baseName, (counts.get(baseName) ?? 0) + 1)
    }

    return new Set(
      [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([baseName]) => baseName),
    )
  }, [tabs])

  useLayoutEffect(() => {
    if (!activeTabId) {
      return
    }

    const activeTabElement = tabRefs.current[activeTabId]
    const scrollerElement = scrollerRef.current

    if (!activeTabElement || !scrollerElement) {
      return
    }

    if (!isTabVisibleInScroller(activeTabElement, scrollerElement)) {
      activeTabElement.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      })
    }

  }, [activeTabId])

  useLayoutEffect(() => {
    const currentTabIds = new Set(tabs.map((tab) => tab.id))

    for (const tabId of Object.keys(tabRefs.current)) {
      if (!currentTabIds.has(tabId)) {
        delete tabRefs.current[tabId]
      }
    }

    for (const tabId of Object.keys(tabContainerRefs.current)) {
      if (!currentTabIds.has(tabId)) {
        delete tabContainerRefs.current[tabId]
      }
    }

  }, [tabs])

  useEffect(() => {
    if (draggingTabId && !reorderableTabs.some((tab) => tab.id === draggingTabId)) {
      setDraggingTabId(null)
      setDragTarget(null)
      cleanupDragPreview()
      return
    }

    if (dragTarget && !reorderableTabs.some((tab) => tab.id === dragTarget.targetId)) {
      setDragTarget(null)
    }
  }, [dragTarget, draggingTabId, reorderableTabs])

  useEffect(() => () => {
    clearLabelTooltipTimer()
    cleanupDragPreview()
  }, [])

  useEffect(() => {
    if (labelTooltip && !tabs.some((tab) => tab.id === labelTooltip.tabId)) {
      setLabelTooltip(null)
    }
  }, [labelTooltip, tabs])

  function wouldMoveChangeOrder(targetId: string, position: TabDropPosition) {
    if (!draggingTabId) {
      return false
    }

    return reorderWorkspaceTabs(reorderableTabs, draggingTabId, targetId, position) !== reorderableTabs
  }

  function setNextDragTarget(targetId: string, position: TabDropPosition) {
    if (!wouldMoveChangeOrder(targetId, position)) {
      setDragTarget(null)
      return
    }

    setDragTarget((currentTarget) => (
      currentTarget?.targetId === targetId && currentTarget.position === position
        ? currentTarget
        : { targetId, position }
    ))
  }

  function getBoundaryDragTarget(clientX: number) {
    const firstTab = reorderableTabs[0]
    const lastTab = reorderableTabs[reorderableTabs.length - 1]

    if (!firstTab || !lastTab) {
      return null
    }

    const firstTabElement = tabContainerRefs.current[firstTab.id]
    const lastTabElement = tabContainerRefs.current[lastTab.id]

    if (firstTabElement && clientX <= firstTabElement.getBoundingClientRect().left) {
      return {
        position: 'before' as const,
        targetId: firstTab.id,
      }
    }

    if (lastTabElement && clientX >= lastTabElement.getBoundingClientRect().right) {
      return {
        position: 'after' as const,
        targetId: lastTab.id,
      }
    }

    return null
  }

  function clearLabelTooltipTimer() {
    if (labelTooltipTimerRef.current !== null) {
      window.clearTimeout(labelTooltipTimerRef.current)
      labelTooltipTimerRef.current = null
    }
  }

  function closeLabelTooltip() {
    clearLabelTooltipTimer()
    setLabelTooltip(null)
  }

  function scheduleLabelTooltip(tabId: string, element: HTMLElement) {
    clearLabelTooltipTimer()

    labelTooltipTimerRef.current = window.setTimeout(() => {
      labelTooltipTimerRef.current = null
      const nextTooltip = getFileTabLabelOverflowTooltip(element)

      setLabelTooltip(nextTooltip ? { tabId, text: nextTooltip } : null)
    }, FILE_TAB_LABEL_TOOLTIP_DELAY)
  }

  function autoScrollDuringDrag(clientX: number) {
    const scroller = scrollerRef.current
    if (!scroller) {
      return
    }

    const rect = scroller.getBoundingClientRect()
    const edgeThreshold = 48
    const scrollStep = 18

    if (clientX <= rect.left + edgeThreshold) {
      scroller.scrollLeft -= scrollStep
      return
    }

    if (clientX >= rect.right - edgeThreshold) {
      scroller.scrollLeft += scrollStep
    }
  }

  function cleanupDragPreview() {
    dragPreviewRef.current?.remove()
    dragPreviewRef.current = null
  }

  function createDragPreview(tabId: string) {
    cleanupDragPreview()

    const sourceElement = tabContainerRefs.current[tabId]
    if (!sourceElement) {
      return null
    }

    const preview = sourceElement.cloneNode(true)
    if (!(preview instanceof HTMLDivElement)) {
      return null
    }

    const sourceRect = sourceElement.getBoundingClientRect()
    preview.style.position = 'fixed'
    preview.style.left = '-9999px'
    preview.style.top = '0'
    preview.style.width = `${sourceRect.width}px`
    preview.style.height = `${sourceRect.height}px`
    preview.style.margin = '0'
    preview.style.background = 'var(--background-primary)'
    preview.style.opacity = '1'
    preview.style.pointerEvents = 'none'
    preview.style.zIndex = '9999'
    preview.classList.remove('is-drag-source')

    document.body.append(preview)
    dragPreviewRef.current = preview

    return preview
  }

  function getDropIndicatorOffset(target: DragTarget | null) {
    if (!target) {
      return null
    }

    const shellElement = shellRef.current
    const targetElement = tabContainerRefs.current[target.targetId]
    if (!shellElement || !targetElement) {
      return null
    }

    const shellRect = shellElement.getBoundingClientRect()
    const targetRect = targetElement.getBoundingClientRect()

    return target.position === 'before'
      ? targetRect.left - shellRect.left
      : targetRect.right - shellRect.left
  }

  const dropIndicatorOffset = getDropIndicatorOffset(dragTarget)

  return (
    <>
      <Tabs.Root
        ref={shellRef}
        className='file-tabs-shell'
        data-empty={tabs.length === 0}
        data-dragging={draggingTabId ? 'true' : 'false'}
        data-first-tab-active={isFirstTabActive ? 'true' : 'false'}
        data-has-actions={hasFileTabActions ? 'true' : 'false'}
        orientation='horizontal'
        value={activeTabId}
        onValueChange={(value) => {
          if (typeof value === 'string' && tabs.some((tab) => tab.id === value)) {
            onActivate(value)
          }
        }}
      >
      <ScrollArea.Root
        className='file-tabs-scroll-frame'
        overflowEdgeThreshold={1}
      >
        <ScrollArea.Viewport
          ref={scrollerRef}
          className='file-tabs-scroller'
          data-dragging={draggingTabId ? 'true' : 'false'}
          onDragOver={(event) => {
            if (!draggingTabId) {
              return
            }

            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            autoScrollDuringDrag(event.clientX)

            const dragOverElement = event.target instanceof HTMLElement
              ? event.target.closest<HTMLElement>('[data-tab-id][data-reorderable="true"]')
              : null

            if (dragOverElement) {
              const targetId = dragOverElement.dataset.tabId
              if (!targetId) {
                setDragTarget(null)
                return
              }

              setNextDragTarget(targetId, resolveDropPosition(event, dragOverElement))
              return
            }

            const boundaryTarget = getBoundaryDragTarget(event.clientX)
            if (!boundaryTarget) {
              setDragTarget(null)
              return
            }

            setNextDragTarget(boundaryTarget.targetId, boundaryTarget.position)
          }}
          onDrop={(event) => {
            if (!draggingTabId) {
              return
            }

            event.preventDefault()

            const target = dragTarget ?? getBoundaryDragTarget(event.clientX)
            if (target && wouldMoveChangeOrder(target.targetId, target.position)) {
              onMoveTab(draggingTabId, target.targetId, target.position)
              requestAnimationFrame(() => {
                tabRefs.current[draggingTabId]?.focus()
                tabRefs.current[draggingTabId]?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'nearest',
                  inline: 'nearest',
                })
              })
            }

            setDraggingTabId(null)
            setDragTarget(null)
            cleanupDragPreview()
          }}
          onDragLeave={(event) => {
            if (!draggingTabId || !scrollerRef.current) {
              return
            }

            const nextTarget = event.relatedTarget
            if (nextTarget instanceof Node && scrollerRef.current.contains(nextTarget)) {
              return
            }

            setDragTarget(null)
          }}
          onWheel={(event) => {
            if (!scrollerRef.current || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
              return
            }

            scrollerRef.current.scrollLeft += event.deltaY
            event.preventDefault()
          }}
        >
          <ScrollArea.Content className='file-tabs-scroll-content'>
            <Tabs.List
              activateOnFocus
              aria-label='Open files'
              className='file-tabs-list'
              loopFocus
            >
              {tabs.length > 0 && tabs.map((tab) => {
                const baseName = getTabLabel(tab)
                const fileIconName = getFileIconName(tab)
                const metaLabel = getTabMetaLabel(workspacePath, tab, duplicateNameSet.has(baseName))
                const isActive = activeTabId === tab.id
                const isPinned = tab.kind === 'fixed-panel'

                return (
                  <div
                    key={tab.id}
                    ref={(element) => {
                      tabContainerRefs.current[tab.id] = element
                    }}
                    className={`file-tab${isActive ? ' is-active' : ''}${tab.isDirty ? ' is-dirty' : ''}${tab.exists ? '' : ' is-missing'}${draggingTabId === tab.id ? ' is-drag-source' : ''}${isPinned ? ' is-pinned' : ''}`}
                    data-active={isActive ? 'true' : 'false'}
                    data-reorderable={isReorderableTab(tab) ? 'true' : 'false'}
                    data-tab-id={tab.id}
                  >
                    <AppTooltip
                      isOpen={labelTooltip?.tabId === tab.id}
                      tooltip={labelTooltip?.tabId === tab.id ? labelTooltip.text : baseName}
                      triggerMode='focusable'
                    >
                      <Tabs.Tab
                        ref={(element) => {
                          tabRefs.current[tab.id] = element
                        }}
                        type='button'
                        value={tab.id}
                        draggable={isReorderableTab(tab)}
                        aria-controls='editor-content-panel'
                        aria-grabbed={draggingTabId === tab.id}
                        className='file-tab-trigger'
                        onPointerEnter={(event) => {
                          scheduleLabelTooltip(tab.id, event.currentTarget)
                        }}
                        onPointerLeave={closeLabelTooltip}
                        onFocus={(event) => {
                          scheduleLabelTooltip(tab.id, event.currentTarget)
                        }}
                        onBlur={closeLabelTooltip}
                        onDragStart={(event) => {
                          if (!isReorderableTab(tab)) {
                            event.preventDefault()
                            return
                          }

                          closeLabelTooltip()
                          setDraggingTabId(tab.id)
                          setDragTarget(null)
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('text/plain', tab.id)
                          const preview = createDragPreview(tab.id)
                          if (preview) {
                            event.dataTransfer.setDragImage(preview, 24, Math.max(12, preview.clientHeight / 2))
                          }
                        }}
                        onDragEnd={() => {
                          setDraggingTabId(null)
                          setDragTarget(null)
                          cleanupDragPreview()
                        }}
                        onAuxClick={(event) => {
                          if (isPinned) {
                            return
                          }

                          if (event.button !== 1) {
                            return
                          }

                          event.preventDefault()
                          onClose(tab.id)
                        }}
                      >
                        {tab.kind === 'fixed-panel' ? (
                          tab.fixedTabKind === 'file-panel'
                            ? <FolderLine aria-hidden='true' className='file-tab-leading-icon' />
                            : <GitBranchLine aria-hidden='true' className='file-tab-leading-icon' />
                        ) : fileIconName ? (
                          <WorkspaceFileIcon fileName={fileIconName} iconTheme={iconTheme} />
                        ) : null}
                        <span className='file-tab-label'>{baseName}</span>
                        {metaLabel ? <span className='file-tab-meta'>{metaLabel}</span> : null}
                      </Tabs.Tab>
                    </AppTooltip>

                    {!isPinned ? (
                      <div className='file-tab-actions'>
                        <AppIconButton
                          type='button'
                          className='file-tab-close'
                          aria-label={`Close ${baseName}`}
                          size='sm'
                          tooltip='关闭'
                          onClick={(event) => {
                            event.stopPropagation()
                            onClose(tab.id)
                          }}
                        >
                          <span className='file-tab-dirty-indicator' aria-hidden='true' />
                          <CloseLine aria-hidden='true' />
                        </AppIconButton>
                      </div>
                    ) : null}
                  </div>
                )
              })}

              <Tabs.Indicator
                ref={indicatorRef}
                aria-hidden='true'
                className='file-tabs-geometry-indicator'
              />
            </Tabs.List>
          </ScrollArea.Content>
        </ScrollArea.Viewport>
        <div className='file-tabs-scroll-edge file-tabs-scroll-edge-left' aria-hidden='true' />
        <div className='file-tabs-scroll-edge file-tabs-scroll-edge-right' aria-hidden='true' />
      </ScrollArea.Root>

      <div
        className='file-tabs-drag-spacer'
        aria-hidden='true'
        onDragOver={(event) => {
          if (!draggingTabId) {
            return
          }

          const lastTab = reorderableTabs[reorderableTabs.length - 1]
          if (!lastTab) {
            return
          }

          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setNextDragTarget(lastTab.id, 'after')
        }}
        onDrop={(event) => {
          if (!draggingTabId) {
            return
          }

          const lastTab = reorderableTabs[reorderableTabs.length - 1]
          if (!lastTab) {
            return
          }

          event.preventDefault()

          if (wouldMoveChangeOrder(lastTab.id, 'after')) {
            onMoveTab(draggingTabId, lastTab.id, 'after')
            requestAnimationFrame(() => {
              tabRefs.current[draggingTabId]?.focus()
              tabRefs.current[draggingTabId]?.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'nearest',
              })
            })
          }

          setDraggingTabId(null)
          setDragTarget(null)
          cleanupDragPreview()
        }}
      />

      {dropIndicatorOffset !== null && (
        <div
          className='file-tabs-drop-indicator'
          aria-hidden='true'
          style={{ left: `${dropIndicatorOffset}px` }}
        />
      )}
      {hasFileTabActions ? (
        <div className='file-tabs-actions'>
          {canOpenActiveDiff && activeFileTab ? (
            <AppIconButton
              type='button'
              aria-label={`Open diff for ${getTabLabel(activeFileTab)}`}
              tooltip='查看 Git 差异'
              onClick={() => {
                onOpenDiff?.(activeFileTab.filePath)
              }}
            >
              <GitCompareLine aria-hidden='true' />
            </AppIconButton>
          ) : null}
          {actions}
        </div>
      ) : null}
      </Tabs.Root>

      <FileTabsBoundaryChromeController
        activeTabId={activeTabId}
        indicatorRef={indicatorRef}
        scrollerRef={scrollerRef}
        shellRef={shellRef}
        tabContainerRefs={tabContainerRefs}
        tabCount={tabs.length}
        tabGeometryKey={tabGeometryKey}
      />
    </>
  )
}
