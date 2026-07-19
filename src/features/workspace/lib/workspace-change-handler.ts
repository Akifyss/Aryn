import type {
  WorkspaceRefreshRequest,
  WorkspaceRefreshScheduleMode,
} from '@/features/workspace/lib/workspace-refresh-coordinator'
import { getBaseName, normalizeFilePath } from '@/features/workspace/lib/workspace-paths'
import { getActiveWorkspaceFilePath } from '@/features/workspace/lib/workspace-tabs'
import {
  useWorkspaceStore,
  type WorkspaceFileTab,
} from '@/features/workspace/store/use-workspace-store'
import type { WorkspaceChangeEvent } from '@/features/workspace/types'

export type WorkspaceChangeHandlerOptions = {
  consumeInternalWorkspaceSave: (filePath: string) => boolean
  currentPath: string | null
  isEventCurrent?: () => boolean
  requestWorkspaceRefresh: (
    request: WorkspaceRefreshRequest,
    mode?: WorkspaceRefreshScheduleMode,
  ) => Promise<void>
  setStatusMessage: (message: string) => void
}

function getAffectedFileTabs(filePath: string) {
  return useWorkspaceStore.getState().openTabs.filter(
    (tab): tab is WorkspaceFileTab => tab.kind === 'file' && tab.filePath === filePath,
  )
}

function closeFileTabsForPath(filePath: string) {
  const { closeTab, openTabs } = useWorkspaceStore.getState()

  openTabs.forEach((tab) => {
    if (tab.kind === 'file' && tab.filePath === filePath) {
      closeTab(tab.id)
    }
  })
}

async function persistActiveFile(workspacePath: string) {
  const { activeTabId, openTabs } = useWorkspaceStore.getState()
  await window.appApi.updateWorkspaceState(workspacePath, {
    lastFilePath: getActiveWorkspaceFilePath(openTabs, activeTabId),
  })
}

function isCurrentWorkspace(workspacePath: string) {
  return useWorkspaceStore.getState().currentPath === workspacePath
}

export async function handleWorkspaceChangeEvent(
  event: WorkspaceChangeEvent,
  options: WorkspaceChangeHandlerOptions,
) {
  const {
    consumeInternalWorkspaceSave,
    currentPath,
    isEventCurrent = () => true,
    requestWorkspaceRefresh,
    setStatusMessage,
  } = options

  if (
    !currentPath
    || event.rootPath !== currentPath
    || !isCurrentWorkspace(currentPath)
    || !isEventCurrent()
  ) {
    return
  }

  if ((event.type === 'add' || event.type === 'change') && consumeInternalWorkspaceSave(event.path)) {
    return
  }

  const isGitMetadataChange = normalizeFilePath(event.path).endsWith('/.git/index')

  void requestWorkspaceRefresh({
    refreshGit: true,
    refreshTree: !isGitMetadataChange,
    rootPath: currentPath,
  }, 'debounced').catch(() => {
    // The workspace may have changed before the debounced refresh executes.
  })

  const affectedTabs = getAffectedFileTabs(event.path)
  if (affectedTabs.length === 0) {
    return
  }

  const fileName = getBaseName(event.path)
  const hasDirtyTab = affectedTabs.some((tab) => tab.isDirty)

  if (event.type === 'unlink') {
    if (hasDirtyTab) {
      useWorkspaceStore.getState().markFileTabsMissing(event.path)
      setStatusMessage(`${fileName} was removed externally. Save to recreate it.`)
      return
    }

    closeFileTabsForPath(event.path)
    await persistActiveFile(currentPath).catch((error: unknown) => {
      console.error('[workspace] Failed to persist the active file after an external deletion.', error)
    })

    if (isCurrentWorkspace(currentPath) && isEventCurrent()) {
      setStatusMessage(`${fileName} was removed`)
    }
    return
  }

  if (event.type !== 'add' && event.type !== 'change') {
    return
  }

  if (hasDirtyTab) {
    setStatusMessage(event.type === 'add'
      ? `${fileName} returned on disk. Kept your unsaved version.`
      : `${fileName} changed on disk. Kept your unsaved version.`)
    return
  }

  if (affectedTabs.every((tab) => tab.viewMode === 'file')) {
    setStatusMessage(event.type === 'add'
      ? `${fileName} is up to date`
      : `${fileName} changed on disk`)
    return
  }

  let updatedContent: string
  try {
    updatedContent = await window.appApi.readWorkspaceFile(event.path)
  } catch {
    if (isCurrentWorkspace(currentPath) && isEventCurrent()) {
      setStatusMessage(`${fileName} could not be reloaded`)
    }
    return
  }

  if (!isCurrentWorkspace(currentPath) || !isEventCurrent()) {
    return
  }

  const latestAffectedTabs = getAffectedFileTabs(event.path)
  if (latestAffectedTabs.length === 0) {
    return
  }

  if (latestAffectedTabs.some((tab) => tab.isDirty)) {
    setStatusMessage(event.type === 'add'
      ? `${fileName} returned on disk. Kept your unsaved version.`
      : `${fileName} changed on disk. Kept your unsaved version.`)
    return
  }

  if (latestAffectedTabs.every((tab) => tab.viewMode === 'file')) {
    setStatusMessage(event.type === 'add'
      ? `${fileName} is up to date`
      : `${fileName} changed on disk`)
    return
  }

  useWorkspaceStore.getState().syncFileTabsWithDisk(event.path, updatedContent)
  setStatusMessage(event.type === 'add' ? `${fileName} reloaded` : 'Synced with external edits')
}
