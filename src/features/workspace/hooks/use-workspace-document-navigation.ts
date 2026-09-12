import { useCallback } from 'react'
import { toast } from '@heroui/react'
import type { AgentMessageFileChangeKind } from '@/features/agent/types'
import type {
  GitChangeItem,
  GitCommitFileChange,
  GitFileDiffResult,
} from '@/features/git/types'
import {
  normalizeWorkspaceFileViewMode,
  supportsMeoEditor,
  type LegacyWorkspaceFileViewMode,
  type WorkspaceFileViewMode,
} from '@/features/workspace/lib/file-types'
import { getBaseName, normalizeFilePath } from '@/features/workspace/lib/workspace-paths'
import {
  dedupeStoredEntries,
  readStoredTabState,
  toStoredWorkspaceTab,
} from '@/features/workspace/lib/workspace-tab-persistence'
import {
  createDiffTab,
  createWorkspaceFileGitDiffRequest,
  isWorkspaceAutosaveTab,
  shouldOpenGitDiffForLine,
} from '@/features/workspace/lib/workspace-tabs'
import {
  createWorkspaceFileTabId,
  dedupeWorkspaceTabs,
  useWorkspaceStore,
  type WorkspaceDiffNavigationRequest,
  type WorkspaceDisplayTab,
  type WorkspaceFileGitDiffRequest,
  type WorkspaceFileTab,
} from '@/features/workspace/store/use-workspace-store'
import { getOpenFileProfileDuration, recordOpenFileProfile } from '@/lib/open-file-profile'

export type WorkspaceDocumentTarget = ((tabId: string) => void) & { isCurrent?: () => boolean }

type UseWorkspaceDocumentNavigationOptions = {
  captureDocumentTarget?: () => WorkspaceDocumentTarget | undefined
  captureActiveMeoViewPosition: () => void
  currentPath: string | null
  displayActiveTabId: string | null
  displayTabs: WorkspaceDisplayTab[]
  flushWorkspaceAutosave: (filePath?: string) => Promise<boolean>
  isActiveEditorComposing: boolean
  setStatusMessage: (message: string) => void
}

export function useWorkspaceDocumentNavigation({
  captureDocumentTarget,
  captureActiveMeoViewPosition,
  currentPath,
  displayActiveTabId,
  displayTabs,
  flushWorkspaceAutosave,
  isActiveEditorComposing,
  setStatusMessage,
}: UseWorkspaceDocumentNavigationOptions) {
  const activateTab = useWorkspaceStore((state) => state.activateTab)
  const openDiffTab = useWorkspaceStore((state) => state.openDiffTab)
  const openTab = useWorkspaceStore((state) => state.openTab)
  const replaceActiveFileTab = useWorkspaceStore((state) => state.replaceActiveFileTab)
  const replaceTabs = useWorkspaceStore((state) => state.replaceTabs)

  const openFile = useCallback(async (
    filePath: string,
    workspacePath: string | null = currentPath,
    preferredViewMode?: LegacyWorkspaceFileViewMode,
    target?: WorkspaceDocumentTarget,
  ) => {
    const opened = target ?? captureDocumentTarget?.()
    const openStartedAt = performance.now()
    recordOpenFileProfile('app:open-file:start', {
      filePath,
      preferredViewMode: preferredViewMode ?? null,
      workspacePath,
    })
    captureActiveMeoViewPosition()
    recordOpenFileProfile('app:open-file:capture-active-position:end', {
      elapsedMs: getOpenFileProfileDuration(openStartedAt),
    })

    const editorKindStartedAt = performance.now()
    recordOpenFileProfile('app:open-file:resolve-editor-kind:start', { filePath })
    const editorKind = await window.appApi.resolveWorkspaceEditorKind(filePath)
    recordOpenFileProfile('app:open-file:resolve-editor-kind:end', {
      durationMs: getOpenFileProfileDuration(editorKindStartedAt),
      editorKind,
    })

    if (!editorKind) {
      toast.warning(`Cannot open ${getBaseName(filePath)} yet`, {
        description: 'This file could not be opened from the workspace.',
      })
      setStatusMessage(`${getBaseName(filePath)} is not supported yet`)
      recordOpenFileProfile('app:open-file:unsupported:end', {
        elapsedMs: getOpenFileProfileDuration(openStartedAt),
      })
      return
    }

    try {
      const targetViewMode = normalizeWorkspaceFileViewMode(filePath, editorKind, preferredViewMode)
      recordOpenFileProfile('app:open-file:resolve-view-mode:end', {
        elapsedMs: getOpenFileProfileDuration(openStartedAt),
        targetViewMode,
      })
      const existingTab = useWorkspaceStore.getState().openTabs.find(
        (tab): tab is WorkspaceFileTab => (
          tab.kind === 'file'
          && tab.filePath === filePath
          && tab.viewMode === targetViewMode
        ),
      )

      if (opened?.isCurrent && !opened.isCurrent()) return

      if (existingTab) {
        const activateStartedAt = performance.now()
        recordOpenFileProfile('app:open-file:existing-tab:activate:start', { tabId: existingTab.id })
        activateTab(existingTab.id)
        opened?.(existingTab.id)
        recordOpenFileProfile('app:open-file:existing-tab:activate:end', {
          durationMs: getOpenFileProfileDuration(activateStartedAt),
        })

        if (workspacePath) {
          const updateStateStartedAt = performance.now()
          recordOpenFileProfile('app:open-file:update-workspace-state:start', { filePath, workspacePath })
          await window.appApi.updateWorkspaceState(workspacePath, { lastFilePath: filePath })
          recordOpenFileProfile('app:open-file:update-workspace-state:end', {
            durationMs: getOpenFileProfileDuration(updateStateStartedAt),
          })
        }

        setStatusMessage(`${getBaseName(filePath)} focused`)
        recordOpenFileProfile('app:open-file:existing-tab:end', {
          elapsedMs: getOpenFileProfileDuration(openStartedAt),
        })
        return
      }

      const fileContent = await (async () => {
        if (editorKind === 'file') {
          return ''
        }

        const readStartedAt = performance.now()
        recordOpenFileProfile('app:open-file:read-file:start', { filePath })
        const content = await window.appApi.readWorkspaceFile(filePath)
        recordOpenFileProfile('app:open-file:read-file:end', {
          chars: content.length,
          durationMs: getOpenFileProfileDuration(readStartedAt),
        })
        return content
      })()
      if (opened?.isCurrent && !opened.isCurrent()) return
      const openTabStartedAt = performance.now()
      recordOpenFileProfile('app:open-file:open-tab:start', {
        editorKind,
        filePath,
        targetViewMode,
      })
      openTab({
        filePath,
        content: fileContent,
        editorKind,
        viewMode: targetViewMode,
        workspacePath,
      })
      opened?.(createWorkspaceFileTabId(filePath, targetViewMode))
      recordOpenFileProfile('app:open-file:open-tab:end', {
        durationMs: getOpenFileProfileDuration(openTabStartedAt),
        elapsedMs: getOpenFileProfileDuration(openStartedAt),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open file.'
      toast.danger(`Failed to open ${getBaseName(filePath)}`, { description: message })
      setStatusMessage(message)
      recordOpenFileProfile('app:open-file:error:end', {
        elapsedMs: getOpenFileProfileDuration(openStartedAt),
        message,
      })
      return
    }

    if (workspacePath) {
      const updateStateStartedAt = performance.now()
      recordOpenFileProfile('app:open-file:update-workspace-state:start', { filePath, workspacePath })
      await window.appApi.updateWorkspaceState(workspacePath, { lastFilePath: filePath })
      recordOpenFileProfile('app:open-file:update-workspace-state:end', {
        durationMs: getOpenFileProfileDuration(updateStateStartedAt),
      })
    }

    setStatusMessage(`${getBaseName(filePath)} opened`)
    recordOpenFileProfile('app:open-file:end', {
      elapsedMs: getOpenFileProfileDuration(openStartedAt),
    })
  }, [
    captureDocumentTarget,
    activateTab,
    captureActiveMeoViewPosition,
    currentPath,
    openTab,
    setStatusMessage,
  ])

  const replaceActiveFileWithPath = useCallback(async (filePath: string) => {
    const replaceStartedAt = performance.now()
    const storeSnapshot = useWorkspaceStore.getState()
    const currentActiveTab = storeSnapshot.openTabs.find((tab) => tab.id === storeSnapshot.activeTabId) ?? null
    const currentActiveFileTab = currentActiveTab?.kind === 'file' ? currentActiveTab : null

    recordOpenFileProfile('app:replace-active-file:start', {
      activeTabId: storeSnapshot.activeTabId,
      filePath,
    })

    if (currentActiveFileTab && normalizeFilePath(currentActiveFileTab.filePath) === normalizeFilePath(filePath)) {
      activateTab(currentActiveFileTab.id)
      setStatusMessage(`${getBaseName(filePath)} focused`)
      return
    }

    if (currentActiveFileTab && isWorkspaceAutosaveTab(currentActiveFileTab) && currentActiveFileTab.isDirty) {
      if (isActiveEditorComposing) {
        const message = '请先结束当前输入法组合，再切换目录文件。'
        toast.warning('请先完成编辑', { description: message })
        setStatusMessage(message)
        return
      }

      try {
        await flushWorkspaceAutosave(currentActiveFileTab.filePath)
      } catch (error) {
        const message = error instanceof Error ? error.message : '保存当前文件失败。'
        toast.danger('无法切换文件', { description: message })
        setStatusMessage(message)
        return
      }

      const latestActiveTab = useWorkspaceStore.getState().openTabs.find(
        (tab) => tab.id === currentActiveFileTab.id,
      )
      if (isWorkspaceAutosaveTab(latestActiveTab) && latestActiveTab.isDirty) {
        const message = '当前文件仍有未保存内容。请保存后再切换目录文件。'
        toast.warning('无法切换文件', { description: message })
        setStatusMessage(message)
        return
      }
    }

    captureActiveMeoViewPosition()

    const editorKind = await window.appApi.resolveWorkspaceEditorKind(filePath)
    if (!editorKind) {
      toast.warning(`Cannot open ${getBaseName(filePath)} yet`, {
        description: 'This file could not be opened from the workspace.',
      })
      setStatusMessage(`${getBaseName(filePath)} is not supported yet`)
      recordOpenFileProfile('app:replace-active-file:unsupported:end', {
        elapsedMs: getOpenFileProfileDuration(replaceStartedAt),
      })
      return
    }

    try {
      const targetViewMode = normalizeWorkspaceFileViewMode(filePath, editorKind, currentActiveFileTab?.viewMode)
      const targetTabId = createWorkspaceFileTabId(filePath, targetViewMode)
      const existingTargetTab = useWorkspaceStore.getState().openTabs.find(
        (tab): tab is WorkspaceFileTab => tab.kind === 'file' && tab.id === targetTabId,
      )
      const fileContent = existingTargetTab
        ? existingTargetTab.content
        : editorKind === 'file'
          ? ''
          : await window.appApi.readWorkspaceFile(filePath)

      replaceActiveFileTab({
        filePath,
        content: fileContent,
        editorKind,
        viewMode: targetViewMode,
      })

      if (currentPath) {
        await window.appApi.updateWorkspaceState(currentPath, { lastFilePath: filePath })
      }

      setStatusMessage(existingTargetTab ? `${getBaseName(filePath)} focused` : `${getBaseName(filePath)} opened`)
      recordOpenFileProfile('app:replace-active-file:end', {
        elapsedMs: getOpenFileProfileDuration(replaceStartedAt),
        reusedExistingTab: Boolean(existingTargetTab),
        targetViewMode,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open file.'
      toast.danger(`Failed to open ${getBaseName(filePath)}`, { description: message })
      setStatusMessage(message)
      recordOpenFileProfile('app:replace-active-file:error:end', {
        elapsedMs: getOpenFileProfileDuration(replaceStartedAt),
        message,
      })
    }
  }, [
    activateTab,
    captureActiveMeoViewPosition,
    currentPath,
    flushWorkspaceAutosave,
    isActiveEditorComposing,
    replaceActiveFileTab,
    setStatusMessage,
  ])

  const openAgentMessageFile = useCallback(async (
    filePath: string,
    changeKind: AgentMessageFileChangeKind,
  ) => {
    const existingFileTab = useWorkspaceStore.getState().openTabs.find(
      (tab): tab is WorkspaceFileTab => tab.kind === 'file' && tab.filePath === filePath,
    )

    if (existingFileTab) {
      captureActiveMeoViewPosition()
      activateTab(existingFileTab.id)

      if (currentPath) {
        void window.appApi.updateWorkspaceState(currentPath, { lastFilePath: filePath })
      }

      setStatusMessage(`${getBaseName(filePath)} focused`)
      return
    }

    if (changeKind === 'deleted') {
      toast.warning(`Cannot reopen ${getBaseName(filePath)}`, {
        description: 'This file was deleted by the agent. Open tabs for it can still be focused if they already exist.',
      })
      setStatusMessage(`${getBaseName(filePath)} was deleted`)
      return
    }

    await openFile(filePath)
  }, [
    activateTab,
    captureActiveMeoViewPosition,
    currentPath,
    openFile,
    setStatusMessage,
  ])

  const openMeoGitDiff = useCallback(async (
    change: GitChangeItem,
    diff: GitFileDiffResult,
    gitDiffRequest: WorkspaceFileGitDiffRequest,
    isCurrent?: () => boolean,
  ) => {
    const targetViewMode: WorkspaceFileViewMode = 'meo'
    const existingTab = useWorkspaceStore.getState().openTabs.find(
      (tab): tab is WorkspaceFileTab => (
        tab.kind === 'file'
        && tab.filePath === change.path
        && tab.viewMode === targetViewMode
      ),
    )
    let fileContent = existingTab?.content ?? diff.modifiedContent
    let fileExists = existingTab?.exists ?? diff.modifiedExists

    if (!existingTab) {
      try {
        fileContent = await window.appApi.readWorkspaceFile(change.path)
        fileExists = true
      } catch {
        fileExists = diff.modifiedExists
      }
    }

    if (isCurrent && !isCurrent()) return
    openTab({
      content: fileContent,
      editorKind: diff.editorKind,
      exists: fileExists,
      filePath: change.path,
      gitDiffRequest,
      viewMode: targetViewMode,
    })

    if (currentPath) {
      await window.appApi.updateWorkspaceState(currentPath, { lastFilePath: change.path })
    }

    setStatusMessage(`${getBaseName(change.path)} diff opened`)
  }, [
    currentPath,
    openTab,
    setStatusMessage,
  ])

  const openGitDiff = useCallback(async (
    change: GitChangeItem,
    options?: {
      lineNumber?: number
      mode?: WorkspaceFileGitDiffRequest['mode']
      source?: 'revision' | 'worktree'
      view?: 'meo' | 'monaco'
    },
    target?: WorkspaceDocumentTarget,
  ) => {
    const opened = target ?? captureDocumentTarget?.()
    if (!currentPath) {
      return
    }

    captureActiveMeoViewPosition()

    try {
      const diff = await window.appApi.getGitFileDiff(currentPath, change.path, change.scope)
      if (opened?.isCurrent && !opened.isCurrent()) return
      const navigationSource = options?.source ?? 'worktree'

      if (!shouldOpenGitDiffForLine(diff, navigationSource, options?.lineNumber)) {
        return
      }

      if (options?.view === 'meo' && supportsMeoEditor(change.path, diff.editorKind)) {
        await openMeoGitDiff(
          change,
          diff,
          createWorkspaceFileGitDiffRequest(
            change,
            navigationSource,
            options?.lineNumber,
            options?.mode ?? 'split',
          ),
          opened?.isCurrent,
        )
        opened?.(createWorkspaceFileTabId(change.path, 'meo'))
        return
      }

      const navigationRequest = typeof options?.lineNumber === 'number'
        ? {
          lineNumber: Math.max(1, Math.floor(options.lineNumber)),
          requestKey: `${change.scope}:${change.path}:${navigationSource}:${Date.now()}`,
          source: navigationSource,
        } satisfies WorkspaceDiffNavigationRequest
        : null
      const tab = createDiffTab(diff, navigationRequest)
      openDiffTab(tab)
      opened?.(tab.id)

      setStatusMessage(`${getBaseName(change.path)} diff opened`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open the diff view.'
      toast.danger('Failed to open diff', { description: message })
      setStatusMessage(message)
    }
  }, [
    captureDocumentTarget,
    captureActiveMeoViewPosition,
    currentPath,
    openDiffTab,
    openMeoGitDiff,
    setStatusMessage,
  ])

  const openGitCommitFileDiff = useCallback(async (
    commitHash: string,
    change: GitCommitFileChange,
    target?: WorkspaceDocumentTarget,
  ) => {
    const opened = target ?? captureDocumentTarget?.()
    if (!currentPath) {
      return
    }

    captureActiveMeoViewPosition()

    try {
      const diff = await window.appApi.getGitCommitFileDiff(currentPath, commitHash, change.path)
      if (opened?.isCurrent && !opened.isCurrent()) return

      const tab = createDiffTab(diff)
      openDiffTab(tab)
      opened?.(tab.id)

      setStatusMessage(`已打开 ${getBaseName(change.path)} 的提交差异`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法打开该提交差异。'
      toast.danger('打开提交差异失败', { description: message })
      setStatusMessage(message)
    }
  }, [
    captureDocumentTarget,
    captureActiveMeoViewPosition,
    currentPath,
    openDiffTab,
    setStatusMessage,
  ])

  const restoreWorkspaceTabs = useCallback(async (
    workspacePath: string,
    fallbackFilePath?: string | null,
    options: { shouldApply?: () => boolean } = {},
  ) => {
    const workspaceState = await window.appApi.getWorkspaceState(workspacePath)

    if (options.shouldApply && !options.shouldApply()) {
      return
    }

    const storedState = readStoredTabState(workspacePath)
    const fallbackPath = fallbackFilePath ?? workspaceState.lastFilePath
    const candidateEntries = dedupeStoredEntries([
      ...(storedState.entries ?? []).map((entry) => ({
        path: entry.path,
        viewMode: entry.viewMode,
      })),
      ...(storedState.entries?.length
        ? []
        : storedState.paths.map((path) => ({ path }))),
      ...(fallbackPath ? [{ path: fallbackPath }] : []),
    ])

    if (candidateEntries.length === 0) {
      if (options.shouldApply && !options.shouldApply()) {
        return
      }

      replaceTabs([], null)
      return
    }

    const settledTabs = await Promise.all(candidateEntries.map(async ({ path: filePath, viewMode }) => {
      const editorKind = await window.appApi.resolveWorkspaceEditorKind(filePath)

      if (!editorKind) {
        return null
      }

      try {
        const content = editorKind === 'file'
          ? ''
          : await window.appApi.readWorkspaceFile(filePath)
        return toStoredWorkspaceTab(
          filePath,
          content,
          editorKind,
          normalizeWorkspaceFileViewMode(filePath, editorKind, viewMode),
        )
      } catch {
        return null
      }
    }))
    const nextTabs = dedupeWorkspaceTabs(
      settledTabs.filter((tab): tab is WorkspaceFileTab => tab !== null),
    )
    const requestedActiveId = storedState.activePath ?? fallbackPath ?? null
    const nextActiveId = nextTabs.some((tab) => tab.id === requestedActiveId || tab.filePath === requestedActiveId)
      ? nextTabs.find((tab) => tab.id === requestedActiveId || tab.filePath === requestedActiveId)?.id ?? null
      : nextTabs[0]?.id ?? null

    if (options.shouldApply && !options.shouldApply()) {
      return
    }

    replaceTabs(nextTabs, nextActiveId)
    const nextActiveFileTab = nextTabs.find((tab) => tab.id === nextActiveId && tab.kind === 'file')

    if (options.shouldApply && !options.shouldApply()) {
      return
    }

    await window.appApi.updateWorkspaceState(workspacePath, {
      lastFilePath: nextActiveFileTab?.filePath ?? null,
    })
  }, [replaceTabs])

  const activateFileTab = useCallback((tabId: string) => {
    if (tabId !== displayActiveTabId) {
      captureActiveMeoViewPosition()
    }
    activateTab(tabId)

    const targetTab = displayTabs.find((tab) => tab.id === tabId)

    if (currentPath && targetTab?.kind === 'file') {
      void window.appApi.updateWorkspaceState(currentPath, { lastFilePath: targetTab.filePath })
    }
  }, [
    activateTab,
    captureActiveMeoViewPosition,
    currentPath,
    displayActiveTabId,
    displayTabs,
  ])

  const cycleTabs = useCallback((direction: 1 | -1) => {
    if (displayTabs.length < 2 || !displayActiveTabId) {
      return
    }

    const currentIndex = displayTabs.findIndex((tab) => tab.id === displayActiveTabId)
    if (currentIndex === -1) {
      return
    }

    const nextIndex = (currentIndex + direction + displayTabs.length) % displayTabs.length
    activateFileTab(displayTabs[nextIndex].id)
  }, [activateFileTab, displayActiveTabId, displayTabs])

  return {
    activateFileTab,
    cycleTabs,
    openAgentMessageFile,
    openFile,
    openGitCommitFileDiff,
    openGitDiff,
    replaceActiveFileWithPath,
    restoreWorkspaceTabs,
  }
}
