import { normalizeWorkbenchLayout, type PersistedWorkbenchLayout, type PersistedWorkbenchTab } from '../../../electron/shared/contracts/workbench-layout'
import type { ProjectRecord } from '@/features/workspace/types'
import { normalizeFilePath } from '@/features/workspace/lib/workspace-paths'

// Keep legacyWorkspaceLayout as an archive. Only its first migration populates the
// project map, so closing every tab never makes an old layout reappear.
export function migrateWorkbenchProjectLayouts(legacy: PersistedWorkbenchLayout | undefined, projects: ProjectRecord[], selected: ProjectRecord | null) {
  if (!legacy || !selected) return {}
  const owner = (tab: PersistedWorkbenchTab) => {
    if (tab.kind === 'conversation') return tab.conversationId ? null : tab.projectId ?? selected.id
    if (tab.kind === 'panel') return null
    const root = tab.workspacePath ? normalizeFilePath(tab.workspacePath) : null
    const path = normalizeFilePath(tab.path)
    return projects.find((project) => normalizeFilePath(project.path) === root)?.id
      ?? [...projects].sort((a, b) => b.path.length - a.path.length).find((project) => {
        const prefix = normalizeFilePath(project.path).replace(/\/$/, '')
        return path === prefix || path.startsWith(`${prefix}/`)
      })?.id ?? selected.id
  }
  return Object.fromEntries(projects.flatMap((project) => {
    const ownsTabs = [legacy.panes.left, legacy.panes.right].some((pane) => pane.tabs.some((tab) => owner(tab) === project.id))
    if (project.id !== selected.id && !ownsTabs) return []
    const pane = (side: 'left' | 'right') => ({ ...legacy.panes[side], tabs: legacy.panes[side].tabs
      .filter((tab) => tab.kind === 'panel' ? tab.panel !== 'conversations' : owner(tab) === project.id)
      .map((tab) => tab.kind === 'conversation' ? { ...tab, projectId: project.id } : tab) })
    return [[project.id, normalizeWorkbenchLayout({ ...legacy, panes: { left: pane('left'), right: pane('right') } })!]]
  }))
}

export function scopeWorkbenchLayout(layout: PersistedWorkbenchLayout, project: ProjectRecord): PersistedWorkbenchLayout {
  const pane = (side: 'left' | 'right') => ({ ...layout.panes[side], tabs: layout.panes[side].tabs.filter((tab) =>
    tab.kind === 'conversation' ? !tab.conversationId && (!tab.projectId || tab.projectId === project.id)
      : tab.kind !== 'panel' || tab.panel !== 'conversations')
    .map((tab) => tab.kind === 'conversation' ? { ...tab, projectId: project.id } : tab) })
  return normalizeWorkbenchLayout({ ...layout, panes: { left: pane('left'), right: pane('right') } })!
}
