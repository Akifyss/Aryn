import { create } from 'zustand'
import type { WorkspaceNode } from '@/features/workspace/types'

export type WorkspaceTab = {
  content: string
  exists: boolean
  filePath: string
  isDirty: boolean
  savedContent: string
}

type WorkspaceState = {
  activeTabPath: string | null
  currentPath: string | null
  openTabs: WorkspaceTab[]
  tree: WorkspaceNode[]
  activateTab: (path: string) => void
  closeTab: (path: string) => void
  markTabMissing: (path: string) => void
  markTabSaved: (path: string, savedContent: string) => void
  openTab: (tab: { content: string, filePath: string }) => void
  renameTab: (currentPath: string, nextPath: string) => void
  replaceTabs: (tabs: WorkspaceTab[], activeTabPath: string | null) => void
  resetOpenTabs: () => void
  setCurrentPath: (path: string | null) => void
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
      tab.filePath === path
        ? {
          ...tab,
          exists: false,
        }
        : tab
    )),
  })),
  markTabSaved: (path, savedContent) => set((state) => ({
    openTabs: state.openTabs.map((tab) => (
      tab.filePath === path
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
  openTab: ({ content, filePath }) => set((state) => {
    const existingTab = state.openTabs.find((tab) => tab.filePath === filePath)

    if (existingTab) {
      return {
        activeTabPath: filePath,
        openTabs: state.openTabs.map((tab) => (
          tab.filePath === filePath
            ? {
              ...tab,
              exists: true,
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
          exists: true,
          filePath,
          isDirty: false,
          savedContent: content,
        },
      ],
    }
  }),
  renameTab: (currentPath, nextPath) => set((state) => ({
    activeTabPath: state.activeTabPath === currentPath ? nextPath : state.activeTabPath,
    openTabs: state.openTabs.map((tab) => (
      tab.filePath === currentPath
        ? {
          ...tab,
          exists: true,
          filePath: nextPath,
        }
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
  setTree: (tree) => set({ tree }),
  syncTabWithDisk: (path, nextContent) => set((state) => ({
    openTabs: state.openTabs.map((tab) => (
      tab.filePath === path
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
      tab.filePath === path
        ? {
          ...tab,
          content,
          isDirty: content !== tab.savedContent,
        }
        : tab
    )),
  })),
}))
