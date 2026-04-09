import { create } from 'zustand'
import type { GitFileDiffResult } from '@/features/git/types'
import type { WorkspaceNode } from '@/features/workspace/types'
import {
  getDefaultWorkspaceFileViewMode,
  getSupportedWorkspaceEditorKind,
  supportsHtmlPreview,
  type SupportedWorkspaceEditorKind,
  type WorkspaceFileViewMode,
} from '@/features/workspace/lib/file-types'

export type WorkspaceFileTab = {
  content: string
  editorKind: SupportedWorkspaceEditorKind
  exists: boolean
  filePath: string
  isDirty: boolean
  kind: 'file'
  savedContent: string
  viewMode: WorkspaceFileViewMode
}

export type WorkspaceDiffTab = {
  diff: GitFileDiffResult
  exists: true
  filePath: string
  isDirty: false
  kind: 'diff'
  title: string
}

export type WorkspaceTab = WorkspaceFileTab | WorkspaceDiffTab

export type WorkspaceSettingsTab = {
  content: ''
  editorKind: 'rich-text'
  exists: true
  filePath: 'app://settings'
  isDirty: false
  kind: 'settings'
  savedContent: ''
}

export type WorkspaceDisplayTab = WorkspaceTab | WorkspaceSettingsTab
export type TabDropPosition = 'before' | 'after'

type WorkspaceState = {
  activeTabPath: string | null
  currentPath: string | null
  openTabs: WorkspaceTab[]
  tree: WorkspaceNode[]
  activateTab: (path: string) => void
  closeTab: (path: string) => void
  markTabMissing: (path: string) => void
  markTabSaved: (path: string, savedContent: string) => void
  moveTab: (movingPath: string, targetPath: string, position: TabDropPosition) => void
  openDiffTab: (tab: WorkspaceDiffTab, activate?: boolean) => void
  openTab: (tab: { content: string, editorKind: SupportedWorkspaceEditorKind, filePath: string, viewMode?: WorkspaceFileViewMode }) => void
  renameTab: (currentPath: string, nextPath: string) => void
  replaceTabs: (tabs: WorkspaceTab[], activeTabPath: string | null) => void
  resetOpenTabs: () => void
  setCurrentPath: (path: string | null) => void
  setTabViewMode: (path: string, viewMode: WorkspaceFileViewMode) => void
  setTree: (tree: WorkspaceNode[]) => void
  syncTabWithDisk: (path: string, nextContent: string) => void
  updateTabContent: (path: string, content: string) => void
}

function getNextActiveTabPath(openTabs: WorkspaceTab[], activeTabPath: string | null, closingPath: string) {
  if (activeTabPath !== closingPath) {
    return activeTabPath
  }

  const closingIndex = openTabs.findIndex((tab) => tab.filePath === closingPath)
  if (closingIndex === -1) {
    return activeTabPath
  }

  const nextTabs = openTabs.filter((tab) => tab.filePath !== closingPath)
  const nextActiveTab = nextTabs[closingIndex] ?? nextTabs[closingIndex - 1] ?? null

  return nextActiveTab?.filePath ?? null
}

export function reorderWorkspaceTabs(
  openTabs: WorkspaceTab[],
  movingPath: string,
  targetPath: string,
  position: TabDropPosition,
) {
  if (movingPath === targetPath) {
    return openTabs
  }

  const movingTab = openTabs.find((tab) => tab.filePath === movingPath)
  if (!movingTab || !openTabs.some((tab) => tab.filePath === targetPath)) {
    return openTabs
  }

  const remainingTabs = openTabs.filter((tab) => tab.filePath !== movingPath)
  const targetIndex = remainingTabs.findIndex((tab) => tab.filePath === targetPath)
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

function supportsPreviewMode(filePath: string, editorKind: SupportedWorkspaceEditorKind) {
  return editorKind === 'code' && supportsHtmlPreview(filePath)
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeTabPath: null,
  currentPath: null,
  openTabs: [],
  tree: [],
  activateTab: (activeTabPath) => set((state) => (
    state.openTabs.some((tab) => tab.filePath === activeTabPath)
      ? { activeTabPath }
      : state
  )),
  closeTab: (path) => set((state) => ({
    activeTabPath: getNextActiveTabPath(state.openTabs, state.activeTabPath, path),
    openTabs: state.openTabs.filter((tab) => tab.filePath !== path),
  })),
  markTabMissing: (path) => set((state) => ({
    openTabs: state.openTabs.map((tab) => (
      tab.kind === 'file' && tab.filePath === path
        ? {
          ...tab,
          exists: false,
        }
        : tab
    )),
  })),
  markTabSaved: (path, savedContent) => set((state) => ({
    openTabs: state.openTabs.map((tab) => (
      tab.kind === 'file' && tab.filePath === path
        ? {
          ...tab,
          content: savedContent,
          exists: true,
          isDirty: false,
          savedContent,
        }
        : tab
    )),
  })),
  moveTab: (movingPath, targetPath, position) => set((state) => {
    const nextTabs = reorderWorkspaceTabs(state.openTabs, movingPath, targetPath, position)

    return nextTabs === state.openTabs
      ? state
      : { openTabs: nextTabs }
  }),
  openTab: ({ content, editorKind, filePath, viewMode }) => set((state) => {
    const nextViewMode = viewMode ?? getDefaultWorkspaceFileViewMode(filePath, editorKind)
    const existingTab = state.openTabs.find((tab) => tab.filePath === filePath)

    if (existingTab) {
      return {
        activeTabPath: filePath,
        openTabs: state.openTabs.map((tab) => (
          tab.kind === 'file' && tab.filePath === filePath
            ? {
              ...tab,
              editorKind,
              exists: true,
              viewMode: nextViewMode,
            }
            : tab
        )),
      }
    }

    return {
      activeTabPath: filePath,
      openTabs: [
        ...state.openTabs,
        {
          content,
          editorKind,
          exists: true,
          filePath,
          isDirty: false,
          kind: 'file',
          savedContent: content,
          viewMode: nextViewMode,
        },
      ],
    }
  }),
  openDiffTab: (tab, activate = true) => set((state) => {
    const existingIndex = state.openTabs.findIndex((candidate) => candidate.filePath === tab.filePath)
    const nextTabs = existingIndex === -1
      ? [...state.openTabs, tab]
      : state.openTabs.map((candidate, index) => (index === existingIndex ? tab : candidate))

    return {
      activeTabPath: activate ? tab.filePath : state.activeTabPath,
      openTabs: nextTabs,
    }
  }),
  renameTab: (currentPath, nextPath) => set((state) => ({
    activeTabPath: state.activeTabPath === currentPath ? nextPath : state.activeTabPath,
    openTabs: state.openTabs.map((tab) => (
      tab.kind === 'file' && tab.filePath === currentPath
        ? (() => {
          const nextEditorKind = getSupportedWorkspaceEditorKind(nextPath) ?? tab.editorKind

          return {
            ...tab,
            editorKind: nextEditorKind,
            exists: true,
            filePath: nextPath,
            viewMode: tab.viewMode === 'preview' && !supportsPreviewMode(nextPath, nextEditorKind)
              ? getDefaultWorkspaceFileViewMode(nextPath, nextEditorKind)
              : tab.viewMode,
          }
        })()
        : tab
    )),
  })),
  replaceTabs: (openTabs, activeTabPath) => set({
    activeTabPath,
    openTabs,
  }),
  resetOpenTabs: () => set({
    activeTabPath: null,
    openTabs: [],
  }),
  setCurrentPath: (currentPath) => set({ currentPath }),
  setTabViewMode: (path, viewMode) => set((state) => ({
    openTabs: state.openTabs.map((tab) => (
      tab.kind === 'file' && tab.filePath === path
        ? {
          ...tab,
          viewMode,
        }
        : tab
    )),
  })),
  setTree: (tree) => set({ tree }),
  syncTabWithDisk: (path, nextContent) => set((state) => ({
    openTabs: state.openTabs.map((tab) => (
      tab.kind === 'file' && tab.filePath === path
        ? {
          ...tab,
          content: nextContent,
          exists: true,
          isDirty: false,
          savedContent: nextContent,
        }
        : tab
    )),
  })),
  updateTabContent: (path, content) => set((state) => ({
    openTabs: state.openTabs.map((tab) => (
      tab.kind === 'file' && tab.filePath === path
        ? {
          ...tab,
          content,
          isDirty: content !== tab.savedContent,
        }
        : tab
    )),
  })),
}))
