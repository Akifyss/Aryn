import { create } from 'zustand'
import type { GitChangeScope, GitFileDiffResult } from '@/features/git/types'
import type { WorkspaceNode } from '@/features/workspace/types'
import {
  getSupportedWorkspaceEditorKind,
  normalizeWorkspaceFileViewMode,
  type LegacyWorkspaceFileViewMode,
  type SupportedWorkspaceEditorKind,
  type WorkspaceFileViewMode,
} from '@/features/workspace/lib/file-types'

export type WorkspaceFileTab = {
  content: string
  editorKind: SupportedWorkspaceEditorKind
  exists: boolean
  filePath: string
  gitDiffRequest?: WorkspaceFileGitDiffRequest | null
  id: string
  isDirty: boolean
  kind: 'file'
  savedContent: string
  viewMode: WorkspaceFileViewMode
}

export type WorkspaceFileGitDiffRequest = {
  lineNumber?: number
  mode: 'split' | 'unified'
  requestKey: string
  scope: GitChangeScope
  source: 'revision' | 'worktree'
}

export type WorkspaceDiffTab = {
  draftContent: string | null
  diff: GitFileDiffResult
  exists: true
  filePath: string
  id: string
  isDirty: boolean
  kind: 'diff'
  navigationRequest?: WorkspaceDiffNavigationRequest | null
  title: string
}

export type WorkspaceDiffNavigationRequest = {
  lineNumber: number
  requestKey: string
  source: 'revision' | 'worktree'
}

export type WorkspaceTab = WorkspaceFileTab | WorkspaceDiffTab

export type WorkspaceSettingsTab = {
  content: ''
  editorKind: 'prose'
  exists: true
  filePath: 'app://settings'
  id: 'app://settings'
  isDirty: false
  kind: 'settings'
  savedContent: ''
}

export type WorkspaceDisplayTab = WorkspaceTab | WorkspaceSettingsTab
export type TabDropPosition = 'before' | 'after'

type WorkspaceState = {
  activeTabId: string | null
  currentPath: string | null
  openTabs: WorkspaceTab[]
  tree: WorkspaceNode[]
  activateTab: (tabId: string) => void
  closeTab: (tabId: string) => void
  // File tabs are view instances over a shared per-file draft. These mutations
  // intentionally fan out to every open tab for the same file path.
  markFileTabsMissing: (path: string) => void
  markDiffTabSaved: (tabId: string, savedContent: string) => void
  markFileTabsSaved: (path: string, savedContent: string) => void
  moveTab: (movingId: string, targetId: string, position: TabDropPosition) => void
  openDiffTab: (tab: WorkspaceDiffTab, activate?: boolean) => void
  openTab: (tab: {
    content: string
    editorKind: SupportedWorkspaceEditorKind
    exists?: boolean
    filePath: string
    gitDiffRequest?: WorkspaceFileGitDiffRequest | null
    viewMode?: LegacyWorkspaceFileViewMode
  }) => void
  renameTab: (currentPath: string, nextPath: string) => void
  replaceTabs: (tabs: WorkspaceTab[], activeTabId: string | null) => void
  resetOpenTabs: () => void
  setCurrentPath: (path: string | null) => void
  setTree: (tree: WorkspaceNode[]) => void
  syncFileTabsWithDisk: (path: string, nextContent: string) => void
  updateDiffTabDraft: (tabId: string, draftContent: string | null) => void
  updateFileTabsContent: (path: string, content: string) => void
}

export function createWorkspaceFileTabId(filePath: string, viewMode: WorkspaceFileViewMode) {
  return `file://${viewMode}/${encodeURIComponent(filePath)}`
}

function isEditableWorkspaceFileViewMode(viewMode: WorkspaceFileViewMode) {
  return viewMode !== 'preview'
}

function getNextActiveTabId(openTabs: WorkspaceTab[], activeTabId: string | null, closingId: string) {
  if (activeTabId !== closingId) {
    return activeTabId
  }

  const closingIndex = openTabs.findIndex((tab) => tab.id === closingId)
  if (closingIndex === -1) {
    return activeTabId
  }

  const nextTabs = openTabs.filter((tab) => tab.id !== closingId)
  const nextActiveTab = nextTabs[closingIndex] ?? nextTabs[closingIndex - 1] ?? null

  return nextActiveTab?.id ?? null
}

function mergeDuplicateWorkspaceFileTabs(existingTab: WorkspaceFileTab, nextTab: WorkspaceFileTab): WorkspaceFileTab {
  return {
    ...existingTab,
    ...nextTab,
    exists: existingTab.exists || nextTab.exists,
    isDirty: existingTab.isDirty || nextTab.isDirty,
  }
}

export function dedupeWorkspaceTabs(tabs: WorkspaceTab[]) {
  const dedupedTabs: WorkspaceTab[] = []

  for (const tab of tabs) {
    const existingIndex = dedupedTabs.findIndex((candidate) => candidate.id === tab.id)

    if (existingIndex === -1) {
      dedupedTabs.push(tab)
      continue
    }

    const existingTab = dedupedTabs[existingIndex]

    if (existingTab.kind === 'file' && tab.kind === 'file') {
      dedupedTabs[existingIndex] = mergeDuplicateWorkspaceFileTabs(existingTab, tab)
    } else {
      dedupedTabs[existingIndex] = tab
    }
  }

  return dedupedTabs
}

function mergeWorkspaceDiffTab(existingTab: WorkspaceDiffTab, nextTab: WorkspaceDiffTab): WorkspaceDiffTab {
  const preservedDraftContent = existingTab.isDirty ? existingTab.draftContent : null
  const nextIsDirty = preservedDraftContent !== null && preservedDraftContent !== nextTab.diff.modifiedContent

  return {
    ...nextTab,
    draftContent: nextIsDirty ? preservedDraftContent : null,
    isDirty: nextIsDirty,
    navigationRequest: nextTab.navigationRequest ?? existingTab.navigationRequest ?? null,
  }
}

function mapWorkspaceFileTabsByPath(
  openTabs: WorkspaceTab[],
  path: string,
  mapTab: (tab: WorkspaceFileTab) => WorkspaceFileTab,
) {
  let didChange = false

  const nextTabs = openTabs.map((tab) => {
    if (tab.kind !== 'file' || tab.filePath !== path) {
      return tab
    }

    const nextTab = mapTab(tab)
    if (nextTab !== tab) {
      didChange = true
    }

    return nextTab
  })

  return { didChange, nextTabs }
}

export function reorderWorkspaceTabs(
  openTabs: WorkspaceTab[],
  movingId: string,
  targetId: string,
  position: TabDropPosition,
) {
  if (movingId === targetId) {
    return openTabs
  }

  const movingTab = openTabs.find((tab) => tab.id === movingId)
  if (!movingTab || !openTabs.some((tab) => tab.id === targetId)) {
    return openTabs
  }

  const remainingTabs = openTabs.filter((tab) => tab.id !== movingId)
  const targetIndex = remainingTabs.findIndex((tab) => tab.id === targetId)
  if (targetIndex === -1) {
    return openTabs
  }

  const insertionIndex = position === 'before' ? targetIndex : targetIndex + 1
  const nextTabs = [...remainingTabs]
  nextTabs.splice(insertionIndex, 0, movingTab)

  return nextTabs.every((tab, index) => tab === openTabs[index])
    ? openTabs
    : nextTabs
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeTabId: null,
  currentPath: null,
  openTabs: [],
  tree: [],
  activateTab: (activeTabId) => set((state) => (
    state.openTabs.some((tab) => tab.id === activeTabId)
      ? { activeTabId }
      : state
  )),
  closeTab: (id) => set((state) => ({
    activeTabId: getNextActiveTabId(state.openTabs, state.activeTabId, id),
    openTabs: state.openTabs.filter((tab) => tab.id !== id),
  })),
  markFileTabsMissing: (path) => set((state) => {
    const { didChange, nextTabs } = mapWorkspaceFileTabsByPath(state.openTabs, path, (tab) => (
      tab.exists ? { ...tab, exists: false } : tab
    ))

    return didChange ? { openTabs: nextTabs } : state
  }),
  markDiffTabSaved: (tabId, savedContent) => set((state) => {
    let didChange = false

    const openTabs = state.openTabs.map((tab) => {
      if (tab.kind !== 'diff' || tab.id !== tabId) {
        return tab
      }

      const nextTab = {
        ...tab,
        diff: {
          ...tab.diff,
          modifiedContent: savedContent,
        },
        draftContent: null,
        isDirty: false,
      }

      if (
        tab.diff.modifiedContent === nextTab.diff.modifiedContent
        && tab.draftContent === nextTab.draftContent
        && tab.isDirty === nextTab.isDirty
      ) {
        return tab
      }

      didChange = true
      return nextTab
    })

    return didChange ? { openTabs } : state
  }),
  markFileTabsSaved: (path, savedContent) => set((state) => {
    const { didChange, nextTabs } = mapWorkspaceFileTabsByPath(state.openTabs, path, (tab) => {
      const nextTab: WorkspaceFileTab = {
        ...tab,
        content: savedContent,
        exists: true,
        isDirty: false,
        savedContent,
      }

      if (
        tab.content === nextTab.content
        && tab.exists === nextTab.exists
        && tab.isDirty === nextTab.isDirty
        && tab.savedContent === nextTab.savedContent
      ) {
        return tab
      }

      return nextTab
    })

    return didChange ? { openTabs: nextTabs } : state
  }),
  moveTab: (movingId, targetId, position) => set((state) => {
    const nextTabs = reorderWorkspaceTabs(state.openTabs, movingId, targetId, position)

    return nextTabs === state.openTabs ? state : { openTabs: nextTabs }
  }),
  openTab: ({ content, editorKind, exists = true, filePath, gitDiffRequest, viewMode }) => set((state) => {
    const nextViewMode = normalizeWorkspaceFileViewMode(filePath, editorKind, viewMode)
    const tabId = createWorkspaceFileTabId(filePath, nextViewMode)
    const existingTab = state.openTabs.find((tab) => tab.id === tabId)
    const shouldUpdateGitDiffRequest = gitDiffRequest !== undefined

    if (existingTab) {
      return {
        activeTabId: tabId,
        openTabs: state.openTabs.map((tab) => (
          tab.kind === 'file' && tab.id === tabId
            ? {
              ...tab,
              editorKind,
              exists: tab.exists || exists,
              ...(shouldUpdateGitDiffRequest ? { gitDiffRequest } : null),
            }
            : tab
        )),
      }
    }

    return {
      activeTabId: tabId,
      openTabs: [
        ...state.openTabs,
        {
          content,
          editorKind,
          exists,
          filePath,
          ...(shouldUpdateGitDiffRequest ? { gitDiffRequest } : null),
          id: tabId,
          isDirty: false,
          kind: 'file',
          savedContent: content,
          viewMode: nextViewMode,
        },
      ],
    }
  }),
  openDiffTab: (tab, activate = true) => set((state) => {
    const existingIndex = state.openTabs.findIndex((candidate) => candidate.id === tab.id)
    const nextTabs = existingIndex === -1
      ? [...state.openTabs, tab]
      : state.openTabs.map((candidate, index) => {
        if (index !== existingIndex) {
          return candidate
        }

        return candidate.kind === 'diff'
          ? mergeWorkspaceDiffTab(candidate, tab)
          : tab
      })

    return {
      activeTabId: activate ? tab.id : state.activeTabId,
      openTabs: nextTabs,
    }
  }),
  renameTab: (currentPath, nextPath) => set((state) => {
    const renamedTabs = state.openTabs.map((tab) => {
      if (tab.kind !== 'file' || tab.filePath !== currentPath) {
        return tab
      }

      const nextEditorKind = getSupportedWorkspaceEditorKind(nextPath) ?? tab.editorKind
      const nextViewMode = normalizeWorkspaceFileViewMode(nextPath, nextEditorKind, tab.viewMode)

      return {
        ...tab,
        editorKind: nextEditorKind,
        exists: true,
        filePath: nextPath,
        id: createWorkspaceFileTabId(nextPath, nextViewMode),
        viewMode: nextViewMode,
      }
    })

    const nextTabs = dedupeWorkspaceTabs(renamedTabs)
    const nextActiveTabId = (() => {
      const activeTab = state.openTabs.find((tab) => tab.id === state.activeTabId)
      if (activeTab?.kind !== 'file' || activeTab.filePath !== currentPath) {
        return nextTabs.some((tab) => tab.id === state.activeTabId) ? state.activeTabId : nextTabs[0]?.id ?? null
      }

      const nextEditorKind = getSupportedWorkspaceEditorKind(nextPath) ?? activeTab.editorKind
      const nextViewMode = normalizeWorkspaceFileViewMode(nextPath, nextEditorKind, activeTab.viewMode)
      const requestedId = createWorkspaceFileTabId(nextPath, nextViewMode)

      return nextTabs.some((tab) => tab.id === requestedId) ? requestedId : nextTabs[0]?.id ?? null
    })()

    return {
      activeTabId: nextActiveTabId,
      openTabs: nextTabs,
    }
  }),
  replaceTabs: (openTabs, activeTabId) => set({ activeTabId, openTabs }),
  resetOpenTabs: () => set({ activeTabId: null, openTabs: [] }),
  setCurrentPath: (currentPath) => set({ currentPath }),
  setTree: (tree) => set({ tree }),
  syncFileTabsWithDisk: (path, nextContent) => set((state) => {
    const { didChange, nextTabs } = mapWorkspaceFileTabsByPath(state.openTabs, path, (tab) => {
      const nextTab: WorkspaceFileTab = {
        ...tab,
        content: nextContent,
        exists: true,
        isDirty: false,
        savedContent: nextContent,
      }

      if (
        tab.content === nextTab.content
        && tab.exists === nextTab.exists
        && tab.isDirty === nextTab.isDirty
        && tab.savedContent === nextTab.savedContent
      ) {
        return tab
      }

      return nextTab
    })

    return didChange ? { openTabs: nextTabs } : state
  }),
  updateDiffTabDraft: (tabId, draftContent) => set((state) => {
    let didChange = false

    const openTabs = state.openTabs.map((tab) => {
      if (tab.kind !== 'diff' || tab.id !== tabId) {
        return tab
      }

      const normalizedDraftContent = draftContent === null || draftContent === tab.diff.modifiedContent
        ? null
        : draftContent
      const nextIsDirty = normalizedDraftContent !== null

      if (tab.draftContent === normalizedDraftContent && tab.isDirty === nextIsDirty) {
        return tab
      }

      didChange = true
      return {
        ...tab,
        draftContent: normalizedDraftContent,
        isDirty: nextIsDirty,
      }
    })

    return didChange ? { openTabs } : state
  }),
  updateFileTabsContent: (path, content) => set((state) => {
    const { didChange, nextTabs } = mapWorkspaceFileTabsByPath(state.openTabs, path, (tab) => {
      const nextIsDirty = isEditableWorkspaceFileViewMode(tab.viewMode) && content !== tab.savedContent

      if (tab.content === content && tab.isDirty === nextIsDirty) {
        return tab
      }

      return {
        ...tab,
        content,
        isDirty: nextIsDirty,
      }
    })

    return didChange ? { openTabs: nextTabs } : state
  }),
}))
