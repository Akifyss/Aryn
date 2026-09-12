import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ConversationState } from '@/features/conversations/types'
import { useWorkspaceStore } from '@/features/workspace/store/use-workspace-store'
import type { ProjectRecord, ProjectState } from '@/features/workspace/types'
import { normalizeFilePath } from '@/features/workspace/lib/workspace-paths'
import { readStoredLegacyWorkspaceLayout, readStoredProjectWorkspaces } from '@/features/persistence/renderer-state'
import { normalizeWorkbenchLayout, normalizeProjectWorkspaces } from '../../../electron/shared/contracts/workbench-layout'
import { createDefaultWorkbenchLayout, useWorkbenchStore } from './workbench-state'
import { loadWorkbenchLayout, startWorkbenchPersistence } from './workbench-persistence'
import { migrateWorkbenchProjectLayouts, scopeWorkbenchLayout } from './workbench-project-layouts'

export function useProjectWorkspaceSync({ initialized, bootstrapReady, conversationState, projectState, selectedProject = null, workspaceUnavailableMessage = null }: {
  initialized: boolean
  bootstrapReady: boolean
  conversationState: ConversationState
  projectState: ProjectState
  selectedProject?: ProjectRecord | null
  workspaceUnavailableMessage?: string | null
}) {
  const hydrated = useRef(false)
  const pendingProjectId = useRef<string | null | undefined>(undefined)
  const currentPath = useWorkspaceStore((state) => state.currentPath)
  const selectedProjectId = selectedProject?.id ?? null

  useLayoutEffect(() => {
    if (!bootstrapReady) return
    if (!hydrated.current) {
      const saved = normalizeProjectWorkspaces(readStoredProjectWorkspaces())
      const migrationOwner = selectedProject ?? projectState.projects.find((project) => project.id === projectState.lastProjectId) ?? null
      useWorkbenchStore.setState({ savedProjects: saved?.layouts ?? migrateWorkbenchProjectLayouts(
        normalizeWorkbenchLayout(readStoredLegacyWorkspaceLayout()), projectState.projects, migrationOwner,
      ) })
      hydrated.current = true
    }
    if (pendingProjectId.current !== selectedProjectId) {
      pendingProjectId.current = selectedProjectId
      // Invalidate pending file opens before filesystem CWD changes.
      useWorkbenchStore.setState((state) => ({ restoring: true, restoreError: null, scopeRevision: state.scopeRevision + 1 }))
    }
    const state = useWorkbenchStore.getState()
    if (selectedProject && (!currentPath || normalizeFilePath(currentPath) !== normalizeFilePath(selectedProject.path))) {
      useWorkbenchStore.setState({ restoring: true, restoreError: workspaceUnavailableMessage })
      return
    }
    if (state.initialized && (state.project?.id ?? null) === selectedProjectId) {
      useWorkbenchStore.setState({ project: selectedProject, restoring: false, restoreError: null })
      return
    }
    if (!selectedProject) {
      useWorkbenchStore.getState().switchProject(null, createDefaultWorkbenchLayout())
      return
    }
    useWorkbenchStore.setState({ restoreError: null })
    const cached = state.projectLayouts[selectedProject.id]
    if (cached) {
      state.switchProject(selectedProject, cached)
      return
    }
    const snapshot = state.savedProjects[selectedProject.id]
    if (!snapshot) {
      state.switchProject(selectedProject, createDefaultWorkbenchLayout(selectedProject))
      return
    }
    let cancelled = false
    void loadWorkbenchLayout(scopeWorkbenchLayout(snapshot, selectedProject), window.appApi, projectState.projects, conversationState.conversations).then((restored) => {
      if (cancelled) return
      const workspace = useWorkspaceStore.getState()
      // Shared document buffers keep unsaved edits alive across project switches.
      const merged = new Map(workspace.openTabs.map((tab) => [tab.id, tab]))
      for (const document of restored.documents) if (!merged.has(document.id)) merged.set(document.id, document)
      workspace.replaceTabs([...merged.values()], workspace.activeTabId)
      useWorkbenchStore.getState().switchProject(selectedProject, restored)
    }).catch((error) => {
      if (!cancelled) {
        console.error('[workbench] Failed to restore project layout.', error)
        useWorkbenchStore.setState({ restoreError: '无法恢复项目工作区，请重新选择项目。' })
      }
    })
    return () => { cancelled = true }
  }, [bootstrapReady, selectedProjectId, selectedProject, currentPath, projectState, conversationState, workspaceUnavailableMessage])

  useEffect(() => useWorkspaceStore.subscribe((next, previous) => {
    const workbench = useWorkbenchStore.getState()
    if (next.tabRenames !== previous.tabRenames) {
      for (const rename of next.tabRenames) workbench.renameDocument(rename.from, rename.to)
    }
    if (!workbench.initialized || workbench.restoring || next.openTabs === previous.openTabs) return
    workbench.reconcileDocuments(new Set(next.openTabs.map((tab) => tab.id)))
    const previousIds = new Set(previous.openTabs.map((tab) => tab.id))
    const renamedIds = new Set(next.tabRenames !== previous.tabRenames ? next.tabRenames.map((rename) => rename.to) : [])
    // Saved empty panes stay empty. Only subsequent new document opens are adopted.
    const opened = next.openTabs.filter((tab) => !previousIds.has(tab.id) && !renamedIds.has(tab.id)).map((tab) => tab.id)
    queueMicrotask(() => {
      const latest = useWorkbenchStore.getState()
      if (latest.restoring || latest.scopeRevision !== workbench.scopeRevision) return
      const workspace = useWorkspaceStore.getState()
      latest.adoptDocuments(opened.filter((id) => workspace.openTabs.some((tab) => tab.id === id)), workspace.activeTabId)
    })
  }), [])

  useEffect(() => {
    if (!initialized) return
    return startWorkbenchPersistence()
  }, [initialized])
}
