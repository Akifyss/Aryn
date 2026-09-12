import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { WorkspaceFileSystemPanel } from '@/features/workspace/components/workspace-file-system-panel/workspace-file-system-panel'
import { WorkspaceGitPane } from '@/features/workspace/components/workspace-workbench/workspace-navigation-panels'
import type { WorkspaceFileSystemState } from '@/features/workspace/types'
import type { DuoPaneCommands, DuoPaneConfiguration } from './duo-pane'
import { createDuoDocumentNavigation } from './duo-document-navigation'
import { createDuoPanelNavigation } from './duo-panel-navigation'
import { DUO_FILES_ID, DUO_GIT_ID, DUO_PANE_IDS, getDuoProjectTabs, useDuoStore, type DuoPaneId, type DuoTab } from './duo-state'

type PanelTab = Extract<DuoTab, { kind: 'panel' }>
type Commands = RefObject<Partial<Record<DuoPaneId, DuoPaneCommands>>>
const emptyFileSystem = (): WorkspaceFileSystemState => ({ navigation: null, selectedPath: null, view: 'list' })

function panelDescendants(root: Element | ShadowRoot): HTMLElement[] {
  // The file browser's list is a Pierre tree inside an open shadow root.
  return [...root.querySelectorAll<HTMLElement>('*')].flatMap(node => [node, ...(node.shadowRoot ? panelDescendants(node.shadowRoot) : [])])
}

function containsPanelNode(container: HTMLElement, node: HTMLElement) {
  let current: Node | null = node
  while (current) {
    if (container.contains(current)) return true
    const root = current.getRootNode()
    current = root instanceof ShadowRoot ? root.host : null
  }
  return false
}

function PanelMount({ pane, tab, visible, currentProject, configuration, commands }: {
  pane: DuoPaneId
  tab: PanelTab
  visible: boolean
  currentProject: boolean
  configuration: DuoPaneConfiguration
  commands: Commands
}) {
  // Hidden projects keep their own inputs; the next project's root/repository
  // must never reset a retained file browser or Git history instance.
  const retainedConfiguration = useRef(configuration)
  if (currentProject) retainedConfiguration.current = configuration
  configuration = retainedConfiguration.current
  const [fileSystem, setFileSystem] = useState(emptyFileSystem)
  const root = configuration.editor.editorContent.workspacePath
  const previousRoot = useRef(root)
  useEffect(() => {
    if (previousRoot.current === root) return
    previousRoot.current = root
    setFileSystem(emptyFileSystem())
  }, [root])
  const [container] = useState(() => typeof document === 'undefined' ? null : document.createElement('div'))
  const previousPane = useRef(pane)
  const lastFocused = useRef<HTMLElement | null>(null)
  const scroll = useRef<{ node: HTMLElement; top: number; left: number }[]>([])

  useLayoutEffect(() => {
    const host = commands.current[pane]?.panelHost.current
    if (!container || !host) return
    const moved = previousPane.current !== pane
    previousPane.current = pane
    const wasHidden = container.hidden
    const reparent = container.parentElement !== host
    if ((moved || !visible || reparent) && !wasHidden && container.isConnected) {
      scroll.current = [container, ...panelDescendants(container)]
        .filter(node => node.scrollTop || node.scrollLeft)
        .map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }))
    }
    container.className = 'duo-panel-view'
    container.dataset.panelTabId = tab.id
    container.tabIndex = -1
    container.hidden = !visible
    container.inert = !visible
    if (reparent) {
      const destination = host as HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void }
      if (destination.moveBefore && container.isConnected) destination.moveBefore(container, null)
      else host.appendChild(container)
    }
    const state = useDuoStore.getState()
    if (moved && visible && !state.restoring && state.focusedPane === pane) {
      const focused = lastFocused.current
      commands.current[pane]?.focus()
      container.focus({ preventScroll: true })
      if (focused && containsPanelNode(container, focused)) focused.focus({ preventScroll: true })
    }
    if (visible && (moved || wasHidden)) {
      scroll.current.forEach(({ node, top, left }) => { node.scrollTop = top; node.scrollLeft = left })
    }
  })
  useLayoutEffect(() => () => { container?.remove() }, [container])
  if (!container) return null
  const navigation = createDuoDocumentNavigation(pane, configuration.documentNavigation, root, configuration.refreshGitState)
  return createPortal(
    <div className='duo-panel-content'
      onPointerDownCapture={() => commands.current[pane]?.focus()}
      onFocusCapture={event => {
        lastFocused.current = event.nativeEvent.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement)
          ?? event.target as HTMLElement
        commands.current[pane]?.focus()
      }}>
      {tab.id === DUO_FILES_ID ? <WorkspaceFileSystemPanel
        {...configuration.editor.fileSystemPanel}
        fileSystemState={fileSystem}
        onFileSystemViewChange={view => setFileSystem(state => ({ ...state, view }))}
        onFileSystemNavigationChange={navigation => setFileSystem(state => ({ ...state, navigation }))}
        onFileSystemSelectionChange={selectedPath => setFileSystem(state => ({ ...state, selectedPath }))}
        onOpenFile={navigation.openFile}
      /> : <WorkspaceGitPane configuration={createDuoPanelNavigation(pane, configuration)} />}
    </div>, container,
  )
}

export function DuoPanelLayer({ configuration, commands }: { configuration: DuoPaneConfiguration; commands: Commands }) {
  const state = useDuoStore()
  // Tab objects are stable across activate/reorder/move. Unlike the resource ID
  // (which can exist in both panes), they identify each independent live view.
  // Moving onto a duplicate transfers the source object and disposes the peer.
  const keys = useRef(new Map<string, WeakMap<PanelTab, string>>())
  const nextKey = useRef(0)
  const layouts = [state, ...Object.values(state.projectLayouts).filter(layout => layout.project.id !== state.project?.id)]
  const mounts = layouts.flatMap((layout, index) => {
    const projectId = layout.project?.id ?? ''
    let projectKeys = keys.current.get(projectId)
    if (!projectKeys) { projectKeys = new WeakMap(); keys.current.set(projectId, projectKeys) }
    return DUO_PANE_IDS.flatMap(pane => {
      const tabs = getDuoProjectTabs(layout.panes[pane].tabs, layout.project)
      const activeId = tabs.some(tab => tab.id === layout.panes[pane].activeTabId)
        ? layout.panes[pane].activeTabId : tabs[0]?.id
      return tabs.flatMap(tab => {
        if (tab.kind !== 'panel' || (tab.id !== DUO_FILES_ID && tab.id !== DUO_GIT_ID)) return []
        const visible = index === 0 && activeId === tab.id
        let key = projectKeys.get(tab)
        // Mount on first use, retain while hidden, and unmount only on close or
        // replacement. Restored background tabs should not start loading eagerly.
        if (!key && !visible) return []
        if (!key) { key = String(++nextKey.current); projectKeys.set(tab, key) }
        return <PanelMount key={key} tab={tab} pane={pane} visible={visible} currentProject={index === 0}
          configuration={configuration} commands={commands} />
      })
    })
  })
  // Keep React's order stable as well as its keys. Switching projects or
  // moving tabs only reparents portal containers, never their React fibers.
  return mounts.sort((left, right) => Number(left.key) - Number(right.key))
}
