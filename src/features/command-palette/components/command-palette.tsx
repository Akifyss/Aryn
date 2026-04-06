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
}

const CustomKbd = ({ children, className = '' }: { children: React.ReactNode, className?: string }) => (
  <span className={`px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-400 shadow-sm leading-none flex items-center justify-center min-w-[20px] ${className}`}>
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
  onOpenSession
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

  // EXTREME FIX: Deep Bound Auto-scroll with High Visibility Padding
  useEffect(() => {
    if (!isOpen) return
    
    const activeElement = document.querySelector(`[data-command-active="true"]`) as HTMLElement
    const viewport = scrollRef.current

    if (activeElement && viewport) {
      const activeRect = activeElement.getBoundingClientRect()
      const viewportRect = viewport.getBoundingClientRect()

      // Large padding (80px) to ensure items are pushed WELL into the visible area
      // this prevents overlapping by the footer etc.
      const padding = 80 

      const isSubmerged = activeRect.bottom > viewportRect.bottom - padding
      const isElevated = activeRect.top < viewportRect.top + padding

      if (isSubmerged) {
        // Move DOWN (scroll list up) - calculating the delta needed to center roughly or clear the padding
        viewport.scrollTop += (activeRect.bottom - viewportRect.bottom + padding)
      } else if (isElevated) {
        // Move UP (scroll list down) 
        viewport.scrollTop -= (viewportRect.top - activeRect.top + padding)
      }
    }
  }, [selectedIndex, results, isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const currentResults = resultsRef.current
      const currentIndex = selectedIndexRef.current

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => (prev + 1) % Math.max(currentResults.length, 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => (prev - 1 + currentResults.length) % Math.max(currentResults.length, 1))
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
          <Modal.Dialog className='p-0 m-0 relative w-full max-w-xl bg-white shadow-2xl rounded-2xl border border-slate-200 overflow-hidden outline-none'>
            <Modal.Body className='p-0 m-0'>
              {/* Header */}
              <div className='flex items-center px-6 py-5 gap-3.5 bg-white'>
                <Icon icon='lucide:search' className='text-slate-400' width={22} />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder='Search...'
                  style={{ outline: 'none', boxShadow: 'none' }}
                  className='flex-1 bg-transparent border-none outline-none focus:outline-none focus:ring-0 text-[16px] text-slate-800 placeholder:text-slate-300 font-normal'
                />
                <div className='flex items-center gap-1.5 opacity-30 select-none'>
                   <Kbd className='bg-transparent border-none shadow-none text-xs text-slate-400 font-bold'>⌘</Kbd>
                   <Kbd className='bg-transparent border-none shadow-none text-xs text-slate-400 font-bold'>K</Kbd>
                </div>
              </div>

              <div className='h-px bg-slate-100 mx-6' />

              {/* Viewport with explicit scrolling container */}
              <ScrollShadow 
                hideScrollBar 
                className='max-h-[420px] overflow-y-auto px-2 py-4 relative'
                ref={scrollRef}
              >
                {results.length > 0 ? (
                  <div className='flex flex-col gap-6'>
                    {['action', 'file', 'session'].map((cat) => {
                      const items = results.filter(i => i.category === cat)
                      if (items.length === 0) return null
                      const label = cat === 'action' ? 'Navigation' : cat === 'file' ? 'Recent Files' : 'Sessions'
                      
                      return (
                        <div key={cat} className='flex flex-col gap-1 px-2'>
                          <header className='px-4 py-1 text-[10px] font-black text-slate-400 uppercase tracking-[0.25em] opacity-80 select-none'>
                            {label}
                          </header>
                          <ListBox 
                            aria-label={label} 
                            variant='flat' 
                            className='p-0 gap-0 outline-none'
                            selectionMode='single'
                            onAction={(key) => {
                               const item = resultsRef.current.find(i => i.id === key)
                               if (item) item.onSelect()
                            }}
                          >
                            {items.map((item) => {
                              const globalIndex = results.findIndex(i => i.id === item.id)
                              const isSelected = globalIndex === selectedIndex

                              return (
                                <ListBoxItem
                                  key={item.id}
                                  data-command-active={isSelected ? 'true' : 'false'}
                                  textValue={item.label}
                                  className={`rounded-xl px-4 py-2.5 transition-all outline-none focus:outline-none !outline-none focus:ring-0 ring-0 hover:!bg-slate-50 ${isSelected ? 'bg-slate-100' : 'bg-transparent'}`}
                                  onPress={() => item.onSelect()}
                                  style={{ outline: 'none' }}
                                >
                                  <div className='flex items-center gap-4 w-full pointer-events-none'>
                                    <div className={`transition-colors flex-shrink-0 ${isSelected ? 'text-slate-900 border-slate-300' : 'text-slate-400'}`}>
                                      <Icon icon={item.icon} width={18} />
                                    </div>
                                    <div className='flex flex-1 min-w-0 flex-col gap-0'>
                                      <span className={`text-[14px] font-semibold truncate ${isSelected ? 'text-slate-900' : 'text-slate-700'}`}>{item.label}</span>
                                      {item.description && (
                                        <span className={`text-[10px] truncate opacity-40 font-normal ${isSelected ? 'text-slate-500' : 'text-slate-400'}`}>
                                          {item.description}
                                        </span>
                                      )}
                                    </div>
                                    {isSelected && (
                                      <div className='flex items-center gap-1.5 px-2 py-0.5 rounded border border-slate-200 bg-white text-[9px] font-bold text-slate-400 shadow-xs uppercase tracking-tighter'>
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
                    })}
                  </div>
                ) : (
                  <div className='py-24 flex flex-col items-center justify-center text-slate-300 gap-4 opacity-40'>
                    <Icon icon='lucide:search' width={32} className='opacity-10' />
                    <p className='text-sm italic'>No results found</p>
                  </div>
                )}
              </ScrollShadow>

              {/* Footer */}
              <div className='px-8 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between text-[10px] text-slate-400 font-bold tracking-tight select-none'>
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
