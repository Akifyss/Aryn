import { type DragEvent as ReactDragEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { CloseLine, GitCompareLine } from '@mingcute/react'
import {
  reorderWorkspaceTabs,
  type TabDropPosition,
  type WorkspaceDisplayTab,
  type WorkspaceTab,
} from '@/features/workspace/store/use-workspace-store'

type FileTabsProps = {
  activeFilePath: string | null
  actions?: ReactNode
  tabs: WorkspaceDisplayTab[]
  workspacePath: string | null
  onActivate: (filePath: string) => void
  onClose: (filePath: string) => void
  onMoveTab: (movingPath: string, targetPath: string, position: TabDropPosition) => void
  onOpenDiff?: (filePath: string) => void
  getHasDiff?: (filePath: string) => boolean
}

type DragTarget = {
  position: TabDropPosition
  targetPath: string
}

function getBaseName(tab: WorkspaceDisplayTab) {
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
  if (tab.kind === 'settings') {
    return 'Application'
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

  return directoryLabel || 'Workspace root'
}

function isReorderableTab(tab: WorkspaceDisplayTab): tab is WorkspaceTab {
  return tab.kind !== 'settings'
}

function resolveDropPosition(event: ReactDragEvent<HTMLElement>, element: HTMLElement): TabDropPosition {
  const { left, width } = element.getBoundingClientRect()
  return event.clientX < left + width / 2 ? 'before' : 'after'
}

export function FileTabs({
  activeFilePath,
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
  const [draggingTabPath, setDraggingTabPath] = useState<string | null>(null)
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null)
  const reorderableTabs = useMemo(
    () => tabs.filter(isReorderableTab),
    [tabs],
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
    if (!activeFilePath) {
      return
    }

    tabRefs.current[activeFilePath]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    })
  }, [activeFilePath])

  useEffect(() => {
    if (draggingTabPath && !reorderableTabs.some((tab) => tab.filePath === draggingTabPath)) {
      setDraggingTabPath(null)
      setDragTarget(null)
      cleanupDragPreview()
      return
    }

    if (dragTarget && !reorderableTabs.some((tab) => tab.filePath === dragTarget.targetPath)) {
      setDragTarget(null)
    }
  }, [dragTarget, draggingTabPath, reorderableTabs])

  useEffect(() => () => {
    cleanupDragPreview()
  }, [])

  function focusTabAtIndex(index: number) {
    const nextTab = tabs[index]

    if (!nextTab) {
      return
    }

    onActivate(nextTab.filePath)
    tabRefs.current[nextTab.filePath]?.focus()
  }

  function wouldMoveChangeOrder(targetPath: string, position: TabDropPosition) {
    if (!draggingTabPath) {
      return false
    }

    return reorderWorkspaceTabs(reorderableTabs, draggingTabPath, targetPath, position) !== reorderableTabs
  }

  function setNextDragTarget(targetPath: string, position: TabDropPosition) {
    if (!wouldMoveChangeOrder(targetPath, position)) {
      setDragTarget(null)
      return
    }

    setDragTarget((currentTarget) => (
      currentTarget?.targetPath === targetPath && currentTarget.position === position
        ? currentTarget
        : { targetPath, position }
    ))
  }

  function getBoundaryDragTarget(clientX: number) {
    const firstTab = reorderableTabs[0]
    const lastTab = reorderableTabs[reorderableTabs.length - 1]

    if (!firstTab || !lastTab) {
      return null
    }

    const firstTabElement = tabContainerRefs.current[firstTab.filePath]
    const lastTabElement = tabContainerRefs.current[lastTab.filePath]

    if (firstTabElement && clientX <= firstTabElement.getBoundingClientRect().left) {
      return {
        position: 'before' as const,
        targetPath: firstTab.filePath,
      }
    }

    if (lastTabElement && clientX >= lastTabElement.getBoundingClientRect().right) {
      return {
        position: 'after' as const,
        targetPath: lastTab.filePath,
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

  function createDragPreview(tabPath: string) {
    cleanupDragPreview()

    const sourceElement = tabContainerRefs.current[tabPath]
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
    const targetElement = tabContainerRefs.current[target.targetPath]
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
      data-dragging={draggingTabPath ? 'true' : 'false'}
    >
      <div
        ref={scrollerRef}
        className='file-tabs-scroller'
        data-dragging={draggingTabPath ? 'true' : 'false'}
        role='tablist'
        aria-label='Open files'
        onDragOver={(event) => {
          if (!draggingTabPath) {
            return
          }

          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          autoScrollDuringDrag(event.clientX)

          const dragOverElement = event.target instanceof HTMLElement
            ? event.target.closest<HTMLElement>('[data-tab-path][data-reorderable="true"]')
            : null

          if (dragOverElement) {
            const targetPath = dragOverElement.dataset.tabPath
            if (!targetPath) {
              setDragTarget(null)
              return
            }

            setNextDragTarget(targetPath, resolveDropPosition(event, dragOverElement))
            return
          }

          const boundaryTarget = getBoundaryDragTarget(event.clientX)
          if (!boundaryTarget) {
            setDragTarget(null)
            return
          }

          setNextDragTarget(boundaryTarget.targetPath, boundaryTarget.position)
        }}
        onDrop={(event) => {
          if (!draggingTabPath) {
            return
          }

          event.preventDefault()

          const target = dragTarget ?? getBoundaryDragTarget(event.clientX)
          if (target && wouldMoveChangeOrder(target.targetPath, target.position)) {
            onMoveTab(draggingTabPath, target.targetPath, target.position)
            requestAnimationFrame(() => {
              tabRefs.current[draggingTabPath]?.focus()
              tabRefs.current[draggingTabPath]?.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'nearest',
              })
            })
          }

          setDraggingTabPath(null)
          setDragTarget(null)
          cleanupDragPreview()
        }}
        onDragLeave={(event) => {
          if (!draggingTabPath || !scrollerRef.current) {
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
          const isActive = activeFilePath === tab.filePath
          const title = [
            tab.kind === 'diff' ? tab.diff.change.path : tab.filePath,
            !tab.exists ? 'Missing from workspace. Save to recreate it.' : null,
            tab.kind === 'file' && tab.isDirty ? 'Unsaved changes' : null,
          ]
            .filter(Boolean)
            .join('\n')

          return (
            <div
              key={tab.filePath}
              ref={(element) => {
                tabContainerRefs.current[tab.filePath] = element
              }}
              className={`file-tab${isActive ? ' is-active' : ''}${tab.kind === 'file' && tab.isDirty ? ' is-dirty' : ''}${tab.exists ? '' : ' is-missing'}${draggingTabPath === tab.filePath ? ' is-drag-source' : ''}`}
              data-active={isActive ? 'true' : 'false'}
              data-reorderable={tab.kind === 'settings' ? 'false' : 'true'}
              data-tab-path={tab.filePath}
            >
              <button
                ref={(element) => {
                  tabRefs.current[tab.filePath] = element
                }}
                type='button'
                draggable={tab.kind !== 'settings'}
                role='tab'
                aria-selected={isActive}
                aria-controls='writing-editor-panel'
                aria-grabbed={draggingTabPath === tab.filePath}
                className='file-tab-trigger'
                title={title}
                onClick={() => {
                  onActivate(tab.filePath)
                }}
                onDragStart={(event) => {
                  if (tab.kind === 'settings') {
                    event.preventDefault()
                    return
                  }

                  setDraggingTabPath(tab.filePath)
                  setDragTarget(null)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', tab.filePath)
                  const preview = createDragPreview(tab.filePath)
                  if (preview) {
                    event.dataTransfer.setDragImage(preview, 24, Math.max(12, preview.clientHeight / 2))
                  }
                }}
                onDragEnd={() => {
                  setDraggingTabPath(null)
                  setDragTarget(null)
                  cleanupDragPreview()
                }}
                onAuxClick={(event) => {
                  if (event.button !== 1) {
                    return
                  }

                  event.preventDefault()
                  onClose(tab.filePath)
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
                <span className='file-tab-label'>{baseName}</span>
                {metaLabel ? <span className='file-tab-meta'>{metaLabel}</span> : null}
              </button>

              <div className='file-tab-actions'>
                {tab.kind === 'file' && getHasDiff?.(tab.filePath) && onOpenDiff && (
                  <button
                    type='button'
                    className='file-tab-diff'
                    aria-label={`Open diff for ${baseName}`}
                    title='Open Git diff'
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpenDiff(tab.filePath)
                    }}
                  >
                    <GitCompareLine size={16} />
                  </button>
                )}

                <button
                  type='button'
                  className='file-tab-close'
                  aria-label={`Close ${baseName}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onClose(tab.filePath)
                  }}
                >
                  <span className='file-tab-dirty-indicator' aria-hidden='true' />
                  <CloseLine size={16} />
                </button>
              </div>
            </div>
          )
        })}

      </div>

      <div
        className='file-tabs-drag-spacer'
        aria-hidden='true'
        onDragOver={(event) => {
          if (!draggingTabPath) {
            return
          }

          const lastTab = reorderableTabs[reorderableTabs.length - 1]
          if (!lastTab) {
            return
          }

          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setNextDragTarget(lastTab.filePath, 'after')
        }}
        onDrop={(event) => {
          if (!draggingTabPath) {
            return
          }

          const lastTab = reorderableTabs[reorderableTabs.length - 1]
          if (!lastTab) {
            return
          }

          event.preventDefault()

          if (wouldMoveChangeOrder(lastTab.filePath, 'after')) {
            onMoveTab(draggingTabPath, lastTab.filePath, 'after')
            requestAnimationFrame(() => {
              tabRefs.current[draggingTabPath]?.focus()
              tabRefs.current[draggingTabPath]?.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'nearest',
              })
            })
          }

          setDraggingTabPath(null)
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
      {actions ? <div className='file-tabs-actions'>{actions}</div> : null}
    </div>
  )
}
