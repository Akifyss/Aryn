import { type DragEvent as ReactDragEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CloseLine, FolderLine, GitBranchLine, GitCompareLine } from '@mingcute/react'
import { WorkspaceFileIcon } from '@/components/file-change-visuals'
import { AppTooltip, AppTooltipButton } from '@/components/app-tooltip'
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

type FileTabsScrollEdgeState = {
  canScrollLeft: boolean
  hasScrollOverflow: boolean
}

const FILE_TAB_LABEL_TOOLTIP_DELAY = 500
const FILE_TAB_TEXT_OVERFLOW_EPSILON = 1
const FILE_TAB_SCROLL_EDGE_EPSILON = 1
const EMPTY_FILE_TAB_SCROLL_EDGE_STATE: FileTabsScrollEdgeState = {
  canScrollLeft: false,
  hasScrollOverflow: false,
}

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

function getFileTabsScrollEdgeState(scrollerElement: HTMLElement): FileTabsScrollEdgeState {
  const maxScrollLeft = Math.max(0, scrollerElement.scrollWidth - scrollerElement.clientWidth)
  const hasScrollOverflow = maxScrollLeft > FILE_TAB_SCROLL_EDGE_EPSILON

  return {
    canScrollLeft: scrollerElement.scrollLeft > FILE_TAB_SCROLL_EDGE_EPSILON,
    hasScrollOverflow,
  }
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
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const tabContainerRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const dragPreviewRef = useRef<HTMLDivElement | null>(null)
  const labelTooltipTimerRef = useRef<number | null>(null)
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null)
  const [labelTooltip, setLabelTooltip] = useState<FileTabLabelTooltip | null>(null)
  const [scrollEdgeState, setScrollEdgeState] = useState<FileTabsScrollEdgeState>(EMPTY_FILE_TAB_SCROLL_EDGE_STATE)
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

  const syncScrollEdgeState = useCallback(() => {
    const scrollerElement = scrollerRef.current
    const nextState = scrollerElement
      ? getFileTabsScrollEdgeState(scrollerElement)
      : EMPTY_FILE_TAB_SCROLL_EDGE_STATE

    setScrollEdgeState((currentState) => (
      currentState.canScrollLeft === nextState.canScrollLeft
      && currentState.hasScrollOverflow === nextState.hasScrollOverflow
        ? currentState
        : nextState
    ))
  }, [])

  useLayoutEffect(() => {
    if (!activeTabId) {
      return
    }

    const activeTabElement = tabRefs.current[activeTabId]
    const scrollerElement = scrollerRef.current

    if (!activeTabElement || !scrollerElement) {
      syncScrollEdgeState()
      return
    }

    if (!isTabVisibleInScroller(activeTabElement, scrollerElement)) {
      activeTabElement.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      })
    }

    syncScrollEdgeState()
  }, [activeTabId, syncScrollEdgeState])

  useEffect(() => {
    const scrollerElement = scrollerRef.current
    if (!scrollerElement || typeof ResizeObserver === 'undefined') {
      return
    }

    const resizeObserver = new ResizeObserver(syncScrollEdgeState)
    resizeObserver.observe(scrollerElement)

    return () => {
      resizeObserver.disconnect()
    }
  }, [syncScrollEdgeState])

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

    syncScrollEdgeState()
  }, [syncScrollEdgeState, tabs])

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

  function focusTabAtIndex(index: number) {
    const nextTab = tabs[index]

    if (!nextTab) {
      return
    }

    onActivate(nextTab.id)
    tabRefs.current[nextTab.id]?.focus()
  }

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
      requestAnimationFrame(syncScrollEdgeState)
      return
    }

    if (clientX >= rect.right - edgeThreshold) {
      scroller.scrollLeft += scrollStep
      requestAnimationFrame(syncScrollEdgeState)
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
    <div
      ref={shellRef}
      className='file-tabs-shell'
      data-empty={tabs.length === 0}
      data-dragging={draggingTabId ? 'true' : 'false'}
      data-has-actions={hasFileTabActions ? 'true' : 'false'}
    >
      <div
        className='file-tabs-scroll-frame'
        data-can-scroll-left={scrollEdgeState.canScrollLeft ? 'true' : 'false'}
        data-has-scroll-overflow={scrollEdgeState.hasScrollOverflow ? 'true' : 'false'}
      >
        <div
          ref={scrollerRef}
          className='file-tabs-scroller'
          data-dragging={draggingTabId ? 'true' : 'false'}
          role='tablist'
          aria-label='Open files'
          onScroll={syncScrollEdgeState}
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
            requestAnimationFrame(syncScrollEdgeState)
            event.preventDefault()
          }}
        >
        {tabs.length > 0 && tabs.map((tab, index) => {
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
                <button
                  ref={(element) => {
                    tabRefs.current[tab.id] = element
                  }}
                  type='button'
                  draggable={isReorderableTab(tab)}
                  role='tab'
                  aria-selected={isActive}
                  aria-controls='editor-content-panel'
                  aria-grabbed={draggingTabId === tab.id}
                  className='file-tab-trigger'
                  onClick={() => {
                    onActivate(tab.id)
                  }}
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
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowRight') {
                      event.preventDefault()
                      focusTabAtIndex((index + 1) % tabs.length)
                      return
                    }

                    if (event.key === 'ArrowLeft') {
                      event.preventDefault()
                      focusTabAtIndex((index - 1 + tabs.length) % tabs.length)
                      return
                    }

                    if (event.key === 'Home') {
                      event.preventDefault()
                      focusTabAtIndex(0)
                      return
                    }

                    if (event.key === 'End') {
                      event.preventDefault()
                      focusTabAtIndex(tabs.length - 1)
                    }
                  }}
                >
                  {tab.kind === 'fixed-panel' ? (
                    tab.fixedTabKind === 'file-panel'
                      ? <FolderLine size={16} className='file-tab-leading-icon' />
                      : <GitBranchLine size={16} className='file-tab-leading-icon' />
                  ) : fileIconName ? (
                    <WorkspaceFileIcon fileName={fileIconName} iconTheme={iconTheme} />
                  ) : null}
                  <span className='file-tab-label'>{baseName}</span>
                  {metaLabel ? <span className='file-tab-meta'>{metaLabel}</span> : null}
                </button>
              </AppTooltip>

              {!isPinned ? (
                <div className='file-tab-actions'>
                  <AppTooltipButton
                    type='button'
                    className='file-tab-close'
                    aria-label={`Close ${baseName}`}
                    tooltip='关闭'
                    onClick={(event) => {
                      event.stopPropagation()
                      onClose(tab.id)
                    }}
                  >
                    <span className='file-tab-dirty-indicator' aria-hidden='true' />
                    <CloseLine size={16} />
                  </AppTooltipButton>
                </div>
              ) : null}
            </div>
          )
        })}

        </div>
        <div className='file-tabs-scroll-edge file-tabs-scroll-edge-left' aria-hidden='true' />
        <div className='file-tabs-scroll-edge file-tabs-scroll-edge-right' aria-hidden='true' />
      </div>

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
            <AppTooltipButton
              type='button'
              className='file-tabs-toolbar-button'
              aria-label={`Open diff for ${getTabLabel(activeFileTab)}`}
              tooltip='查看 Git 差异'
              onClick={() => {
                onOpenDiff?.(activeFileTab.filePath)
              }}
            >
              <GitCompareLine size={16} />
            </AppTooltipButton>
          ) : null}
          {actions}
        </div>
      ) : null}
    </div>
  )
}
