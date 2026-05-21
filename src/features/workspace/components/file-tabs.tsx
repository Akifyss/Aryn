import { type DragEvent as ReactDragEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { CloseLine, GitCompareLine } from '@mingcute/react'
import { Icon } from '@iconify/react'
import {
  reorderWorkspaceTabs,
  type TabDropPosition,
  type WorkspaceDisplayTab,
  type WorkspaceTab,
} from '@/features/workspace/store/use-workspace-store'

type FileTabsProps = {
  activeTabId: string | null
  actions?: ReactNode
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

function getBaseName(tab: WorkspaceDisplayTab) {
  if (tab.kind === 'fixed-panel') {
    return tab.fixedTabKind === 'file-panel' ? '文件' : 'Git'
  }

  if (tab.kind === 'settings') {
    return '设置'
  }

  return tab.kind === 'diff'
    ? tab.title
    : tab.filePath.split(/[\\/]/).pop() ?? tab.filePath
}

function getRelativePath(rootPath: string, filePath: string) {
  const normalizedRoot = rootPath.replace(/[\\/]+$/, '')
  const normalizedFilePath = filePath.replace(/[\\/]+/g, '/')
  const normalizedRootPath = normalizedRoot.replace(/[\\/]+/g, '/')

  if (!normalizedFilePath.startsWith(normalizedRootPath)) {
    return filePath.split(/[\\/]/).pop() ?? filePath
  }

  return normalizedFilePath.slice(normalizedRootPath.length).replace(/^\/+/, '')
}

function getTabMetaLabel(workspacePath: string | null, tab: WorkspaceDisplayTab, hasDuplicateName: boolean) {
  if (tab.kind === 'fixed-panel') {
    return null
  }

  if (tab.kind === 'settings') {
    return 'Application'
  }

  if (tab.kind === 'diff') {
    return tab.diff.change.scope === 'staged' ? 'Staged diff' : 'Open Changes'
  }

  const viewModeLabel = (
    tab.viewMode === 'code' ? 'Code'
      : tab.viewMode === 'preview' ? 'Preview'
        : tab.viewMode === 'meo' ? null
        : null
  )

  if (!workspacePath || !hasDuplicateName) {
    return viewModeLabel
  }

  const relativePath = getRelativePath(workspacePath, tab.filePath)
  const segments = relativePath.split('/').filter(Boolean)
  segments.pop()
  const directoryLabel = segments.join(' / ')

  const locationLabel = directoryLabel || 'Workspace root'
  return viewModeLabel ? `${viewModeLabel} · ${locationLabel}` : locationLabel
}

function isReorderableTab(tab: WorkspaceDisplayTab): tab is WorkspaceTab {
  return tab.kind !== 'settings' && tab.kind !== 'fixed-panel'
}

function getTabTitle(tab: WorkspaceDisplayTab) {
  if (tab.kind === 'fixed-panel') {
    return tab.fixedTabKind === 'file-panel' ? '文件' : 'Git'
  }

  const titleParts = [
    tab.kind === 'diff' ? tab.diff.change.path : tab.filePath,
    !tab.exists ? 'Missing from workspace. Save to recreate it.' : null,
    tab.isDirty ? 'Unsaved changes' : null,
  ]

  return titleParts.filter(Boolean).join('\n')
}

function resolveDropPosition(event: ReactDragEvent<HTMLElement>, element: HTMLElement): TabDropPosition {
  const { left, width } = element.getBoundingClientRect()
  return event.clientX < left + width / 2 ? 'before' : 'after'
}

export function FileTabs({
  activeTabId,
  actions,
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
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null)
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
  const duplicateNameSet = useMemo(() => {
    const counts = new Map<string, number>()

    for (const tab of tabs) {
      const baseName = getBaseName(tab)
      counts.set(baseName, (counts.get(baseName) ?? 0) + 1)
    }

    return new Set(
      [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([baseName]) => baseName),
    )
  }, [tabs])

  useEffect(() => {
    if (!activeTabId) {
      return
    }

    tabRefs.current[activeTabId]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    })
  }, [activeTabId])

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
    cleanupDragPreview()
  }, [])

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
    preview.style.background = 'var(--surface)'
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
    >
      <div
        ref={scrollerRef}
        className='file-tabs-scroller'
        data-dragging={draggingTabId ? 'true' : 'false'}
        role='tablist'
        aria-label='Open files'
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
        {tabs.length > 0 && tabs.map((tab, index) => {
          const baseName = getBaseName(tab)
          const metaLabel = getTabMetaLabel(workspacePath, tab, duplicateNameSet.has(baseName))
          const isActive = activeTabId === tab.id
          const isPinned = tab.kind === 'fixed-panel' || tab.kind === 'settings'
          const title = getTabTitle(tab)

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
                title={title}
                onClick={() => {
                  onActivate(tab.id)
                }}
                onDragStart={(event) => {
                  if (!isReorderableTab(tab)) {
                    event.preventDefault()
                    return
                  }

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
                  <Icon
                    icon={tab.fixedTabKind === 'file-panel' ? 'lucide:files' : 'lucide:git-branch'}
                    width={16}
                    height={16}
                    className='file-tab-leading-icon'
                  />
                ) : null}
                <span className='file-tab-label'>{baseName}</span>
                {metaLabel ? <span className='file-tab-meta'>{metaLabel}</span> : null}
              </button>

              {!isPinned ? (
                <div className='file-tab-actions'>
                  <button
                    type='button'
                    className='file-tab-close'
                    aria-label={`Close ${baseName}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onClose(tab.id)
                    }}
                  >
                    <span className='file-tab-dirty-indicator' aria-hidden='true' />
                    <CloseLine size={16} />
                  </button>
                </div>
              ) : null}
            </div>
          )
        })}

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
      {(canOpenActiveDiff || actions) ? (
        <div className='file-tabs-actions'>
          {canOpenActiveDiff && activeFileTab ? (
            <button
              type='button'
              className='file-tabs-toolbar-button'
              aria-label={`Open diff for ${getBaseName(activeFileTab)}`}
              title='Open Git diff'
              onClick={() => {
                onOpenDiff?.(activeFileTab.filePath)
              }}
            >
              <GitCompareLine size={16} />
            </button>
          ) : null}
          {actions}
        </div>
      ) : null}
    </div>
  )
}
