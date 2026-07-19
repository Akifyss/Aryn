import { useCallback, useEffect, useRef } from 'react'
import { toast } from '@heroui/react'
import {
  getDirtyWorkspaceTabs,
  getDirtyWorkspaceTabsForNodePath,
  getDirtyWorkspaceTabsForPaths,
  hasDirtyWorkspaceFileTab,
} from '@/features/workspace/lib/workspace-document-state'
import { getBaseName, normalizeFilePath } from '@/features/workspace/lib/workspace-paths'
import {
  FIXED_FILE_TAB_ID,
  FIXED_GIT_TAB_ID,
  getActiveWorkspaceFilePath,
  getWorkspaceTabSourcePath,
  isWorkspaceAutosaveTab,
} from '@/features/workspace/lib/workspace-tabs'
import {
  useWorkspaceStore,
  type WorkspaceDiffTab,
  type WorkspaceFileTab,
} from '@/features/workspace/store/use-workspace-store'

const WORKSPACE_AUTO_SAVE_DELAY_MS = 1000
const INTERNAL_SAVE_EVENT_TTL_MS = 2500

type ConfirmationOptions = {
  cancelLabel?: string
  confirmLabel?: string
  isDanger?: boolean
  message: string
  title: string
}

type UseWorkspaceDocumentPersistenceOptions = {
  activeDiffHasDirtyRelatedFileTab: boolean
  activeDiffTab: WorkspaceDiffTab | null
  activeWorkspaceAutosaveTab: WorkspaceFileTab | null
  captureActiveMeoViewPosition: () => void
  currentFileContent: string
  currentFilePath: string | null
  currentPath: string | null
  displayActiveTabId: string | null
  isActiveEditorComposing: boolean
  refreshWorkspaceAfterSave: (workspacePath: string) => Promise<void>
  requestConfirmation: (options: ConfirmationOptions) => Promise<boolean>
  setStatusMessage: (message: string) => void
}

export function useWorkspaceDocumentPersistence({
  activeDiffHasDirtyRelatedFileTab,
  activeDiffTab,
  activeWorkspaceAutosaveTab,
  captureActiveMeoViewPosition,
  currentFileContent,
  currentFilePath,
  currentPath,
  displayActiveTabId,
  isActiveEditorComposing,
  refreshWorkspaceAfterSave,
  requestConfirmation,
  setStatusMessage,
}: UseWorkspaceDocumentPersistenceOptions) {
  const closeTab = useWorkspaceStore((state) => state.closeTab)
  const markDiffTabSaved = useWorkspaceStore((state) => state.markDiffTabSaved)
  const markFileTabsSaved = useWorkspaceStore((state) => state.markFileTabsSaved)
  const syncFileTabsWithDisk = useWorkspaceStore((state) => state.syncFileTabsWithDisk)
  const updateDiffTabDraft = useWorkspaceStore((state) => state.updateDiffTabDraft)
  const workspaceAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const workspaceAutosaveTargetRef = useRef<{ filePath: string } | null>(null)
  const workspaceAutosavePromiseRef = useRef<Promise<void> | null>(null)
  const diffAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const diffAutosaveTargetRef = useRef<{ tabId: string } | null>(null)
  const diffAutosavePromiseRef = useRef<Promise<boolean> | null>(null)
  const flushDiffTabRef = useRef<(
    tab: WorkspaceDiffTab,
    options?: { announce?: boolean },
  ) => Promise<boolean>>(async () => false)
  const previousWorkspaceAutosavePathRef = useRef<string | null>(null)
  const previousActiveDiffTabIdRef = useRef<string | null>(null)
  const internalWorkspaceSavePathsRef = useRef(new Set<string>())
  const internalWorkspaceSaveTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const syncPersistedActiveFile = useCallback(async (workspacePath: string) => {
    const { activeTabId, openTabs } = useWorkspaceStore.getState()
    await window.appApi.updateWorkspaceState(workspacePath, {
      lastFilePath: getActiveWorkspaceFilePath(openTabs, activeTabId),
    })
  }, [])

  const clearInternalWorkspaceSaveMarker = useCallback((filePath: string) => {
    internalWorkspaceSavePathsRef.current.delete(filePath)
    const timer = internalWorkspaceSaveTimersRef.current.get(filePath)

    if (timer) {
      clearTimeout(timer)
      internalWorkspaceSaveTimersRef.current.delete(filePath)
    }
  }, [])

  const markInternalWorkspaceSave = useCallback((filePath: string) => {
    clearInternalWorkspaceSaveMarker(filePath)
    internalWorkspaceSavePathsRef.current.add(filePath)
    internalWorkspaceSaveTimersRef.current.set(filePath, setTimeout(() => {
      clearInternalWorkspaceSaveMarker(filePath)
    }, INTERNAL_SAVE_EVENT_TTL_MS))
  }, [clearInternalWorkspaceSaveMarker])

  const consumeInternalWorkspaceSave = useCallback((filePath: string) => {
    if (!internalWorkspaceSavePathsRef.current.has(filePath)) {
      return false
    }

    clearInternalWorkspaceSaveMarker(filePath)
    return true
  }, [clearInternalWorkspaceSaveMarker])

  const persistWorkspaceFileContent = useCallback(async (
    filePath: string,
    content: string,
    options: { announce?: boolean, syncMode?: 'mark' | 'sync' } = {},
  ) => {
    const { announce = false, syncMode = 'mark' } = options
    markInternalWorkspaceSave(filePath)

    try {
      await window.appApi.saveWorkspaceFile(filePath, content)
    } catch (error) {
      clearInternalWorkspaceSaveMarker(filePath)
      throw error
    }

    if (syncMode === 'sync') {
      syncFileTabsWithDisk(filePath, content)
    } else {
      markFileTabsSaved(filePath, content)
    }

    if (announce) {
      setStatusMessage('Changes saved')
    }

    if (currentPath) {
      await refreshWorkspaceAfterSave(currentPath)
    }
  }, [
    clearInternalWorkspaceSaveMarker,
    currentPath,
    markFileTabsSaved,
    markInternalWorkspaceSave,
    refreshWorkspaceAfterSave,
    setStatusMessage,
    syncFileTabsWithDisk,
  ])

  const persistDiffTabContent = useCallback(async (
    tabId: string,
    filePath: string,
    content: string,
    options: { announce?: boolean } = {},
  ) => {
    const { announce = false } = options
    markInternalWorkspaceSave(filePath)

    try {
      await window.appApi.saveWorkspaceFile(filePath, content)
    } catch (error) {
      clearInternalWorkspaceSaveMarker(filePath)
      throw error
    }

    syncFileTabsWithDisk(filePath, content)
    markDiffTabSaved(tabId, content)

    if (announce) {
      setStatusMessage('Changes saved')
    }

    if (currentPath) {
      await refreshWorkspaceAfterSave(currentPath)
    }
  }, [
    clearInternalWorkspaceSaveMarker,
    currentPath,
    markDiffTabSaved,
    markInternalWorkspaceSave,
    refreshWorkspaceAfterSave,
    setStatusMessage,
    syncFileTabsWithDisk,
  ])

  const flushDiffTab = useCallback(async (
    tab: WorkspaceDiffTab,
    options: { announce?: boolean } = {},
  ) => {
    if (
      tab.diff.source.kind !== 'working-tree'
      || !tab.isDirty
      || tab.diff.change.scope !== 'unstaged'
      || !tab.diff.modifiedExists
    ) {
      return false
    }

    if (hasDirtyWorkspaceFileTab(useWorkspaceStore.getState().openTabs, tab.diff.change.path)) {
      return false
    }

    const draftContent = tab.draftContent ?? tab.diff.modifiedContent

    if (draftContent === tab.diff.modifiedContent) {
      updateDiffTabDraft(tab.id, null)
      return false
    }

    await persistDiffTabContent(tab.id, tab.diff.change.path, draftContent, options)
    return true
  }, [persistDiffTabContent, updateDiffTabDraft])

  flushDiffTabRef.current = flushDiffTab

  const flushDirtyDiffTabs = useCallback(async (filePaths?: string[]) => {
    if (Array.isArray(filePaths) && filePaths.length === 0) {
      return false
    }

    const dirtyDiffTabs = getDirtyWorkspaceTabsForPaths(
      useWorkspaceStore.getState().openTabs,
      filePaths,
    ).filter((tab): tab is WorkspaceDiffTab => tab.kind === 'diff')
    let didSave = false

    for (const tab of dirtyDiffTabs) {
      const saved = await flushDiffTab(tab)
      didSave = didSave || saved
    }

    return didSave
  }, [flushDiffTab])

  const clearDiffAutosaveTimer = useCallback(() => {
    if (!diffAutosaveTimerRef.current) {
      return
    }

    clearTimeout(diffAutosaveTimerRef.current)
    diffAutosaveTimerRef.current = null
  }, [])

  const flushDiffAutosave = useCallback(async (tabId?: string) => {
    clearDiffAutosaveTimer()

    if (diffAutosavePromiseRef.current) {
      await diffAutosavePromiseRef.current
    }

    const targetTabId = tabId ?? diffAutosaveTargetRef.current?.tabId

    if (!targetTabId) {
      return false
    }

    const targetTab = useWorkspaceStore.getState().openTabs.find(
      (tab): tab is WorkspaceDiffTab => tab.kind === 'diff' && tab.id === targetTabId && tab.isDirty,
    )

    if (!targetTab) {
      if (diffAutosaveTargetRef.current?.tabId === targetTabId) {
        diffAutosaveTargetRef.current = null
      }

      return false
    }

    const savePromise = flushDiffTabRef.current(targetTab)
    diffAutosavePromiseRef.current = savePromise

    try {
      return await savePromise
    } finally {
      if (diffAutosavePromiseRef.current === savePromise) {
        diffAutosavePromiseRef.current = null
      }

      if (diffAutosaveTargetRef.current?.tabId === targetTab.id) {
        diffAutosaveTargetRef.current = null
      }
    }
  }, [clearDiffAutosaveTimer])

  const clearWorkspaceAutosaveTimer = useCallback(() => {
    if (!workspaceAutosaveTimerRef.current) {
      return
    }

    clearTimeout(workspaceAutosaveTimerRef.current)
    workspaceAutosaveTimerRef.current = null
  }, [])

  const flushWorkspaceAutosave = useCallback(async (filePath?: string) => {
    clearWorkspaceAutosaveTimer()

    if (workspaceAutosavePromiseRef.current) {
      await workspaceAutosavePromiseRef.current
    }

    const targetFilePath = filePath ?? workspaceAutosaveTargetRef.current?.filePath

    if (!targetFilePath) {
      return false
    }

    const targetTab = useWorkspaceStore.getState().openTabs.find(
      (tab): tab is WorkspaceFileTab => (
        isWorkspaceAutosaveTab(tab)
        && tab.filePath === targetFilePath
        && tab.isDirty
      ),
    )

    if (!targetTab) {
      if (workspaceAutosaveTargetRef.current?.filePath === targetFilePath) {
        workspaceAutosaveTargetRef.current = null
      }

      return false
    }

    const savePromise = persistWorkspaceFileContent(targetTab.filePath, targetTab.content, {
      announce: false,
      syncMode: 'mark',
    })
    workspaceAutosavePromiseRef.current = savePromise

    try {
      await savePromise
      return true
    } finally {
      if (workspaceAutosavePromiseRef.current === savePromise) {
        workspaceAutosavePromiseRef.current = null
      }

      if (workspaceAutosaveTargetRef.current?.filePath === targetTab.filePath) {
        workspaceAutosaveTargetRef.current = null
      }
    }
  }, [clearWorkspaceAutosaveTimer, persistWorkspaceFileContent])

  const flushWorkspaceTabsForNode = useCallback(async (nodePath: string) => {
    await flushWorkspaceAutosave()
    await flushDiffAutosave()

    const dirtyDiffPaths = Array.from(new Set(
      getDirtyWorkspaceTabsForNodePath(useWorkspaceStore.getState().openTabs, nodePath)
        .filter((tab): tab is WorkspaceDiffTab => tab.kind === 'diff')
        .map((tab) => tab.diff.change.path),
    ))

    try {
      await flushDirtyDiffTabs(dirtyDiffPaths)
    } catch {
      // The caller decides whether remaining dirty tabs block or require confirmation.
    }

    return getDirtyWorkspaceTabsForNodePath(useWorkspaceStore.getState().openTabs, nodePath)
  }, [flushDiffAutosave, flushDirtyDiffTabs, flushWorkspaceAutosave])

  const ensureWorkspaceTabsSavedBeforeNodeMutation = useCallback(async (options: {
    actionLabel: string
    nodePath: string
  }) => {
    if (isActiveEditorComposing) {
      const message = `Finish the current IME composition before ${options.actionLabel.toLowerCase()}.`
      toast.warning('Finish editing first', { description: message })
      setStatusMessage(message)
      return false
    }

    const remainingDirtyTabs = await flushWorkspaceTabsForNode(options.nodePath)

    if (remainingDirtyTabs.length === 0) {
      return true
    }

    const dirtyNames = remainingDirtyTabs
      .slice(0, 4)
      .map((tab) => getBaseName(getWorkspaceTabSourcePath(tab)))
      .join(', ')
    const remainingCount = remainingDirtyTabs.length - Math.min(remainingDirtyTabs.length, 4)
    const extraLabel = remainingCount > 0 ? ` and ${remainingCount} more` : ''
    const message = `Save or close the unsaved tab${remainingDirtyTabs.length > 1 ? 's' : ''} (${dirtyNames}${extraLabel}) before ${options.actionLabel.toLowerCase()}.`

    toast.warning('Unsaved changes need attention', { description: message })
    setStatusMessage(message)
    return false
  }, [
    flushWorkspaceTabsForNode,
    isActiveEditorComposing,
    setStatusMessage,
  ])

  const ensureWorkspaceTabsSavedBeforeGitAction = useCallback(async (options: {
    actionLabel: string
    filePaths?: string[]
  }) => {
    if (isActiveEditorComposing) {
      const message = '请先结束当前输入法组合，再执行此 Git 操作。'
      toast.warning('请先完成编辑', { description: message })
      setStatusMessage(message)
      return false
    }

    await flushWorkspaceAutosave()
    await flushDiffAutosave()

    if (options.filePaths?.length) {
      const uniqueFilePaths = Array.from(new Set(
        options.filePaths.map((filePath) => normalizeFilePath(filePath)),
      ))
      const workspaceTabs = useWorkspaceStore.getState().openTabs

      for (const normalizedPath of uniqueFilePaths) {
        const matchingFileTab = workspaceTabs.find(
          (tab): tab is WorkspaceFileTab => (
            isWorkspaceAutosaveTab(tab)
            && tab.isDirty
            && normalizeFilePath(tab.filePath) === normalizedPath
          ),
        )

        if (matchingFileTab) {
          await flushWorkspaceAutosave(matchingFileTab.filePath)
        }
      }
    }

    try {
      await flushDirtyDiffTabs(options.filePaths)
    } catch {
      // Keep unsaved tabs visible and block the Git action below.
    }

    const remainingDirtyTabs = getDirtyWorkspaceTabsForPaths(
      useWorkspaceStore.getState().openTabs,
      options.filePaths,
    )

    if (remainingDirtyTabs.length === 0) {
      return true
    }

    const dirtyNames = remainingDirtyTabs
      .slice(0, 4)
      .map((tab) => getBaseName(getWorkspaceTabSourcePath(tab)))
      .join(', ')
    const remainingCount = remainingDirtyTabs.length - Math.min(remainingDirtyTabs.length, 4)
    const extraLabel = remainingCount > 0 ? ` 等 ${remainingCount} 个` : ''
    const message = `请先保存未保存的标签页（${dirtyNames}${extraLabel}），再${options.actionLabel}。`

    toast.warning('存在未保存的更改', { description: message })
    setStatusMessage(message)
    return false
  }, [
    flushDiffAutosave,
    flushDirtyDiffTabs,
    flushWorkspaceAutosave,
    isActiveEditorComposing,
    setStatusMessage,
  ])

  const confirmDiscardDirtyTabs = useCallback(async (reason: 'close' | 'switch-workspace') => {
    await flushWorkspaceAutosave()
    await flushDiffAutosave()

    try {
      await flushDirtyDiffTabs()
    } catch {
      // Keep dirty tabs visible and fall back to explicit discard confirmation.
    }

    const pendingDirtyTabs = getDirtyWorkspaceTabs(useWorkspaceStore.getState().openTabs)

    if (pendingDirtyTabs.length === 0) {
      return true
    }

    const dirtyNames = pendingDirtyTabs
      .slice(0, 4)
      .map((tab) => getBaseName(getWorkspaceTabSourcePath(tab)))
      .join(', ')
    const remainingCount = pendingDirtyTabs.length - Math.min(pendingDirtyTabs.length, 4)
    const extraLabel = remainingCount > 0 ? ` and ${remainingCount} more` : ''
    const actionLabel = reason === 'close'
      ? 'Closing them now will discard the unsaved changes.'
      : 'Switching workspaces now will discard the unsaved changes.'

    return requestConfirmation({
      title: 'Unsaved Changes',
      message: `${pendingDirtyTabs.length} tab${pendingDirtyTabs.length > 1 ? 's have' : ' has'} unsaved changes: ${dirtyNames}${extraLabel}.\n\n${actionLabel}`,
      confirmLabel: 'Discard Changes',
      isDanger: true,
    })
  }, [flushDiffAutosave, flushDirtyDiffTabs, flushWorkspaceAutosave, requestConfirmation])

  const closeEditorTab = useCallback(async (
    tabId: string,
    options: { force?: boolean, silent?: boolean } = {},
  ) => {
    if (tabId === displayActiveTabId) {
      captureActiveMeoViewPosition()
    }

    if (tabId === FIXED_FILE_TAB_ID || tabId === FIXED_GIT_TAB_ID) {
      return false
    }

    const targetTab = useWorkspaceStore.getState().openTabs.find((tab) => tab.id === tabId)

    if (!targetTab) {
      return false
    }

    if (isWorkspaceAutosaveTab(targetTab) && targetTab.isDirty) {
      await flushWorkspaceAutosave(targetTab.filePath)
    }

    const latestTargetTab = useWorkspaceStore.getState().openTabs.find((tab) => tab.id === tabId) ?? targetTab

    if (latestTargetTab.kind === 'diff' && latestTargetTab.isDirty) {
      try {
        await flushDiffTab(latestTargetTab)
      } catch {
        // Leave the tab dirty so close confirmation can still protect the draft.
      }
    }

    const settledTargetTab = useWorkspaceStore.getState().openTabs.find((tab) => tab.id === tabId) ?? latestTargetTab

    if (settledTargetTab.isDirty && !options.force) {
      const confirmed = await requestConfirmation({
        title: 'Unsaved Changes',
        message: `"${getBaseName(getWorkspaceTabSourcePath(settledTargetTab))}" has unsaved changes.\n\nClose this tab and discard them?`,
        confirmLabel: 'Discard & Close',
        isDanger: true,
      })

      if (!confirmed) {
        return false
      }
    }

    closeTab(tabId)

    if (currentPath) {
      void syncPersistedActiveFile(currentPath)
    }

    if (!options.silent) {
      setStatusMessage(`${getBaseName(getWorkspaceTabSourcePath(settledTargetTab))} closed`)
    }

    return true
  }, [
    captureActiveMeoViewPosition,
    closeTab,
    currentPath,
    displayActiveTabId,
    flushDiffTab,
    flushWorkspaceAutosave,
    requestConfirmation,
    setStatusMessage,
    syncPersistedActiveFile,
  ])

  const saveWorkspaceFile = useCallback(async (
    options: { content?: string, filePath?: string, announce?: boolean } = {},
  ) => {
    const targetFilePath = options.filePath ?? currentFilePath

    if (!targetFilePath || isActiveEditorComposing) {
      return
    }

    const targetContent = options.content
      ?? (
        targetFilePath === currentFilePath
          ? currentFileContent
          : useWorkspaceStore.getState().openTabs.find(
            (tab): tab is WorkspaceFileTab => tab.kind === 'file' && tab.filePath === targetFilePath,
          )?.content
      )

    if (typeof targetContent !== 'string') {
      return
    }

    await persistWorkspaceFileContent(targetFilePath, targetContent, {
      announce: options.announce ?? true,
      syncMode: 'mark',
    })
  }, [
    currentFileContent,
    currentFilePath,
    isActiveEditorComposing,
    persistWorkspaceFileContent,
  ])

  const saveDiffFile = useCallback(async (
    filePath: string,
    content: string,
    options: { announce?: boolean } = {},
  ) => {
    const targetDiffTab = useWorkspaceStore.getState().openTabs.find(
      (tab): tab is WorkspaceDiffTab => (
        tab.kind === 'diff'
        && tab.diff.source.kind === 'working-tree'
        && tab.diff.change.path === filePath
        && tab.isDirty
      ),
    ) ?? activeDiffTab

    if (!targetDiffTab) {
      await persistWorkspaceFileContent(filePath, content, {
        announce: options.announce ?? false,
        syncMode: 'sync',
      })
      return
    }

    await persistDiffTabContent(targetDiffTab.id, filePath, content, {
      announce: options.announce ?? false,
    })
  }, [activeDiffTab, persistDiffTabContent, persistWorkspaceFileContent])

  const saveActiveTab = useCallback(async () => {
    if (activeDiffTab) {
      if (!activeDiffTab.isDirty || isActiveEditorComposing) {
        return
      }

      const targetDiffTab = useWorkspaceStore.getState().openTabs.find(
        (tab): tab is WorkspaceDiffTab => tab.kind === 'diff' && tab.id === activeDiffTab.id,
      ) ?? activeDiffTab

      await flushDiffTab(targetDiffTab, { announce: true })
      return
    }

    await saveWorkspaceFile()
  }, [activeDiffTab, flushDiffTab, isActiveEditorComposing, saveWorkspaceFile])

  useEffect(() => {
    const previousPath = previousWorkspaceAutosavePathRef.current
    const nextPath = activeWorkspaceAutosaveTab?.filePath ?? null

    if (previousPath && previousPath !== nextPath) {
      const previousTab = useWorkspaceStore.getState().openTabs.find(
        (tab): tab is WorkspaceFileTab => isWorkspaceAutosaveTab(tab) && tab.filePath === previousPath,
      )

      if (previousTab?.isDirty) {
        void flushWorkspaceAutosave(previousPath)
      }
    }

    previousWorkspaceAutosavePathRef.current = nextPath
  }, [activeWorkspaceAutosaveTab?.filePath, flushWorkspaceAutosave])

  useEffect(() => {
    const previousTabId = previousActiveDiffTabIdRef.current
    const nextTabId = activeDiffTab?.id ?? null

    if (previousTabId && previousTabId !== nextTabId) {
      const previousDiffTab = useWorkspaceStore.getState().openTabs.find(
        (tab): tab is WorkspaceDiffTab => tab.kind === 'diff' && tab.id === previousTabId,
      )

      if (previousDiffTab?.isDirty) {
        void flushDiffAutosave(previousDiffTab.id)
      }
    }

    previousActiveDiffTabIdRef.current = nextTabId
  }, [activeDiffTab?.id, flushDiffAutosave])

  useEffect(() => {
    clearDiffAutosaveTimer()

    if (
      !activeDiffTab?.isDirty
      || activeDiffTab.diff.source.kind !== 'working-tree'
      || activeDiffTab.diff.change.scope !== 'unstaged'
      || !activeDiffTab.diff.modifiedExists
      || isActiveEditorComposing
      || activeDiffHasDirtyRelatedFileTab
    ) {
      if (!activeDiffTab) {
        diffAutosaveTargetRef.current = null
      }
      return
    }

    diffAutosaveTargetRef.current = { tabId: activeDiffTab.id }
    diffAutosaveTimerRef.current = setTimeout(() => {
      void flushDiffAutosave(activeDiffTab.id)
    }, WORKSPACE_AUTO_SAVE_DELAY_MS)

    return clearDiffAutosaveTimer
  }, [
    activeDiffTab?.diff.change.path,
    activeDiffTab?.diff.change.scope,
    activeDiffTab?.diff.modifiedContent,
    activeDiffTab?.diff.modifiedExists,
    activeDiffTab?.diff.source.kind,
    activeDiffTab?.draftContent,
    activeDiffTab?.id,
    activeDiffTab?.isDirty,
    activeDiffHasDirtyRelatedFileTab,
    clearDiffAutosaveTimer,
    flushDiffAutosave,
    isActiveEditorComposing,
  ])

  useEffect(() => {
    clearWorkspaceAutosaveTimer()

    if (!activeWorkspaceAutosaveTab?.isDirty || isActiveEditorComposing) {
      if (!activeWorkspaceAutosaveTab) {
        workspaceAutosaveTargetRef.current = null
      }
      return
    }

    workspaceAutosaveTargetRef.current = { filePath: activeWorkspaceAutosaveTab.filePath }
    workspaceAutosaveTimerRef.current = setTimeout(() => {
      void flushWorkspaceAutosave(activeWorkspaceAutosaveTab.filePath)
    }, WORKSPACE_AUTO_SAVE_DELAY_MS)

    return clearWorkspaceAutosaveTimer
  }, [
    activeWorkspaceAutosaveTab?.content,
    activeWorkspaceAutosaveTab?.filePath,
    activeWorkspaceAutosaveTab?.isDirty,
    clearWorkspaceAutosaveTimer,
    flushWorkspaceAutosave,
    isActiveEditorComposing,
  ])

  useEffect(() => () => {
    clearWorkspaceAutosaveTimer()
    clearDiffAutosaveTimer()
    void flushWorkspaceAutosave()
    void flushDiffAutosave()
    internalWorkspaceSaveTimersRef.current.forEach((timer) => {
      clearTimeout(timer)
    })
    internalWorkspaceSaveTimersRef.current.clear()
    internalWorkspaceSavePathsRef.current.clear()
  }, [clearDiffAutosaveTimer, clearWorkspaceAutosaveTimer, flushDiffAutosave, flushWorkspaceAutosave])

  return {
    closeEditorTab,
    confirmDiscardDirtyTabs,
    consumeInternalWorkspaceSave,
    ensureWorkspaceTabsSavedBeforeGitAction,
    ensureWorkspaceTabsSavedBeforeNodeMutation,
    flushDiffAutosave,
    flushWorkspaceTabsForNode,
    flushWorkspaceAutosave,
    saveActiveTab,
    saveDiffFile,
    saveWorkspaceFile,
    syncPersistedActiveFile,
  }
}
