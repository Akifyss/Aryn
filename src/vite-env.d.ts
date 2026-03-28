import type { WorkspaceChangeEvent, WorkspaceNode } from '@/features/workspace/types'

/// <reference types="vite/client" />

declare global {
  interface Window {
    appApi: {
      pickWorkspace: () => Promise<string | null>
      loadWorkspaceTree: (rootPath: string) => Promise<WorkspaceNode[]>
      readWorkspaceFile: (filePath: string) => Promise<string>
      saveWorkspaceFile: (filePath: string, content: string) => Promise<{ ok: boolean }>
      startWorkspaceWatch: (rootPath: string) => Promise<{ ok: boolean }>
      stopWorkspaceWatch: () => Promise<{ ok: boolean }>
      onWorkspaceChanged: (listener: (event: WorkspaceChangeEvent) => void) => () => void
    }
  }
}

export {}
