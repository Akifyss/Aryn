import React, { useEffect, useMemo, useState } from 'react'
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
  <span className={`px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-400 shadow-sm leading-none flex items-center justify-center min-w-[18px] ${className}`}>
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
            onOpenSession(session.path) // Path for sessions
            onClose()
          }
        })
      }
    })

    return all.slice(0, 50)
  }, [query, flattenedFiles, sessions, actions, onOpenFile, onOpenSession, onClose])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    if (!isOpen) {
      setQuery('')
    }
  }, [isOpen])

  // Global keyboard handling for absolute reliability
  useEffect(() => {
    if (!isOpen) return

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => (prev + 1) % Math.max(results.length, 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => (prev - 1 + results.length) % Math.max(results.length, 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const selected = results[selectedIndex]
        if (selected) {
          selected.onSelect()
        }
      } else if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [isOpen, results, selectedIndex, onClose])

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
          <Modal.Dialog className='command-palette-dialog p-0 m-0 relative w-full max-w-xl bg-white shadow-2xl rounded-2xl border border-slate-100 flex flex-col overflow-hidden outline-none'>
            <Modal.Body className='p-0 m-0'>
              {/* Refined Search Bar */}
              <div className='flex items-center px-6 py-4 gap-3 bg-white'>
                <Icon icon='lucide:search' className='text-slate-400' width={20} />
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder='Search...'
                  style={{ outline: 'none', boxShadow: 'none' }}
                  className='flex-1 bg-transparent border-none outline-none focus:outline-none focus:ring-0 text-lg text-slate-800 placeholder:text-slate-300 font-normal'
                />
                <div className='flex items-center gap-1 opacity-30 select-none'>
                   <Kbd className='bg-transparent border-none shadow-none text-xs text-slate-400 font-bold'>⌘</Kbd>
                   <Kbd className='bg-transparent border-none shadow-none text-xs text-slate-400 font-bold'>K</Kbd>
                </div>
              </div>

              <div className='h-px bg-slate-100' />

              {/* Compact Results List */}
              <ScrollShadow hideScrollBar className='max-h-[380px] overflow-y-auto px-1.5 py-4'>
                {results.length > 0 ? (
                  <div className='flex flex-col gap-5'>
                    {['action', 'file', 'session'].map(cat => {
                      const items = results.filter(i => i.category === cat)
                      if (items.length === 0) return null
                      const label = cat === 'action' ? 'Navigation' : cat === 'file' ? 'Files' : 'Sessions'
                      
                      return (
                        <div key={cat} className='flex flex-col gap-1 px-1'>
                          <header className='px-4 py-1 text-[9px] font-bold text-slate-400 uppercase tracking-[0.25em] opacity-80'>
                            {label}
                          </header>
                          <ListBox aria-label={label} variant='flat' className='p-0 gap-0'>
                            {items.map((item) => {
                              const globalIndex = results.findIndex(i => i.id === item.id)
                              const isSelected = globalIndex === selectedIndex

                              return (
                                <ListBoxItem
                                  key={item.id}
                                  textValue={item.label}
                                  onPress={() => item.onSelect()}
                                  className={`rounded-lg px-4 py-2 transition-all ${isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                                >
                                  <div className='flex items-center gap-3 w-full'>
                                    <div className={`p-1 transition-colors ${isSelected ? 'text-slate-900' : 'text-slate-400'}`}>
                                      <Icon icon={item.icon} width={18} />
                                    </div>
                                    <div className='flex flex-1 min-w-0 flex-col'>
                                      <span className={`text-[13px] font-medium truncate ${isSelected ? 'text-slate-900' : 'text-slate-700'}`}>{item.label}</span>
                                      {item.description && (
                                        <span className={`text-[10px] truncate opacity-40 font-normal ${isSelected ? 'text-slate-500' : 'text-slate-400'}`}>
                                          {item.description}
                                        </span>
                                      )}
                                    </div>
                                    {isSelected && (
                                      <CustomKbd className="opacity-60">Enter</CustomKbd>
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
                  <div className='py-20 flex flex-col items-center justify-center text-slate-300 gap-3 opacity-40'>
                    <Icon icon='lucide:search' width={32} className='opacity-10' />
                    <p className='text-xs font-medium'>Nothing for "{query}"</p>
                  </div>
                )}
              </ScrollShadow>

              {/* Tighter Footer Toolbar */}
              <div className='px-6 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between text-[10px] text-slate-400 font-medium select-none'>
                <div className='flex items-center gap-6'>
                  <div className='flex items-center gap-2'>
                    <div className='flex gap-1'>
                      <CustomKbd><Icon icon='lucide:arrow-up' width={8} /></CustomKbd>
                      <CustomKbd><Icon icon='lucide:arrow-down' width={8} /></CustomKbd>
                    </div>
                    <span>NAVIGATE</span>
                  </div>
                  <div className='flex items-center gap-2'>
                    <CustomKbd>ENTER</CustomKbd>
                    <span>SELECT</span>
                  </div>
                </div>
                <div className='flex items-center gap-2'>
                  <CustomKbd>ESC</CustomKbd>
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
