import React, { useEffect, useMemo, useState, useRef } from 'react'
import {
  Modal,
  Kbd,
  ListBox,
  ListBoxItem,
  ScrollShadow
} from '@heroui/react'
import { Icon } from '@iconify/react'
import type { WorkspaceNode } from '@/features/workspace/types'
import type { AgentSessionListItem } from '@/features/agent/types'

export type CommandItem = {
  id: string
  label: string
  description?: string
  icon: string
  category: 'action' | 'file' | 'session'
  onSelect: () => void
}

type CommandPaletteProps = {
  isOpen: boolean
  onClose: () => void
  files: WorkspaceNode[]
  sessions: AgentSessionListItem[]
  actions: {
    label: string
    icon: string
    onSelect: () => void
  }[]
  onOpenFile: (path: string) => void
  onOpenSession: (id: string) => void
  theme: 'light' | 'dark' | 'auto'
}



export function CommandPalette({
  isOpen,
  onClose,
  files,
  sessions,
  actions,
  onOpenFile,
  onOpenSession,
  theme
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const isMac = typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
  const cmdKey = isMac ? '⌘' : 'Ctrl'

  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const resultsRef = useRef<CommandItem[]>([])
  const selectedIndexRef = useRef(0)

  const flattenedFiles = useMemo(() => {
    const isMac = typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
    const list: WorkspaceNode[] = []
    const flatten = (nodes: WorkspaceNode[]) => {
      nodes.forEach(node => {
        if (node.kind === 'file') list.push(node)
        if (node.children) flatten(node.children)
      })
    }
    flatten(files)
    return list
  }, [files])

  const results = useMemo(() => {
    const q = query.toLowerCase().trim()
    const all: CommandItem[] = []

    actions.forEach(action => {
      if (!q || action.label.toLowerCase().includes(q)) {
        all.push({
          id: `action-${action.label}`,
          label: action.label,
          icon: action.icon,
          category: 'action',
          onSelect: () => {
            action.onSelect()
            onClose()
          }
        })
      }
    })

    flattenedFiles.forEach(file => {
      if (!q || file.name.toLowerCase().includes(q) || file.path.toLowerCase().includes(q)) {
        all.push({
          id: `file-${file.path}`,
          label: file.name,
          description: file.path,
          icon: 'lucide:file-text',
          category: 'file',
          onSelect: () => {
            onOpenFile(file.path)
            onClose()
          }
        })
      }
    })

    sessions.forEach(session => {
      const name = session.name || 'Untitled Session'
      if (!q || name.toLowerCase().includes(q)) {
        all.push({
          id: `session-${session.id}`,
          label: name,
          description: session.preview || 'AI chat session',
          icon: 'lucide:message-square',
          category: 'session',
          onSelect: () => {
            onOpenSession(session.path)
            onClose()
          }
        })
      }
    })

    return all.slice(0, 50)
  }, [query, flattenedFiles, sessions, actions, onOpenFile, onOpenSession, onClose])

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

  // EXTREME FIX: Clamp selectedIndex when results change to avoid out-of-bounds access
  useEffect(() => {
    if (results.length > 0 && selectedIndex >= results.length) {
      setSelectedIndex(results.length - 1)
    }
  }, [results.length, selectedIndex])

  // EXTREME FIX: Deep Bound Auto-scroll with High Visibility Padding
  // Use scrollIntoView + scroll-margin (defined in CSS) for native-first performance
  // and wrap in requestAnimationFrame to prevent layout thrashing on rapid keydown.
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
        if (e.key === 'ArrowDown') {
          setSelectedIndex(prev => (prev + 1) % Math.max(currentResults.length, 1))
        } else {
          setSelectedIndex(prev => (prev - 1 + currentResults.length) % Math.max(currentResults.length, 1))
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const selected = currentResults[currentIndex]
        if (selected) {
          selected.onSelect()
        }
      } else if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown, true)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true)
  }, [isOpen, onClose])

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={isOpen}
        onOpenChange={onClose}
        variant='opaque'
      >
        <Modal.Container
          scroll='inside'
          className='flex items-center justify-center p-0 m-0 border-none shadow-none bg-transparent'
        >
          <Modal.Dialog className={`command-palette-dialog ${theme === 'dark' ? 'dark theme-dark' : 'theme-light'}`}>
            <Modal.Body className='p-0 m-0'>
              {/* Header */}
              <div className='command-palette-header'>
                <Icon icon='lucide:search' className='command-palette-icon' width={22} />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder='Search...'
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
              <ScrollShadow
                hideScrollBar
                className='command-palette-viewport'
                ref={scrollRef}
              >
                {results.length > 0 ? (
                  <div className='flex flex-col gap-6'>
                    {(() => {
                      const activeId = results[selectedIndex]?.id;
                      // Optimization: Group by category once per render to avoid O(N^2) total work
                      const categorized: Record<string, CommandItem[]> = { action: [], file: [], session: [] }
                      results.forEach(item => {
                        if (categorized[item.category]) categorized[item.category].push(item)
                      })

                      return ['action', 'file', 'session'].map((cat) => {
                        const items = categorized[cat]
                        if (items.length === 0) return null
                        const label = cat === 'action' ? 'Navigation' : cat === 'file' ? 'Recent Files' : 'Sessions'

                        return (
                          <div key={cat} className='command-palette-section'>
                            <header className='command-palette-section-header'>
                              {label}
                            </header>
                            <ListBox
                              aria-label={label}
                              className='p-0 gap-0 outline-none'
                              selectionMode='single'
                              onAction={(key) => {
                                const item = resultsRef.current.find(i => i.id === key)
                                if (item) item.onSelect()
                              }}
                            >
                              {items.map((item) => {
                                const isSelected = item.id === activeId

                                return (
                                  <ListBoxItem
                                    key={item.id}
                                    data-command-active={isSelected ? 'true' : 'false'}
                                    textValue={item.label}
                                    className='command-palette-item'
                                    onPress={() => item.onSelect()}
                                    style={{ outline: 'none' }}
                                  >
                                    <div className='command-palette-item-content'>
                                      <div className='command-palette-item-icon'>
                                        <Icon icon={item.icon} width={18} />
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
                    <p className='command-palette-empty-text'>No results found</p>
                  </div>
                )}
              </ScrollShadow>

              {/* Footer */}
              <div className='command-palette-footer'>
                <div className='command-palette-footer-group'>
                  <div className='command-palette-footer-item'>
                    <div className='command-palette-footer-kbd-row'>
                      <Kbd className="text-[10px] px-1.5 py-0.5 shadow-none min-w-[20px]">↑</Kbd>
                      <Kbd className="text-[10px] px-1.5 py-0.5 shadow-none min-w-[20px]">↓</Kbd>
                    </div>
                    <span>NAVIGATE</span>
                  </div>
                  <div className='command-palette-footer-item'>
                    <Kbd className="text-[10px] px-1.5 py-0.5 shadow-none">ENTER</Kbd>
                    <span>SELECT</span>
                  </div>
                </div>
                <div className='command-palette-footer-item'>
                  <Kbd className="text-[10px] px-1.5 py-0.5 shadow-none">ESC</Kbd>
                  <span>CLOSE</span>
                </div>
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
