import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { DuoConversationView } from './duo-conversations'
import { createDuoDocumentNavigation } from './duo-document-navigation'
import type { DuoPaneCommands, DuoPaneConfiguration } from './duo-pane'
import { DUO_PANE_IDS, getDuoProjectTabs, useDuoStore, type DuoPaneId, type DuoTab } from './duo-state'

export type DuoConversationHandle = {
  capture: () => void
  canClose: () => Promise<boolean>
}
type Commands = RefObject<Partial<Record<DuoPaneId, DuoPaneCommands>>>
type ConversationTab = Extract<DuoTab, { kind: 'conversation' }>

function captureView(container: HTMLElement) {
  const selection = window.getSelection()
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i))
    .filter(range => container.contains(range.commonAncestorContainer)).map(range => ({
      start: range.startContainer, startOffset: range.startOffset,
      end: range.endContainer, endOffset: range.endOffset,
    })) : []
  return {
    ranges,
    focused: container.contains(document.activeElement) ? document.activeElement as HTMLElement : null,
    scroll: [container, ...container.querySelectorAll<HTMLElement>('*')]
      .filter(node => node.scrollTop || node.scrollLeft)
      .map(node => ({ node, top: node.scrollTop, left: node.scrollLeft })),
  }
}

function ConversationMount({ pane, tab, visible, publishWorkspaceState, configuration, commands }: {
  pane: DuoPaneId
  tab: ConversationTab
  visible: boolean
  publishWorkspaceState: boolean
  configuration: DuoPaneConfiguration
  commands: Commands
}) {
  // A portal's target never changes. React therefore keeps the same provider,
  // composer, subscriptions and timeline even when its DOM moves between panes.
  const [container] = useState(() => typeof document === 'undefined' ? null : document.createElement('div'))
  const previousPane = useRef(pane)
  const snapshot = useRef<ReturnType<typeof captureView> | null>(null)
  const closeGuard = useRef<() => Promise<boolean>>(async () => false)
  useLayoutEffect(() => {
    commands.current[pane]?.registerConversation(tab.id, {
      capture: () => { if (container) snapshot.current = captureView(container) },
      canClose: () => closeGuard.current(),
    })
    return () => commands.current[pane]?.registerConversation(tab.id, null)
  }, [commands, pane, tab.id, container])
  useLayoutEffect(() => {
    const host = commands.current[pane]?.conversationHost.current
    if (!container || !host) return
    const moved = previousPane.current !== pane
    previousPane.current = pane
    // Store-driven moves (such as a directory row's direction action) also
    // preserve the current view, before reparenting its DOM below.
    const view = snapshot.current ?? (moved ? captureView(container) : null)
    snapshot.current = null
    container.className = 'duo-conversation-view'
    container.dataset.conversationTabId = tab.id
    container.hidden = !visible
    container.inert = !visible
    if (container.parentElement !== host) {
      // Chromium's state-preserving move also retains embedded media/focus.
      // appendChild is the fallback for older hosts; restore selection/scroll below.
      const destination = host as HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void }
      if (destination.moveBefore && container.isConnected) destination.moveBefore(container, null)
      else host.appendChild(container)
    }
    const state = useDuoStore.getState()
    if (moved && visible && !state.restoring && state.focusedPane === pane) {
      const focusTarget = view?.focused ?? container.querySelector<HTMLElement>('.agent-composer-editor, [contenteditable="true"], textarea, input')
      if (focusTarget) focusTarget.focus({ preventScroll: true })
      else host.closest('.duo-pane')?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true })
      if (view?.ranges.length) {
        const selection = window.getSelection()
        selection?.removeAllRanges()
        // DOM Range objects are live and can collapse when their ancestor moves.
        // Rebuild them from the retained text nodes after attaching the container.
        view.ranges.forEach(({ start, startOffset, end, endOffset }) => {
          if (!container.contains(start) || !container.contains(end)) return
          const range = document.createRange()
          range.setStart(start, startOffset); range.setEnd(end, endOffset)
          selection?.addRange(range)
        })
      }
    }
    view?.scroll.forEach(({ node, top, left }) => { node.scrollTop = top; node.scrollLeft = left })
  })
  useLayoutEffect(() => () => { container?.remove() }, [container])
  if (!container) return null
  const focus = () => commands.current[pane]?.focus()
  const navigation = createDuoDocumentNavigation(pane, configuration.documentNavigation,
    tab.projectSession?.project.path ?? null, configuration.refreshGitState)
  return createPortal(
    <div className='duo-conversation-content' onPointerDownCapture={focus} onFocusCapture={focus}>
      <DuoConversationView pane={pane} tab={tab} configuration={configuration.conversations}
        publishWorkspaceState={publishWorkspaceState}
        registerCloseGuard={guard => { closeGuard.current = guard }}
        confirmClose={configuration.confirmCloseConversation}
        onOpenFile={(path, root) => { void navigation.openFile(path, root) }} />
    </div>, container,
  )
}

export function DuoConversationLayer({ configuration, commands }: { configuration: DuoPaneConfiguration; commands: Commands }) {
  const state = useDuoStore()
  const seen = new Set<string>()
  const layouts = [state, ...Object.values(state.projectLayouts).filter(layout => layout.project.id !== state.project?.id)]
  // Publish one foreground runtime; retained/background providers must never
  // replace the command palette/settings state with another project's session.
  const paneOrder = [state.focusedPane, ...DUO_PANE_IDS.filter(pane => pane !== state.focusedPane)]
  const sourceTabId = paneOrder.map(pane => state.panes[pane].tabs.find(tab =>
    tab.kind === 'conversation' && tab.id === state.panes[pane].activeTabId
      && tab.projectSession?.project.id === configuration.conversations.selectedProject?.id,
  )?.id).find(Boolean)
  return layouts.flatMap((layout, index) => DUO_PANE_IDS.flatMap(pane => layout.panes[pane].tabs.flatMap(tab => {
    if (tab.kind !== 'conversation' || !tab.projectSession || seen.has(tab.id)) return []
    seen.add(tab.id)
    const projectTabs = getDuoProjectTabs(layout.panes[pane].tabs, configuration.conversations.selectedProject)
    const selectedTabId = projectTabs.some(item => item.id === layout.panes[pane].activeTabId)
      ? layout.panes[pane].activeTabId : projectTabs[0]?.id
    const visible = index === 0 && selectedTabId === tab.id
      && configuration.conversations.selectedProject?.id === tab.projectSession.project.id
    return <ConversationMount key={tab.id} pane={pane} tab={tab} visible={visible}
      publishWorkspaceState={visible && tab.id === sourceTabId} configuration={configuration} commands={commands} />
  })))
}
