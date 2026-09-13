import { lazy, Suspense, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { WorkbenchPaneCommands } from './workbench-pane'
import { WORKBENCH_PANE_IDS, getWorkbenchProjectTabs, useWorkbenchStore, type WorkbenchPaneId, type WorkbenchTab } from './workbench-state'

const TerminalView = lazy(() => import('@/features/terminal/terminal-view').then(module => ({ default: module.TerminalView })))
type TerminalTab = Extract<WorkbenchTab, { kind: 'terminal' }>
type Commands = RefObject<Partial<Record<WorkbenchPaneId, WorkbenchPaneCommands>>>

function TerminalMount({ pane, tab, visible, focused, commands }: {
  pane: WorkbenchPaneId; tab: TerminalTab; visible: boolean; focused: boolean; commands: Commands
}) {
  const [container] = useState(() => typeof document === 'undefined' ? null : document.createElement('div'))
  useLayoutEffect(() => {
    const host = commands.current[pane]?.terminalHost.current
    if (!container || !host) return
    container.className = 'workbench-terminal-view'
    container.hidden = !visible
    container.inert = !visible
    if (container.parentElement !== host) {
      const target = host as HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void }
      if (target.moveBefore && container.isConnected) target.moveBefore(container, null)
      else host.appendChild(container)
    }
  })
  useLayoutEffect(() => () => { container?.remove() }, [container])
  if (!container) return null
  return createPortal(<div className='terminal-surface' onPointerDownCapture={() => commands.current[pane]?.focus()}
    onFocusCapture={() => commands.current[pane]?.focus()}>
    <Suspense fallback={null}>
      <TerminalView id={tab.id} projectId={tab.projectId} visible={visible} focused={focused} />
    </Suspense>
  </div>, container)
}

export function WorkbenchTerminalLayer({ commands }: { commands: Commands }) {
  const state = useWorkbenchStore()
  const mounted = useRef(new Map<string, number>())
  const next = useRef(0)
  const present = new Set<string>()
  const layouts = [state, ...Object.values(state.projectLayouts).filter(layout => layout.project.id !== state.project?.id)]
  const views = layouts.flatMap((layout, index) => WORKBENCH_PANE_IDS.flatMap(pane => {
    const tabs = getWorkbenchProjectTabs(layout.panes[pane].tabs, layout.project)
    return tabs.flatMap(tab => {
      if (tab.kind !== 'terminal') return []
      const identity = JSON.stringify([tab.projectId, tab.id])
      present.add(identity)
      const visible = index === 0 && (tabs.some(item => item.id === layout.panes[pane].activeTabId)
        ? layout.panes[pane].activeTabId : tabs[0]?.id) === tab.id
      let key = mounted.current.get(identity)
      if (!key && !visible) return [] // Restored background tabs start only when opened.
      if (!key) { key = ++next.current; mounted.current.set(identity, key) }
      return <TerminalMount key={key} tab={tab} pane={pane} visible={visible} focused={state.focusedPane === pane} commands={commands} />
    })
  }))
  for (const identity of mounted.current.keys()) if (!present.has(identity)) mounted.current.delete(identity)
  return views.sort((a, b) => Number(a.key) - Number(b.key))
}
