import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import { CloseLine, GitCompareLine } from '@mingcute/react'
import type { WorkspaceDisplayTab } from '@/features/workspace/store/use-workspace-store'

type FileTabsProps = {
  activeFilePath: string | null
  actions?: ReactNode
  tabs: WorkspaceDisplayTab[]
  workspacePath: string | null
  onActivate: (filePath: string) => void
  onClose: (filePath: string) => void
  onOpenDiff?: (filePath: string) => void
  getHasDiff?: (filePath: string) => boolean
}

function getBaseName(tab: WorkspaceDisplayTab) {
  if (tab.kind === 'settings') {
    return 'Settings'
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

export function FileTabs({
  activeFilePath,
  actions,
  tabs,
  workspacePath,
  onActivate,
  onClose,
  onOpenDiff,
  getHasDiff,
}: FileTabsProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
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

  function focusTabAtIndex(index: number) {
    const nextTab = tabs[index]

    if (!nextTab) {
      return
    }

    onActivate(nextTab.filePath)
    tabRefs.current[nextTab.filePath]?.focus()
  }

  return (
    <div className='file-tabs-shell'>
      <div
        ref={scrollerRef}
        className='file-tabs-scroller'
        role='tablist'
        aria-label='Open files'
        onWheel={(event) => {
          if (!scrollerRef.current || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
            return
          }

          scrollerRef.current.scrollLeft += event.deltaY
          event.preventDefault()
        }}
      >
        {tabs.length === 0 ? (
          <div className='file-tabs-empty'>No file selected</div>
        ) : tabs.map((tab, index) => {
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
              className={`file-tab${isActive ? ' is-active' : ''}${tab.kind === 'file' && tab.isDirty ? ' is-dirty' : ''}${tab.exists ? '' : ' is-missing'}`}
              data-active={isActive ? 'true' : 'false'}
            >
              <button
                ref={(element) => {
                  tabRefs.current[tab.filePath] = element
                }}
                type='button'
                role='tab'
                aria-selected={isActive}
                aria-controls='writing-editor-panel'
                className='file-tab-trigger'
                title={title}
                onClick={() => {
                  onActivate(tab.filePath)
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
                  <GitCompareLine size={14} />
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
                <CloseLine size={14} />
              </button>
            </div>
          )
        })}
      </div>

      <div className='file-tabs-drag-spacer' aria-hidden='true' />
      {actions ? <div className='file-tabs-actions'>{actions}</div> : null}
    </div>
  )
}
