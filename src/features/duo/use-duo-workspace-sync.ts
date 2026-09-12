import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ConversationState } from '@/features/conversations/types'
import { useWorkspaceStore } from '@/features/workspace/store/use-workspace-store'
import type { ProjectRecord, ProjectState } from '@/features/workspace/types'
import { normalizeFilePath } from '@/features/workspace/lib/workspace-paths'
import { readStoredDuoLayout, readStoredDuoProjects } from '@/features/persistence/renderer-state'
import { normalizeDuoLayout, normalizeDuoProjects } from '../../../electron/shared/contracts/duo-layout'
import { createDefaultDuoLayout, useDuoStore } from './duo-state'
import { loadDuoLayout, startDuoPersistence } from './duo-persistence'
import { migrateDuoProjectLayouts, scopeDuoLayout } from './duo-project-layouts'

export function useDuoWorkspaceSync({ isActive, initialized, bootstrapReady, conversationState, projectState, selectedProject = null, workspaceUnavailableMessage = null }: {
  isActive: boolean
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
    if (!bootstrapReady || !isActive) return
    if (!hydrated.current) {
      const saved = normalizeDuoProjects(readStoredDuoProjects())
      const migrationOwner = selectedProject ?? projectState.projects.find((project) => project.id === projectState.lastProjectId) ?? null
      useDuoStore.setState({ savedProjects: saved?.layouts ?? migrateDuoProjectLayouts(
        normalizeDuoLayout(readStoredDuoLayout()), projectState.projects, migrationOwner,
      ) })
      hydrated.current = true
    }
    if (pendingProjectId.current !== selectedProjectId) {
      pendingProjectId.current = selectedProjectId
      // Invalidate pending file opens before filesystem CWD changes.
      useDuoStore.setState((state) => ({ restoring: true, restoreError: null, scopeRevision: state.scopeRevision + 1 }))
    }
    const state = useDuoStore.getState()
    if (selectedProject && (!currentPath || normalizeFilePath(currentPath) !== normalizeFilePath(selectedProject.path))) {
      useDuoStore.setState({ restoring: true, restoreError: workspaceUnavailableMessage })
      return
    }
    if (state.initialized && (state.project?.id ?? null) === selectedProjectId) {
      useDuoStore.setState({ project: selectedProject, restoring: false, restoreError: null })
      return
    }
    if (!selectedProject) {
      useDuoStore.getState().switchProject(null, createDefaultDuoLayout())
      return
    }
    useDuoStore.setState({ restoreError: null })
    const cached = state.projectLayouts[selectedProject.id]
    if (cached) {
      state.switchProject(selectedProject, cached)
      return
    }
    const snapshot = state.savedProjects[selectedProject.id]
    if (!snapshot) {
      state.switchProject(selectedProject, createDefaultDuoLayout(selectedProject))
      return
    }
    let cancelled = false
    void loadDuoLayout(scopeDuoLayout(snapshot, selectedProject), window.appApi, projectState.projects, conversationState.conversations).then((restored) => {
      if (cancelled) return
      const workspace = useWorkspaceStore.getState()
      // Shared document buffers keep unsaved edits alive across project switches.
      const merged = new Map(workspace.openTabs.map((tab) => [tab.id, tab]))
      for (const document of restored.documents) if (!merged.has(document.id)) merged.set(document.id, document)
      workspace.replaceTabs([...merged.values()], workspace.activeTabId)
      useDuoStore.getState().switchProject(selectedProject, restored)
    }).catch((error) => {
      if (!cancelled) {
        console.error('[duo] Failed to restore project layout.', error)
        useDuoStore.setState({ restoreError: '无法恢复项目工作区，请重新选择项目。' })
      }
    })
    return () => { cancelled = true }
  }, [bootstrapReady, isActive, selectedProjectId, selectedProject, currentPath, projectState, conversationState, workspaceUnavailableMessage])

  useEffect(() => useWorkspaceStore.subscribe((next, previous) => {
    const duo = useDuoStore.getState()
    if (next.tabRenames !== previous.tabRenames) {
      for (const rename of next.tabRenames) duo.renameDocument(rename.from, rename.to)
    }
    if (!duo.initialized || duo.restoring || next.openTabs === previous.openTabs) return
    duo.reconcileDocuments(new Set(next.openTabs.map((tab) => tab.id)))
    const previousIds = new Set(previous.openTabs.map((tab) => tab.id))
    const renamedIds = new Set(next.tabRenames !== previous.tabRenames ? next.tabRenames.map((rename) => rename.to) : [])
    // Saved empty panes stay empty. Only subsequent new document opens are adopted.
    const opened = next.openTabs.filter((tab) => !previousIds.has(tab.id) && !renamedIds.has(tab.id)).map((tab) => tab.id)
    queueMicrotask(() => {
      const latest = useDuoStore.getState()
      if (latest.restoring || latest.scopeRevision !== duo.scopeRevision) return
      const workspace = useWorkspaceStore.getState()
      latest.adoptDocuments(opened.filter((id) => workspace.openTabs.some((tab) => tab.id === id)), workspace.activeTabId)
    })
  }), [])

  useEffect(() => {
    if (!initialized) return
    return startDuoPersistence()
  }, [initialized])
}
