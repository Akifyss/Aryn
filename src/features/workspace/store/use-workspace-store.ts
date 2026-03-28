import { create } from 'zustand'
import type { WorkspaceNode } from '@/features/workspace/types'

type WorkspaceState = {
  currentPath: string | null
  currentFileContent: string
  currentFilePath: string | null
  isDirty: boolean
  tree: WorkspaceNode[]
  setCurrentPath: (path: string | null) => void
  setCurrentFileContent: (content: string) => void
  setCurrentFilePath: (path: string | null) => void
  setDirty: (isDirty: boolean) => void
  setTree: (tree: WorkspaceNode[]) => void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  currentPath: null,
  currentFileContent: '',
  currentFilePath: null,
  isDirty: false,
  tree: [],
  setCurrentPath: (currentPath) => set({ currentPath }),
  setCurrentFileContent: (currentFileContent) => set({ currentFileContent }),
  setCurrentFilePath: (currentFilePath) => set({ currentFilePath }),
  setDirty: (isDirty) => set({ isDirty }),
  setTree: (tree) => set({ tree }),
}))
