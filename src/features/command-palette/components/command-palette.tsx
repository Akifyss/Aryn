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

const CustomKbd = ({ children, className = '' }: { children: React.ReactNode, className?: string }) => (
  <span className={`px-1.5 py-0.5 rounded border border-(--border) bg-(--surface-secondary) text-[10px] font-bold text-(--muted) shadow-sm leading-none flex items-center justify-center min-w-[20px] ${className}`}>
    {children}
  </span>
)

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
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  
  const resultsRef = useRef<CommandItem[]>([])
  const selectedIndexRef = useRef(0)

  const flattenedFiles = useMemo(() => {
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
          <Modal.Dialog className={`p-0 m-0 relative w-full max-w-xl bg-[var(--surface)] shadow-2xl rounded-2xl border border-[var(--border)] overflow-hidden outline-none ${theme === 'dark' ? 'dark theme-dark' : 'theme-light'}`}>
            <Modal.Body className='p-0 m-0'>
              {/* Header */}
              <div className='flex items-center px-6 py-5 gap-3.5 bg-[var(--surface)]'>
                <Icon icon='lucide:search' className='text-(--muted)' width={22} />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder='Search...'
                  style={{ outline: 'none', boxShadow: 'none' }}
                  className='flex-1 bg-transparent border-none outline-none focus:outline-none focus:ring-0 text-[16px] text-(--foreground) placeholder:text-(--muted) opacity-80 font-normal'
                />
                <div className='flex items-center gap-1.5 opacity-30 select-none'>
                   <Kbd className='bg-transparent border-none shadow-none text-xs text-[var(--muted)] font-bold'>⌘</Kbd>
                   <Kbd className='bg-transparent border-none shadow-none text-xs text-[var(--muted)] font-bold'>K</Kbd>
                </div>
              </div>

              <div className='h-px bg-[var(--border)] mx-6' />

              {/* Viewport with explicit scrolling container */}
              <ScrollShadow 
                hideScrollBar 
                className='max-h-[420px] overflow-y-auto px-2 py-4 relative'
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
                          <div key={cat} className='flex flex-col gap-1 px-2'>
                            <header className='px-4 py-1 text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.25em] opacity-80 select-none'>
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
                                  className={`rounded-xl px-4 py-2.5 transition-all outline-none focus:outline-none !outline-none focus:ring-0 ring-0 hover:!bg-[var(--surface-secondary)] ${isSelected ? 'bg-[var(--surface-tertiary)]' : 'bg-transparent'}`}
                                  onPress={() => item.onSelect()}
                                  style={{ outline: 'none' }}
                                >
                                  <div className='flex items-center gap-4 w-full pointer-events-none'>
                                    <div className={`transition-colors flex-shrink-0 ${isSelected ? 'text-(--foreground)' : 'text-(--muted)'}`}>
                                      <Icon icon={item.icon} width={18} />
                                    </div>
                                    <div className='flex flex-1 min-w-0 flex-col gap-0'>
                                      <span className={`text-[14px] font-semibold truncate ${isSelected ? 'text-(--foreground)' : 'text-(--foreground) opacity-80'}`}>{item.label}</span>
                                      {item.description && (
                                        <span className={`text-[10px] truncate opacity-40 font-normal ${isSelected ? 'text-(--foreground)' : 'text-(--muted)'}`}>
                                          {item.description}
                                        </span>
                                      )}
                                    </div>
                                    {isSelected && (
                                      <div className='flex items-center gap-1.5 px-2 py-0.5 rounded border border-[var(--border)] bg-[var(--surface)] text-[9px] font-bold text-[var(--muted)] shadow-xs uppercase tracking-tighter'>
                                        <span>ENTER</span>
                                        <Icon icon='lucide:corner-down-left' width={10} />
                                      </div>
                                    )}
                                  </div>
                                </ListBoxItem>
                              )
                            })}
                          </ListBox>
                        </div>
                      )
                    })})()}
                  </div>
                ) : (
                  <div className='py-24 flex flex-col items-center justify-center text-(--muted) gap-4 opacity-40'>
                    <Icon icon='lucide:search' width={32} className='opacity-10' />
                    <p className='text-sm italic'>No results found</p>
                  </div>
                )}
              </ScrollShadow>

              {/* Footer */}
              <div className='px-8 py-4 border-t border-[var(--border)] bg-[var(--surface)] flex items-center justify-between text-[10px] text-[var(--muted)] font-bold tracking-tight select-none'>
                <div className='flex items-center gap-8'>
                  <div className='flex items-center gap-2.5'>
                    <div className='flex gap-1'>
                      <CustomKbd><Icon icon='lucide:arrow-up' width={8} /></CustomKbd>
                      <CustomKbd><Icon icon='lucide:arrow-down' width={8} /></CustomKbd>
                    </div>
                    <span>NAVIGATE</span>
                  </div>
                  <div className='flex items-center gap-2.5'>
                    <CustomKbd className='min-w-[44px]'>ENTER</CustomKbd>
                    <span>SELECT</span>
                  </div>
                </div>
                <div className='flex items-center gap-2'>
                  <CustomKbd className='min-w-[32px]'>ESC</CustomKbd>
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
