import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import {
  Modal,
  Kbd,
  ListBox,
  ListBoxItem
} from '@heroui/react'
import { Icon } from '@iconify/react'
import { AppScrollArea } from '@/components/app-scroll-area'
import { WorkspaceFileIcon } from '@/components/file-change-visuals'
import {
  buildCommandPaletteResultSections,
  type CommandPaletteResult,
} from '@/features/command-palette/lib/search-results'
import type { WorkspaceNode } from '@/features/workspace/types'
import type { WorkspaceIconTheme } from '@/features/workspace/types'
import type { AgentSessionListItem } from '@/features/agent/types'

type CommandPaletteProps = {
  isOpen: boolean
  onClose: () => void
  files: WorkspaceNode[]
  sessions: AgentSessionListItem[]
  iconTheme: WorkspaceIconTheme | null
  onOpenFile: (path: string) => void
  onOpenSession: (path: string) => void
  theme: 'light' | 'dark' | 'auto'
}



export function CommandPalette({
  isOpen,
  onClose,
  files,
  sessions,
  iconTheme,
  onOpenFile,
  onOpenSession,
  theme
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const isMac = typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
  const cmdKey = isMac ? '⌘' : 'Ctrl'

  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<CommandPaletteResult[]>([])
  const selectedIndexRef = useRef(0)

  const resultSections = useMemo(() => (
    buildCommandPaletteResultSections({
      files,
      query,
      sessions,
    })
  ), [files, query, sessions])

  const results = useMemo(() => (
    resultSections.flatMap((section) => section.items)
  ), [resultSections])

  const selectResult = useCallback((item: CommandPaletteResult) => {
    if (item.category === 'file') {
      onOpenFile(item.path)
    } else {
      onOpenSession(item.path)
    }

    onClose()
  }, [onClose, onOpenFile, onOpenSession])

  useEffect(() => {
    resultsRef.current = results
  }, [results])

  useEffect(() => {
    selectedIndexRef.current = selectedIndex
  }, [selectedIndex])

  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0)
      setQuery('')
      setTimeout(() => inputRef.current?.focus(), 150)
    }
  }, [isOpen])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Keep keyboard selection valid as the query or backing data changes.
  useEffect(() => {
    if (results.length === 0 && selectedIndex !== 0) {
      setSelectedIndex(0)
      return
    }

    if (results.length > 0 && selectedIndex >= results.length) {
      setSelectedIndex(results.length - 1)
    }
  }, [results.length, selectedIndex])

  useEffect(() => {
    if (!isOpen) return

    const frameId = requestAnimationFrame(() => {
      const activeElement = document.querySelector(`[data-command-active="true"]`)
      if (activeElement) {
        activeElement.scrollIntoView({
          behavior: 'auto', // 'auto' is usually instant, avoids overhead of smooth scroll
          block: 'nearest',
          inline: 'nearest'
        })
      }
    })

    return () => cancelAnimationFrame(frameId)
  }, [selectedIndex, results, isOpen])

  const lastNavigateTime = useRef(0)

  useEffect(() => {
    if (!isOpen) return
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const currentResults = resultsRef.current
      const currentIndex = selectedIndexRef.current

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const now = Date.now()
        // Slow down navigation speed (throttle to ~16fps / 60ms) to ensure absolute stability
        if (now - lastNavigateTime.current < 60) {
          e.preventDefault()
          return
        }
        lastNavigateTime.current = now

        e.preventDefault()
        if (currentResults.length === 0) {
          return
        }

        if (e.key === 'ArrowDown') {
          setSelectedIndex(prev => (prev + 1) % currentResults.length)
        } else {
          setSelectedIndex(prev => (prev - 1 + currentResults.length) % currentResults.length)
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const selected = currentResults[currentIndex]
        if (selected) {
          selectResult(selected)
        }
      } else if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown, true)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true)
  }, [isOpen, onClose, selectResult])

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={onClose}
      variant='opaque'
    >
      <Modal.Container
        scroll='inside'
        className='flex items-center justify-center p-0 m-0 border-none shadow-none bg-transparent'
      >
        <Modal.Dialog
          aria-label='Command palette'
          className={`command-palette-dialog ${theme === 'dark' ? 'dark theme-dark' : 'theme-light'}`}
        >
          <Modal.Body className='p-0 m-0'>
              {/* Header */}
              <div className='command-palette-header'>
                <Icon icon='lucide:search' className='command-palette-icon' width={16} height={16} />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder='搜索...'
                  style={{ outline: 'none', boxShadow: 'none' }}
                  className='command-palette-input'
                />
                <div className='command-palette-kbd-group'>
                  <Kbd className="text-[10px] px-2 py-0.5 shadow-none">
                    {cmdKey}
                    <span className="ml-1">K</span>
                  </Kbd>
                </div>
              </div>

              <div className='command-palette-divider' />

              {/* Viewport with explicit scrolling container */}
              <AppScrollArea
                className='command-palette-viewport'
                contentClassName='command-palette-viewport-content'
              >
                {results.length > 0 ? (
                  <div className='flex flex-col gap-6'>
                    {(() => {
                      const activeId = results[selectedIndex]?.id

                      return resultSections.map((section) => {
                        return (
                          <div key={section.category} className='command-palette-section'>
                            <header className='command-palette-section-header'>
                              {section.label}
                            </header>
                            <ListBox
                              aria-label={section.label}
                              className='p-0 gap-0 outline-none'
                              selectionMode='single'
                              onAction={(key) => {
                                const item = resultsRef.current.find(i => i.id === key)
                                if (item) selectResult(item)
                              }}
                            >
                              {section.items.map((item) => {
                                const isSelected = item.id === activeId

                                return (
                                  <ListBoxItem
                                    key={item.id}
                                    data-command-active={isSelected ? 'true' : 'false'}
                                    textValue={item.label}
                                    className='command-palette-item'
                                    onPress={() => selectResult(item)}
                                    style={{ outline: 'none' }}
                                  >
                                    <div className='command-palette-item-content'>
                                      <div className='command-palette-item-icon'>
                                        {item.category === 'file' ? (
                                          <WorkspaceFileIcon fileName={item.fileName} iconTheme={iconTheme} />
                                        ) : (
                                          <WorkspaceFileIcon fileName='.jsonl' iconTheme={iconTheme} />
                                        )}
                                      </div>
                                      <div className='command-palette-item-text'>
                                        <span className='command-palette-item-title'>{item.label}</span>
                                        {item.description && (
                                          <span className='command-palette-item-desc'>
                                            {item.description}
                                          </span>
                                        )}
                                      </div>
                                      <div className={`command-palette-item-action ${isSelected ? 'is-active' : ''}`}>
                                        <Kbd className="text-[10px] px-1.5 py-0.5 shadow-none">ENTER</Kbd>
                                      </div>
                                    </div>
                                  </ListBoxItem>
                                )
                              })}
                            </ListBox>
                          </div>
                        )
                      })
                    })()}
                  </div>
                ) : (
                  <div className='command-palette-empty'>
                    <Icon icon='lucide:search' width={32} className='command-palette-empty-icon' />
                    <p className='command-palette-empty-text'>未找到结果</p>
                  </div>
                )}
              </AppScrollArea>

              {/* Footer */}
              <div className='command-palette-footer'>
                <div className='command-palette-footer-group'>
                  <div className='command-palette-footer-item'>
                    <div className='command-palette-footer-kbd-row'>
                      <Kbd className="text-[10px] px-1.5 py-0.5 shadow-none min-w-[20px]">↑</Kbd>
                      <Kbd className="text-[10px] px-1.5 py-0.5 shadow-none min-w-[20px]">↓</Kbd>
                    </div>
                    <span>导航</span>
                  </div>
                  <div className='command-palette-footer-item'>
                    <Kbd className="text-[10px] px-1.5 py-0.5 shadow-none">ENTER</Kbd>
                    <span>选择</span>
                  </div>
                </div>
                <div className='command-palette-footer-item'>
                  <Kbd className="text-[10px] px-1.5 py-0.5 shadow-none">ESC</Kbd>
                  <span>关闭</span>
                </div>
              </div>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
