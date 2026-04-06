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
  category: 'file' | 'session' | 'action'
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
          onSelect: action.onSelect
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
          onSelect: () => onOpenFile(file.path)
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
          onSelect: () => onOpenSession(session.path)
        })
      }
    })

    return all.slice(0, 50)
  }, [query, flattenedFiles, sessions, actions, onOpenFile, onOpenSession])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    if (!isOpen) {
      setQuery('')
    }
  }, [isOpen])

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
        onClose()
      }
    }
  }

  // EXACT REPLICATION OF SETTINGS MODAL STRUCTURE (COMPOSITE API)
  // This structure is proven to work in the current app's shell.
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
          <Modal.Dialog className='command-palette-dialog p-0 m-0 relative w-full max-w-2xl bg-white shadow-2xl rounded-2xl border border-slate-100 flex flex-col overflow-hidden outline-none'>
            <Modal.Body className='p-0 m-0'>
              {/* Premium Light Search Bar */}
              <div className='flex items-center px-8 py-6 gap-4 bg-slate-50/30'>
                <Icon icon='lucide:search' className='text-slate-400' width={24} />
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder='Search apps, files, sessions...'
                  style={{ outline: 'none', boxShadow: 'none' }}
                  className='flex-1 bg-transparent border-none outline-none focus:outline-none focus:ring-0 text-xl text-slate-900 placeholder:text-slate-300 font-light'
                />
                <div className='flex items-center gap-1.5 opacity-30 select-none'>
                   <Kbd className='bg-transparent border-none shadow-none text-xs text-slate-400 font-bold'>⌘</Kbd>
                   <Kbd className='bg-transparent border-none shadow-none text-xs text-slate-400 font-bold'>K</Kbd>
                </div>
              </div>

              <div className='h-px bg-slate-100' />

              {/* Results List Area */}
              <ScrollShadow hideScrollBar className='max-h-[min(65vh,520px)] overflow-y-auto px-4 py-5'>
                {results.length > 0 ? (
                  <div className='flex flex-col gap-7'>
                    {['action', 'file', 'session'].map(cat => {
                      const items = results.filter(i => i.category === cat)
                      if (items.length === 0) return null
                      const label = cat === 'action' ? 'Actions' : cat === 'file' ? 'Recent Files' : 'Active Sessions'
                      
                      return (
                        <div key={cat} className='flex flex-col gap-2'>
                          <header className='px-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] opacity-80'>
                            {label}
                          </header>
                          <ListBox aria-label={label} variant='flat' className='p-0 gap-0.5'>
                            {items.map((item) => {
                              const globalIndex = results.findIndex(i => i.id === item.id)
                              const isSelected = globalIndex === selectedIndex

                              return (
                                <ListBoxItem
                                  key={item.id}
                                  textValue={item.label}
                                  onPress={() => {
                                    item.onSelect()
                                    onClose()
                                  }}
                                  className={`rounded-xl px-4 py-4 transition-all duration-150 ${isSelected ? 'bg-slate-100 shadow-sm' : 'hover:bg-slate-50'}`}
                                >
                                  <div className='flex items-center gap-4 w-full'>
                                    <div className={`p-1.5 transition-colors ${isSelected ? 'text-slate-900 scale-105' : 'text-slate-400'}`}>
                                      <Icon icon={item.icon} width={22} />
                                    </div>
                                    <div className='flex flex-1 min-w-0 flex-col gap-0.5'>
                                      <span className={`text-[15px] font-semibold truncate ${isSelected ? 'text-slate-900' : 'text-slate-700'}`}>{item.label}</span>
                                      {item.description && (
                                        <span className={`text-[11px] truncate opacity-40 font-normal ${isSelected ? 'text-slate-500' : 'text-slate-400'}`}>
                                          {item.description}
                                        </span>
                                      )}
                                    </div>
                                    {isSelected && (
                                      <div className='flex items-center gap-2 px-3 py-1 rounded bg-white border border-slate-200 text-[10px] font-bold text-slate-400 shadow-sm animate-in fade-in zoom-in-95'>
                                        <span>ENTER</span>
                                        <Icon icon='lucide:corner-down-left' width={12} />
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
                  <div className='py-28 flex flex-col items-center justify-center text-slate-300 gap-4 opacity-40'>
                    <Icon icon='lucide:search' width={48} className='opacity-10' />
                    <p className='text-base font-medium tracking-wide'>No results found</p>
                  </div>
                )}
              </ScrollShadow>

              {/* Modern Minimal Footer */}
              <div className='px-8 py-5 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between text-[11px] text-slate-400 font-bold tracking-tight'>
                <div className='flex items-center gap-10'>
                  <div className='flex items-center gap-3'>
                    <div className='flex gap-1'>
                      <CustomKbd><Icon icon='lucide:arrow-up' width={10} /></CustomKbd>
                      <CustomKbd><Icon icon='lucide:arrow-down' width={10} /></CustomKbd>
                    </div>
                    <span className='opacity-60'>NAVIGATE</span>
                  </div>
                  <div className='flex items-center gap-3'>
                    <CustomKbd className='min-w-[48px]'>ENTER</CustomKbd>
                    <span className='opacity-60'>SELECT</span>
                  </div>
                </div>
                <div className='flex items-center gap-4'>
                  <div className='flex items-center gap-3'>
                    <CustomKbd className='min-w-[36px]'>ESC</CustomKbd>
                    <span className='opacity-60'>CLOSE</span>
                  </div>
                </div>
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
