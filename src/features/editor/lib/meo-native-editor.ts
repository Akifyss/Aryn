import type { GitBaselinePayload, GitBlameResult } from '@/features/git/types'
import {
  getRelativeFsPath,
  isExternalHref,
  resolveImageUrl,
  resolveLocalLinkResults,
  resolveOpenLinkFilePath,
  resolveWikiLinkResults,
} from '@/features/editor/lib/meo-links'
import { createEditor } from '@/vendor/meo/webview/editor'
import { createFindPanelController } from '@/vendor/meo/webview/helpers/findPanel'
import { setGitDiffLineHighlightsEnabled } from '@/vendor/meo/webview/helpers/gitDiffLineHighlights'
import { handleSavedImagePath, handleImagePaste, initializeImageHandling, resolveImageSrc, setImageSrcResolver, settleImageSrcRequest } from '@/vendor/meo/webview/helpers/images'
import { cancelPendingLocalLinkStatusRefresh, handleResolvedLocalLinks, initializeLocalLinkHandling, requestLocalLinkStatuses, scheduleLocalLinkStatusRefresh, setLocalLinkRefreshContext } from '@/vendor/meo/webview/helpers/localLinks'
import { createSelectionMenuController } from '@/vendor/meo/webview/helpers/selectionMenu'
import { handleEditorShortcut, isPrimaryModifier, isShortcutKey, normalizeEol } from '@/vendor/meo/webview/helpers/shortcuts'
import { setMermaidRuntimeSource } from '@/vendor/meo/webview/helpers/mermaidDiagram'
import { cancelPendingWikiStatusRefresh, handleResolvedWikiLinks, initializeWikiLinkHandling, requestWikiLinkStatuses, scheduleWikiLinkStatusRefresh, setWikiLinkRefreshContext } from '@/vendor/meo/webview/helpers/wikiLinks'
import { meoMermaidRuntimeUrl } from '@/features/editor/lib/meo-mermaid-runtime-url'
import {
  createMeoDiffSplitController,
  type MeoDiffSplitController,
  type MeoDiffViewMode,
} from '@/features/editor/lib/meo-native-diff-split'
import {
  createMeoLiveInlineDiffController,
  type MeoLiveInlineDiffController,
} from '@/features/editor/lib/meo-native-live-inline-diff'
import { mountMeoBaseScrollArea } from '@/features/editor/lib/meo-base-scroll-area'
import { createMeoViewPositionPersistenceController } from '@/features/editor/lib/meo-native-editor-persistence'
import type { NativeMeoEditorShell } from '@/features/editor/lib/meo-native-editor-shell'
import { getOpenFileProfileDuration, recordOpenFileProfile } from '@/lib/open-file-profile'
import type {
  MeoEditorCreateOptions,
  MeoEditorInsertFormat,
  MeoEditorInstance,
  MeoEditorMode,
  MountNativeMeoEditorOptions,
  NativeMeoController,
  NativeMeoMessage,
} from '@/features/editor/lib/meo-native-editor-types'

const SPLIT_PARENT_CHANGE_FLUSH_DELAY_MS = 50
const DOCUMENT_FIND_REFRESH_DELAY_MS = 120

type NativeMeoEditorMountOptions = MountNativeMeoEditorOptions & {
  shell: NativeMeoEditorShell
}

function isDiffMode(mode: MeoEditorMode): mode is 'diff-split' | 'diff-unified' {
  return mode === 'diff-split' || mode === 'diff-unified'
}

function getDiffViewMode(mode: MeoEditorMode): MeoDiffViewMode {
  return mode === 'diff-unified' ? 'unified' : 'split'
}

function buildUnavailableBlameResult(
  reason: 'not-repo' | 'untracked' | 'git-unavailable' | 'error',
): GitBlameResult {
  return { kind: 'unavailable', reason }
}

export function mountNativeMeoEditor({
  environment,
  filePath,
  gitChangeContext,
  initialValue,
  meoSettings,
  onChange,
  onCompositionChange,
  onOpenFile,
  onOpenGitDiff,
  onApplyGitDiffSelection,
  onSave,
  savedValue,
  shell,
  workspacePath,
}: NativeMeoEditorMountOptions): NativeMeoController {
  const root = shell.root
  const mountStartedAt = performance.now()
  recordOpenFileProfile('native-meo:mount:start', {
    filePath,
    initialChars: initialValue.length,
    workspacePath: workspacePath ?? null,
  })
  let currentText = initialValue
  let currentSavedText = savedValue
  let focusedLineHighlightVisible = meoSettings.focusedLineHighlight
  let gitDiffLineHighlightsEnabled = meoSettings.gitDiffLineHighlights
  let destroyed = false
  let compositionState = false
  const previousMermaidRuntimeSource = setMermaidRuntimeSource(meoMermaidRuntimeUrl)
  const {
    cancelScheduledViewPositionCapture,
    controller: persistenceController,
  } = createMeoViewPositionPersistenceController({
    filePath,
    getEditorPosition: () => (
      isDiffMode(currentMode)
        ? diffSplitController?.getTopVisiblePosition() ?? null
        : editor ? editor.getTopVisiblePosition() : null
    ),
    getMode: () => currentMode,
  })
  let currentMode: MeoEditorMode = persistenceController.getInitialMode()
  const initialRestoreTopLine = persistenceController.getInitialRestoreTopLine(currentMode)
  const initialRestoreTopLineOffset = persistenceController.getInitialRestoreTopLineOffset(currentMode)
  let persistedWebviewState: unknown = { mode: currentMode }
  let lineNumbersVisible = persistenceController.getInitialLineNumbersVisible()
  let gitChangesGutterVisible = persistenceController.getInitialGitChangesGutterVisible()
  let currentGitBaseline: GitBaselinePayload | null = null
  let currentGitChangeContext = gitChangeContext
  let pendingOutlineRefreshFrame = 0
  let pendingResizeFrame = 0
  let pendingFindStatusRefreshFrame = 0
  let pendingFindStatusRefreshTimer = 0
  let pendingLiveInlineDiffFrame = 0
  let pendingLiveInlineDiffTimer = 0
  let pendingSplitParentChangeFrame = 0
  let pendingSplitParentChangeText: string | null = null
  let pendingSplitParentChangeTimer = 0
  let editor: MeoEditorInstance | null = null
  let editorScrollArea: ReturnType<typeof mountMeoBaseScrollArea> | null = null
  let diffSplitController: MeoDiffSplitController | null = null
  let liveInlineDiffController: MeoLiveInlineDiffController | null = null

  const getActiveEditor = () => (
    isDiffMode(currentMode) ? diffSplitController : editor
  )

  const vscode = {
    getState: () => persistedWebviewState,
    postMessage: (message: NativeMeoMessage) => {
      void handleNativeMessage(message)
    },
    setState: (nextState: unknown) => {
      persistedWebviewState = nextState
      return nextState
    },
  }

  initializeImageHandling(vscode)
  initializeWikiLinkHandling(vscode)
  initializeLocalLinkHandling(vscode)
  setImageSrcResolver(resolveImageSrc)

  shell.setEditorGetter(getActiveEditor)
  const {
    buttons: {
      bulletListBtn,
      codeBlockBtn,
      diffNextChangeBtn,
      diffPreviousChangeBtn,
      findToggleBtn,
      gitChangesGutterBtn,
      hrBtn,
      imageBtn,
      lineNumbersBtn,
      linkBtn,
      numberedListBtn,
      outlineBtn,
      quoteBtn,
      tableBtn,
      taskBtn,
      wikiLinkBtn,
    },
    editorHost,
    findPanelElements,
    modeGroup,
    outlineController,
    selectionMenuElements,
    toolbar,
  } = shell
  editorHost.replaceChildren()

  const cancelScheduledOutlineRefresh = () => {
    if (pendingOutlineRefreshFrame) {
      window.cancelAnimationFrame(pendingOutlineRefreshFrame)
      pendingOutlineRefreshFrame = 0
    }
  }

  const scheduleOutlineRefreshIfVisible = () => {
    if (!outlineController.isVisible() || pendingOutlineRefreshFrame) {
      return
    }

    pendingOutlineRefreshFrame = window.requestAnimationFrame(() => {
      pendingOutlineRefreshFrame = 0
      if (!destroyed && outlineController.isVisible()) {
        outlineController.refresh()
      }
    })
  }

  const cancelScheduledResizeRefresh = () => {
    if (pendingResizeFrame) {
      window.cancelAnimationFrame(pendingResizeFrame)
      pendingResizeFrame = 0
    }
  }

  const findPanelController = createFindPanelController(
    findPanelElements,
    getActiveEditor,
    toolbar,
    modeGroup,
  )
  const selectionMenuController = createSelectionMenuController(selectionMenuElements, getActiveEditor)
  const updateSelectionMenu = (selectionState: Parameters<typeof selectionMenuController.update>[0]) => {
    if (
      selectionState?.visible !== true
      && document.activeElement instanceof HTMLElement
      && selectionMenuElements.menu.contains(document.activeElement)
    ) {
      document.activeElement.blur()
    }
    selectionMenuController.update(selectionState)
    selectionMenuElements.menu.setAttribute(
      'aria-hidden',
      selectionState?.visible === true ? 'false' : 'true',
    )
  }

  const syncFindPanelToggleUi = () => {
    const visible = findPanelController.isVisible()
    findToggleBtn.setAttribute('aria-pressed', visible ? 'true' : 'false')
    if (visible) {
      findToggleBtn.setAttribute('data-active', 'true')
    } else {
      findToggleBtn.removeAttribute('data-active')
    }
  }

  const openFindPanel = (target: 'find' | 'replace' = 'find') => {
    findPanelController.open(target)
    findPanelElements.panel.setAttribute('aria-hidden', 'false')
    syncFindPanelToggleUi()
  }

  const closeFindPanel = () => {
    findPanelController.close()
    findPanelElements.panel.setAttribute('aria-hidden', 'true')
    syncFindPanelToggleUi()
  }

  const cancelScheduledFindStatusRefresh = () => {
    if (pendingFindStatusRefreshTimer) {
      window.clearTimeout(pendingFindStatusRefreshTimer)
      pendingFindStatusRefreshTimer = 0
    }
    if (pendingFindStatusRefreshFrame) {
      window.cancelAnimationFrame(pendingFindStatusRefreshFrame)
      pendingFindStatusRefreshFrame = 0
    }
  }

  const scheduleFindStatusRefresh = () => {
    if (pendingFindStatusRefreshTimer) {
      window.clearTimeout(pendingFindStatusRefreshTimer)
      pendingFindStatusRefreshTimer = 0
    }

    pendingFindStatusRefreshTimer = window.setTimeout(() => {
      pendingFindStatusRefreshTimer = 0
      if (pendingFindStatusRefreshFrame) {
        return
      }

      pendingFindStatusRefreshFrame = window.requestAnimationFrame(() => {
        pendingFindStatusRefreshFrame = 0
        if (!destroyed) {
          findPanelController.updateFindStatusSummary()
        }
      })
    }, DOCUMENT_FIND_REFRESH_DELAY_MS)
  }

  const cancelScheduledLiveInlineDiff = () => {
    if (pendingLiveInlineDiffTimer) {
      window.clearTimeout(pendingLiveInlineDiffTimer)
      pendingLiveInlineDiffTimer = 0
    }
    if (pendingLiveInlineDiffFrame) {
      window.cancelAnimationFrame(pendingLiveInlineDiffFrame)
      pendingLiveInlineDiffFrame = 0
    }
  }

  const cancelPendingSplitParentChange = () => {
    if (pendingSplitParentChangeTimer) {
      window.clearTimeout(pendingSplitParentChangeTimer)
      pendingSplitParentChangeTimer = 0
    }
    if (pendingSplitParentChangeFrame) {
      window.cancelAnimationFrame(pendingSplitParentChangeFrame)
      pendingSplitParentChangeFrame = 0
    }
  }

  const flushPendingSplitParentChange = () => {
    if (pendingSplitParentChangeText === null) {
      cancelPendingSplitParentChange()
      return null
    }

    const nextText = pendingSplitParentChangeText
    pendingSplitParentChangeText = null
    cancelPendingSplitParentChange()
    onChange(nextText)
    return nextText
  }

  const scheduleSplitParentChange = (nextText: string) => {
    pendingSplitParentChangeText = nextText
    if (pendingSplitParentChangeTimer) {
      window.clearTimeout(pendingSplitParentChangeTimer)
      pendingSplitParentChangeTimer = 0
    }

    pendingSplitParentChangeTimer = window.setTimeout(() => {
      pendingSplitParentChangeTimer = 0
      if (pendingSplitParentChangeFrame) {
        return
      }

      pendingSplitParentChangeFrame = window.requestAnimationFrame(() => {
        pendingSplitParentChangeFrame = 0
        flushPendingSplitParentChange()
      })
    }, SPLIT_PARENT_CHANGE_FLUSH_DELAY_MS)
  }

  const emitContentChange = (
    nextText: string,
    options: { deferParent?: boolean, deferFindStatus?: boolean } = {},
  ) => {
    currentText = nextText
    if (options.deferParent) {
      scheduleSplitParentChange(nextText)
    } else {
      const flushedText = flushPendingSplitParentChange()
      if (flushedText !== nextText) {
        onChange(nextText)
      }
    }

    scheduleWikiLinkStatusRefresh(nextText)
    scheduleLocalLinkStatusRefresh(nextText)
    if (options.deferFindStatus) {
      scheduleFindStatusRefresh()
    } else {
      cancelScheduledFindStatusRefresh()
      findPanelController.updateFindStatusSummary()
    }
    scheduleOutlineRefreshIfVisible()
  }

  const updateModeUi = () => {
    shell.setMode(currentMode)
    editorHost.classList.toggle('meo-diff-split-active', isDiffMode(currentMode))
    root.classList.toggle('is-diff-mode', isDiffMode(currentMode))
    root.classList.toggle('is-diff-split-mode', currentMode === 'diff-split')
    root.classList.toggle('is-diff-unified-mode', currentMode === 'diff-unified')
  }

  const updateLineNumbersUi = () => {
    lineNumbersBtn.classList.toggle('is-active', lineNumbersVisible)
    lineNumbersBtn.setAttribute('aria-pressed', lineNumbersVisible ? 'true' : 'false')
    if (lineNumbersVisible) {
      lineNumbersBtn.setAttribute('data-active', 'true')
    } else {
      lineNumbersBtn.removeAttribute('data-active')
    }
  }

  const updateGitChangesGutterUi = () => {
    gitChangesGutterBtn.classList.toggle('is-active', gitChangesGutterVisible)
    gitChangesGutterBtn.setAttribute('aria-pressed', gitChangesGutterVisible ? 'true' : 'false')
    if (gitChangesGutterVisible) {
      gitChangesGutterBtn.setAttribute('data-active', 'true')
    } else {
      gitChangesGutterBtn.removeAttribute('data-active')
    }
  }

  const syncGitDiffLineHighlights = () => {
    if (!editor) {
      return
    }

    if (currentMode !== 'source') {
      return
    }

    setGitDiffLineHighlightsEnabled(
      editor,
      gitChangesGutterVisible && gitDiffLineHighlightsEnabled,
    )
  }

  const setLineNumbersVisible = (visible: boolean, options?: { persist?: boolean }) => {
    lineNumbersVisible = visible !== false
    editor?.setLineNumbers(lineNumbersVisible)
    diffSplitController?.setLineNumbersVisible(lineNumbersVisible)
    liveInlineDiffController?.setLineNumbersVisible(lineNumbersVisible)
    updateLineNumbersUi()
    if (options?.persist !== false) {
      persistenceController.persistLineNumbersVisible(lineNumbersVisible)
    }
  }

  const setGitChangesGutterVisible = (visible: boolean, options?: { persist?: boolean }) => {
    gitChangesGutterVisible = visible !== false
    editor?.setGitGutterVisible(gitChangesGutterVisible)
    diffSplitController?.setDiffGutterVisible(gitChangesGutterVisible)
    liveInlineDiffController?.setDiffGutterVisible(gitChangesGutterVisible)
    updateGitChangesGutterUi()
    syncGitDiffLineHighlights()
    if (options?.persist !== false) {
      persistenceController.persistGitChangesGutterVisible(gitChangesGutterVisible)
    }
  }

  const setOutlineVisible = (visible: boolean, options?: { persist?: boolean }) => {
    outlineController.setVisible(visible === true)
    if (options?.persist !== false) {
      persistenceController.persistOutlineVisible(visible === true)
    }
  }

  const updateCompositionState = (nextValue: boolean) => {
    if (compositionState === nextValue) {
      return
    }
    compositionState = nextValue
    liveInlineDiffController?.setCompositionActive(nextValue)
    onCompositionChange?.(nextValue)
  }

  const destroyDiffSplit = () => {
    diffSplitController?.destroy()
    diffSplitController = null
  }

  const ensureDiffSplit = (viewMode: MeoDiffViewMode = getDiffViewMode(currentMode)) => {
    if (diffSplitController) {
      diffSplitController.setViewMode(viewMode)
      diffSplitController.setText(currentText)
      diffSplitController.setBaseline(currentGitBaseline)
      diffSplitController.setFallbackOriginal({
        label: 'Saved document',
        text: currentSavedText,
      })
      diffSplitController.setGitChangeContext(currentGitChangeContext)
      diffSplitController.setDiffGutterVisible(gitChangesGutterVisible)
      diffSplitController.setLineNumbersVisible(lineNumbersVisible)
      return
    }

    const diffSplitStartedAt = performance.now()
    recordOpenFileProfile('native-meo:create-diff-split-controller:start', {
      filePath,
      textChars: currentText.length,
      viewMode,
    })
    diffSplitController = createMeoDiffSplitController({
      baseline: currentGitBaseline,
      diffGutterVisible: gitChangesGutterVisible,
      fallbackOriginalLabel: 'Saved document',
      fallbackOriginalText: currentSavedText,
      focusedLineHighlightVisible,
      gitChangeContext: currentGitChangeContext,
      lineNumbersVisible,
      onChange: (nextValue) => {
        emitContentChange(nextValue, {
          deferFindStatus: true,
          deferParent: true,
        })
      },
      onCompositionChange: updateCompositionState,
      onOpenLink: (href) => {
        void openLink(href)
      },
      onApplyGitDiffSelection,
      onSave: (nextValue) => {
        onSave?.(nextValue)
      },
      onSelectionChange: (selectionState) => {
        updateSelectionMenu(selectionState)
      },
      onViewportChange: () => {
        persistenceController.scheduleViewPositionCapture()
      },
      parent: editorHost,
      text: currentText,
      viewMode,
    })
    recordOpenFileProfile('native-meo:create-diff-split-controller:end', {
      durationMs: getOpenFileProfileDuration(diffSplitStartedAt),
      filePath,
      viewMode,
    })
  }

  const applyMode = (mode: MeoEditorMode, options?: { persist?: boolean }) => {
    const nextMode = mode === 'diff-split' || mode === 'diff-unified' ? mode : mode === 'live' ? 'live' : 'source'
    const previousMode = currentMode
    const previousTopPosition = getActiveEditor()?.getTopVisiblePosition?.() ?? null
    if (nextMode === currentMode) {
      if (isDiffMode(nextMode)) {
        ensureDiffSplit(getDiffViewMode(nextMode))
        updateModeUi()
        diffSplitController?.refreshLayout()
      }
      return
    }

    cancelScheduledViewPositionCapture()
    persistenceController.captureViewPosition(previousMode)
    if (isDiffMode(currentMode)) {
      flushPendingSplitParentChange()
    }
    currentMode = nextMode
    const storedTopPosition = persistenceController.getStoredViewPosition(currentMode)
    const restoreTopPosition = storedTopPosition
      ? {
        line: storedTopPosition.topLine,
        lineOffset: storedTopPosition.topLineOffset,
      }
      : previousTopPosition
    if (isDiffMode(currentMode)) {
      ensureDiffSplit(getDiffViewMode(currentMode))
      if (restoreTopPosition) {
        diffSplitController?.restoreTopLine(restoreTopPosition.line, restoreTopPosition.lineOffset)
      }
    } else {
      destroyDiffSplit()
      const primaryEditor = ensurePrimaryEditor('mode-switch')
      primaryEditor.setText(currentText)
      primaryEditor.setMode(currentMode)
      if (currentGitBaseline) {
        primaryEditor.setGitBaseline(currentGitBaseline)
      }
      scheduleLiveInlineDiffController()
      if (restoreTopPosition) {
        primaryEditor.restoreTopLine(restoreTopPosition.line, restoreTopPosition.lineOffset)
      }
    }
    updateModeUi()
    syncGitDiffLineHighlights()
    vscode.setState({ mode: currentMode })
    if (outlineController.isVisible()) {
      scheduleOutlineRefreshIfVisible()
    }
    if (options?.persist !== false) {
      persistenceController.persistMode(currentMode)
    }
  }

  const openLink = async (href: string) => {
    if (!href.trim() || href.startsWith('#')) {
      return
    }

    if (isExternalHref(href)) {
      environment.openExternalLink(href)
      return
    }

    const result = await resolveOpenLinkFilePath(
      filePath,
      workspacePath,
      href,
      environment.appApi.workspaceFileExists,
    )

    if (result.exists && result.filePath) {
      onOpenFile?.(result.filePath)
    }
  }

  const openGitMarkerInDiffSplit = (
    scope: 'staged' | 'unstaged',
    options: { lineNumber?: number } = {},
  ) => {
    const lineNumber = typeof options.lineNumber === 'number'
      ? Math.max(1, Math.floor(options.lineNumber))
      : null

    if (lineNumber === null) {
      applyMode('diff-split')
      return
    }

    ensureDiffSplit()
    const didNavigate = diffSplitController?.revealGitChangeLine({
      lineNumber,
      scope,
    }) === true

    if (didNavigate) {
      applyMode('diff-split')
      return
    }

    onOpenGitDiff?.(filePath, {
      lineNumber,
      source: scope === 'staged' ? 'revision' : 'worktree',
    })
  }

  const handleNativeMessage = async (message: NativeMeoMessage) => {
    switch (message.type) {
      case 'saveDocument':
        flushPendingSplitParentChange()
        onSave?.(isDiffMode(currentMode) ? diffSplitController?.getText() ?? currentText : ensurePrimaryEditor('save-document').getText())
        return
      case 'setMode':
        if (message.mode === 'live' || message.mode === 'source' || message.mode === 'diff-split' || message.mode === 'diff-unified') {
          applyMode(message.mode)
        }
        return
      case 'setLineNumbers': {
        const nextVisible = message.visible ?? message.enabled
        if (typeof nextVisible === 'boolean') {
          setLineNumbersVisible(nextVisible)
        }
        return
      }
      case 'setGitChangesGutter': {
        const nextVisible = message.visible ?? message.enabled
        if (typeof nextVisible === 'boolean') {
          setGitChangesGutterVisible(nextVisible)
        }
        return
      }
      case 'setOutlineVisible':
        if (typeof message.visible === 'boolean') {
          setOutlineVisible(message.visible)
        }
        return
      case 'setFindOptions':
        persistenceController.persistFindOptions(message.findOptions)
        return
      case 'viewPositionChanged':
        persistenceController.persistViewPositionFromMessage(
          {
            topLine: typeof message.topLine === 'number' ? message.topLine : undefined,
            topLineOffset: typeof message.topLineOffset === 'number' ? message.topLineOffset : undefined,
          },
          currentMode,
        )
        return
      case 'openLink':
        if (typeof message.href === 'string') {
          await openLink(message.href)
        }
        return
      case 'resolveImageSrc':
        settleImageSrcRequest(
          typeof message.requestId === 'string' ? message.requestId : '',
          typeof message.url === 'string' ? resolveImageUrl(filePath, message.url) : '',
        )
        return
      case 'resolveLocalLinks': {
        const results = await resolveLocalLinkResults(
          filePath,
          workspacePath,
          Array.isArray(message.targets) ? message.targets : [],
          environment.appApi.workspaceFileExists,
        )
        handleResolvedLocalLinks({
          requestId: typeof message.requestId === 'string' ? message.requestId : '',
          results: results.map(({ exists, target }) => ({ exists, target })),
        })
        getActiveEditor()?.refreshDecorations?.()
        return
      }
      case 'resolveWikiLinks': {
        const results = await resolveWikiLinkResults(
          filePath,
          workspacePath,
          Array.isArray(message.targets) ? message.targets : [],
          environment.appApi.workspaceFileExists,
        )
        handleResolvedWikiLinks({
          requestId: typeof message.requestId === 'string' ? message.requestId : '',
          results: results.map(({ exists, target }) => ({ exists, target })),
        })
        getActiveEditor()?.refreshDecorations?.()
        return
      }
      case 'saveImageFromClipboard': {
        if (!workspacePath) {
          handleSavedImagePath({
            error: 'No workspace folder is open.',
            requestId: typeof message.requestId === 'string' ? message.requestId : '',
            success: false,
          })
          return
        }

        try {
          const { filePath: savedImagePath } = await environment.appApi.saveWorkspaceImage(
            workspacePath,
            meoSettings.imageFolder,
            typeof message.fileName === 'string' ? message.fileName : 'pasted-image.png',
            typeof message.imageData === 'string' ? message.imageData : '',
          )

          handleSavedImagePath({
            path: getRelativeFsPath(filePath, savedImagePath),
            requestId: typeof message.requestId === 'string' ? message.requestId : '',
            success: true,
          })
        } catch (error) {
          handleSavedImagePath({
            error: error instanceof Error ? error.message : 'Failed to save image.',
            requestId: typeof message.requestId === 'string' ? message.requestId : '',
            success: false,
          })
        }
        return
      }
      default:
        return
    }
  }

  updateModeUi()
  updateLineNumbersUi()
  updateGitChangesGutterUi()
  outlineController.setPosition(meoSettings.outlinePosition)
  setOutlineVisible(persistenceController.getInitialOutlineVisible(), { persist: false })
  findPanelController.setSearchOptions(persistenceController.getFindOptions())

  const createVendorEditor = createEditor as unknown as (options: MeoEditorCreateOptions) => MeoEditorInstance
  const ensurePrimaryEditor = (
    reason: 'api' | 'focus' | 'initial' | 'live-inline-diff' | 'mode-switch' | 'paste' | 'save-document' | 'shortcut' | 'set-text',
  ) => {
    if (editor) {
      return editor
    }

    const primaryEditorMode = isDiffMode(currentMode) ? 'live' : currentMode
    const vendorEditorStartedAt = performance.now()
    recordOpenFileProfile('native-meo:create-vendor-editor:start', {
      deferredContentChars: 0,
      filePath,
      initialChars: currentText.length,
      mode: currentMode,
      reason,
    })
    const primaryEditor = createVendorEditor({
      initialGitGutter: gitChangesGutterVisible,
      initialLineNumbers: lineNumbersVisible,
      initialMode: primaryEditorMode,
      initialFocusedLineHighlight: focusedLineHighlightVisible,
      text: currentText,
      initialTopLine: initialRestoreTopLine,
      initialTopLineOffset: initialRestoreTopLineOffset,
      initialVimMode: false,
      onApplyChanges: (nextText: string) => {
        emitContentChange(nextText)
      },
      onOpenGitRevisionForLine: (options: { lineNumber?: number }) => {
        openGitMarkerInDiffSplit('staged', options)
      },
      onOpenGitWorktreeForLine: (options: { lineNumber?: number }) => {
        openGitMarkerInDiffSplit('unstaged', options)
      },
      onToggleGitInlineSplitForLine: (request: { hunkId?: string, lineNumber?: number, scope: 'staged' | 'unstaged' }) => (
        liveInlineDiffController?.toggleHunkForLine(request) ?? false
      ),
      onOpenLink: (href: string) => {
        void openLink(href)
      },
      onRequestGitBlame: async (request: { lineNumber?: number }) => {
        if (!workspacePath) {
          return buildUnavailableBlameResult('not-repo')
        }

        return environment.appApi.getGitLineBlame(
          workspacePath,
          filePath,
          typeof request.lineNumber === 'number' ? request.lineNumber : 1,
        )
      },
      onSelectionChange: (selectionState: { visible?: boolean, anchorX?: number, anchorY?: number } | null) => {
        updateSelectionMenu(selectionState)
      },
      onViewportChange: () => {
        persistenceController.scheduleViewPositionCapture()
      },
      parent: editorHost,
    })
    editor = primaryEditor
    recordOpenFileProfile('native-meo:create-vendor-editor:end', {
      durationMs: getOpenFileProfileDuration(vendorEditorStartedAt),
      elapsedMs: getOpenFileProfileDuration(mountStartedAt),
      filePath,
      reason,
    })
    const editorScrollDOM = primaryEditor.view.scrollDOM
    const editorDOM = primaryEditor.view.dom
    if (editorScrollDOM instanceof HTMLElement && editorDOM instanceof HTMLElement) {
      const scrollAreaStartedAt = performance.now()
      editorScrollArea = mountMeoBaseScrollArea({
        className: 'meo-editor-base-scroll-area',
        hostParent: editorDOM,
        viewport: editorScrollDOM,
      })
      recordOpenFileProfile('native-meo:mount-scroll-area:end', {
        durationMs: getOpenFileProfileDuration(scrollAreaStartedAt),
        elapsedMs: getOpenFileProfileDuration(mountStartedAt),
        filePath,
      })
    }
    syncGitDiffLineHighlights()
    return primaryEditor
  }

  if (!isDiffMode(currentMode)) {
    ensurePrimaryEditor('initial')
  }

  const createLiveInlineDiffControllerWhenReady = (reason: 'deferred' | 'immediate') => {
    if (destroyed || liveInlineDiffController) {
      return
    }

    const liveDiffStartedAt = performance.now()
    recordOpenFileProfile('native-meo:create-live-inline-diff:start', {
      elapsedMs: getOpenFileProfileDuration(mountStartedAt),
      filePath,
      reason,
    })
    const primaryEditor = ensurePrimaryEditor('live-inline-diff')
    liveInlineDiffController = createMeoLiveInlineDiffController({
      baseline: currentGitBaseline,
      diffGutterVisible: gitChangesGutterVisible,
      fallbackOriginalLabel: 'Saved document',
      fallbackOriginalText: currentSavedText,
      focusedLineHighlightVisible,
      gitChangeContext: currentGitChangeContext,
      lineNumbersVisible,
      onApplyGitDiffSelection,
      onCompositionChange: updateCompositionState,
      onOpenLink: (href) => {
        void openLink(href)
      },
      onSave: (nextValue) => {
        onSave?.(nextValue)
      },
      onSelectionChange: (selectionState) => {
        updateSelectionMenu(selectionState)
      },
      onViewportChange: () => {
        persistenceController.scheduleViewPositionCapture()
      },
      text: currentText,
      view: primaryEditor.view as unknown as import('@codemirror/view').EditorView,
    })
    if (compositionState) {
      liveInlineDiffController.setCompositionActive(compositionState)
    }
    recordOpenFileProfile('native-meo:create-live-inline-diff:end', {
      durationMs: getOpenFileProfileDuration(liveDiffStartedAt),
      elapsedMs: getOpenFileProfileDuration(mountStartedAt),
      filePath,
      reason,
    })
  }

  const scheduleLiveInlineDiffController = () => {
    if (pendingLiveInlineDiffFrame || pendingLiveInlineDiffTimer || liveInlineDiffController) {
      return
    }

    pendingLiveInlineDiffFrame = window.requestAnimationFrame(() => {
      pendingLiveInlineDiffFrame = 0
      pendingLiveInlineDiffTimer = window.setTimeout(() => {
        pendingLiveInlineDiffTimer = 0
        createLiveInlineDiffControllerWhenReady('deferred')
      }, 0)
    })
  }

  if (!isDiffMode(currentMode)) {
    scheduleLiveInlineDiffController()
  }

  syncGitDiffLineHighlights()
  if (isDiffMode(currentMode)) {
    ensureDiffSplit(getDiffViewMode(currentMode))
    if (typeof initialRestoreTopLine === 'number') {
      ;(diffSplitController as MeoDiffSplitController | null)?.restoreTopLine(
        initialRestoreTopLine,
        initialRestoreTopLineOffset,
      )
    }
    updateModeUi()
  }
  recordOpenFileProfile('native-meo:mount:end', {
    durationMs: getOpenFileProfileDuration(mountStartedAt),
    filePath,
  })
  requestWikiLinkStatuses(initialValue)
  requestLocalLinkStatuses(initialValue)

  setWikiLinkRefreshContext({
    refreshDecorations: () => getActiveEditor()?.refreshDecorations?.(),
  })
  setLocalLinkRefreshContext({
    refreshDecorations: () => getActiveEditor()?.refreshDecorations?.(),
  })

  const focusEditor = () => {
    if (isDiffMode(currentMode)) {
      diffSplitController?.focus()
      return
    }

    ensurePrimaryEditor('focus').focus()
  }

  const toggleFindPanel = () => {
    if (findPanelController.isVisible()) {
      closeFindPanel()
      return
    }

    openFindPanel('find')
  }

  const handleFormatAction = (action: MeoEditorInsertFormat, options?: unknown) => {
    const activeEditor = getActiveEditor()
    if (!activeEditor) {
      return
    }

    activeEditor.insertFormat(action, options)
    activeEditor.focus()
  }

  shell.setHeadingLevelHandler((level) => {
    handleFormatAction('heading', level)
    focusEditor()
  })
  shell.setModeChangeHandler(applyMode)

  const isEventInsideMeoSurface = (eventTarget: EventTarget | null) => (
    eventTarget instanceof Node && root.contains(eventTarget)
  )

  const isEventInsideDiffEditablePane = (eventTarget: EventTarget | null) => (
    eventTarget instanceof Node && diffSplitController?.view.dom.contains(eventTarget) === true
  )

  const shortcutHandler = (event: KeyboardEvent) => {
    const hasEditorFocus = isDiffMode(currentMode)
      ? diffSplitController?.hasFocus() === true
      : ensurePrimaryEditor('shortcut').hasFocus()

    if (!hasEditorFocus && !isEventInsideMeoSurface(event.target)) {
      return
    }

    if (event.key === 'Escape' && findPanelController.isVisible()) {
      event.preventDefault()
      event.stopPropagation()
      closeFindPanel()
      return
    }

    if (isDiffMode(currentMode)) {
      const isSaveShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's'
      if (isSaveShortcut) {
        event.preventDefault()
        flushPendingSplitParentChange()
        onSave?.(diffSplitController?.getText() ?? currentText)
        return
      }

      const hasPrimaryModifier = isPrimaryModifier(event)
      const isPlainAltShiftChord = event.altKey && event.shiftKey && !event.metaKey && !event.ctrlKey
      if (isPlainAltShiftChord && isShortcutKey(event, 'm', 'KeyM')) {
        event.preventDefault()
        event.stopPropagation()
        applyMode('live')
        return
      }

      if (hasPrimaryModifier && isShortcutKey(event, 'f', 'KeyF') && !event.altKey && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        openFindPanel('find')
        return
      }

      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
      if (
        hasPrimaryModifier
        && (
          (isMac && isShortcutKey(event, 'f', 'KeyF') && event.altKey)
          || (!isMac && isShortcutKey(event, 'h', 'KeyH') && !event.altKey)
        )
      ) {
        event.preventDefault()
        event.stopPropagation()
        openFindPanel('replace')
        return
      }

      if (diffSplitController?.hasFocus() && hasPrimaryModifier && isShortcutKey(event, 'a', 'KeyA') && !event.altKey) {
        event.preventDefault()
        event.stopPropagation()
        diffSplitController.selectAll()
        return
      }

      if (diffSplitController?.hasFocus() && hasPrimaryModifier && isShortcutKey(event, 'z', 'KeyZ') && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        event.stopPropagation()
        diffSplitController.undo()
        return
      }

      const redoByShiftZ = isShortcutKey(event, 'z', 'KeyZ') && event.shiftKey
      const redoByY = isShortcutKey(event, 'y', 'KeyY')
      if (diffSplitController?.hasFocus() && hasPrimaryModifier && (redoByShiftZ || redoByY) && !event.altKey) {
        event.preventDefault()
        event.stopPropagation()
        diffSplitController.redo()
      }
      return
    }

    const primaryEditor = ensurePrimaryEditor('shortcut')
    handleEditorShortcut(event, {
      applyMode: (mode) => {
        applyMode(mode)
        return true
      },
      currentMode,
      editor: primaryEditor,
      flushPendingChangesNow: () => undefined,
      openFindPanel,
      pendingText: null,
      requestSave: () => {
        onSave?.(primaryEditor.getText())
      },
      syncedText: normalizeEol(currentText),
      vimModeEnabled: false,
    })
  }

  const pasteHandler = async (event: ClipboardEvent) => {
    if (isDiffMode(currentMode)) {
      if (diffSplitController?.hasFocus() !== true && !isEventInsideDiffEditablePane(event.target)) {
        return
      }

      const selection = diffSplitController?.view.state.selection.main
      if (!selection || !diffSplitController) {
        return
      }

      const line = diffSplitController.view.state.doc.lineAt(selection.head)
      await handleImagePaste(event, diffSplitController, {
        lineNumber: line.number,
        lineOffset: selection.head - line.from,
      })
      return
    }

    const primaryEditor = ensurePrimaryEditor('paste')
    if (!primaryEditor.hasFocus() && !isEventInsideMeoSurface(event.target)) {
      return
    }

    const selection = primaryEditor.view.state.selection.main
    const line = primaryEditor.view.state.doc.lineAt(selection.head)
    await handleImagePaste(event, primaryEditor, {
      lineNumber: line.number,
      lineOffset: selection.head - line.from,
    })
  }

  const resizeHandler = () => {
    if (pendingResizeFrame) {
      return
    }

    pendingResizeFrame = window.requestAnimationFrame(() => {
      pendingResizeFrame = 0
      if (destroyed) {
        return
      }
      findPanelController.updateAnchor()
      editor?.refreshSelectionOverlay()
      editor?.refreshLayout()
      diffSplitController?.refreshLayout()
    })
  }

  const blurHandler = () => {
    updateCompositionState(false)
    persistenceController.captureViewPosition()
  }

  const visibilityHandler = () => {
    if (document.visibilityState !== 'visible') {
      updateCompositionState(false)
      persistenceController.captureViewPosition()
      return
    }

    editor?.refreshLayout()
    diffSplitController?.refreshLayout()
  }

  const compositionStartHandler = () => {
    updateCompositionState(true)
  }

  const compositionEndHandler = () => {
    updateCompositionState(false)
  }

  const eventAbortController = new AbortController()
  const eventOptions = { signal: eventAbortController.signal }
  const captureEventOptions = { capture: true, signal: eventAbortController.signal }

  window.addEventListener('keydown', shortcutHandler, captureEventOptions)
  window.addEventListener('paste', pasteHandler, eventOptions)
  window.addEventListener('resize', resizeHandler, eventOptions)
  window.addEventListener('blur', blurHandler, eventOptions)
  document.addEventListener('visibilitychange', visibilityHandler, eventOptions)
  root.addEventListener('compositionstart', compositionStartHandler, captureEventOptions)
  root.addEventListener('compositionend', compositionEndHandler, captureEventOptions)
  bulletListBtn.addEventListener('click', () => handleFormatAction('bulletList'), eventOptions)
  numberedListBtn.addEventListener('click', () => handleFormatAction('numberedList'), eventOptions)
  taskBtn.addEventListener('click', () => handleFormatAction('task'), eventOptions)
  tableBtn.addEventListener('click', () => {
    handleFormatAction('table', { cols: 3, rows: 3 })
  }, eventOptions)
  codeBlockBtn.addEventListener('click', () => handleFormatAction('codeBlock'), eventOptions)
  linkBtn.addEventListener('click', () => handleFormatAction('link'), eventOptions)
  wikiLinkBtn.addEventListener('click', () => handleFormatAction('wikiLink'), eventOptions)
  imageBtn.addEventListener('click', () => handleFormatAction('image'), eventOptions)
  quoteBtn.addEventListener('click', () => handleFormatAction('quote'), eventOptions)
  hrBtn.addEventListener('click', () => handleFormatAction('hr'), eventOptions)
  outlineBtn.addEventListener('click', () => {
    setOutlineVisible(!outlineController.isVisible())
  }, eventOptions)
  findToggleBtn.addEventListener('click', toggleFindPanel, eventOptions)
  lineNumbersBtn.addEventListener('click', () => {
    setLineNumbersVisible(!lineNumbersVisible)
  }, eventOptions)
  gitChangesGutterBtn.addEventListener('click', () => {
    setGitChangesGutterVisible(!gitChangesGutterVisible)
  }, eventOptions)
  diffPreviousChangeBtn.addEventListener('click', () => {
    diffSplitController?.previousChange()
    diffSplitController?.focus()
  }, eventOptions)
  diffNextChangeBtn.addEventListener('click', () => {
    diffSplitController?.nextChange()
    diffSplitController?.focus()
  }, eventOptions)
  findPanelElements.findInput.addEventListener('input', () => {
    findPanelController.updateFindStatusSummary()
  }, eventOptions)
  findPanelElements.wholeWordBtn.addEventListener('click', () => {
    findPanelController.toggleWholeWord()
    persistenceController.persistFindOptions(findPanelController.getSearchOptions())
  }, eventOptions)
  findPanelElements.caseSensitiveBtn.addEventListener('click', () => {
    findPanelController.toggleCaseSensitive()
    persistenceController.persistFindOptions(findPanelController.getSearchOptions())
  }, eventOptions)
  findPanelElements.findPrevBtn.addEventListener('click', () => {
    findPanelController.runFind(true)
  }, eventOptions)
  findPanelElements.findNextBtn.addEventListener('click', () => {
    findPanelController.runFind(false)
  }, eventOptions)
  findPanelElements.replaceBtn.addEventListener('click', () => {
    findPanelController.runReplace()
  }, eventOptions)
  findPanelElements.replaceAllBtn.addEventListener('click', () => {
    findPanelController.runReplaceAll()
  }, eventOptions)
  findPanelElements.findInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return
    }
    event.preventDefault()
    findPanelController.runFind(event.shiftKey, { focusEditor: false })
  }, eventOptions)
  findPanelElements.replaceInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return
    }
    event.preventDefault()
    findPanelController.runReplace()
  }, eventOptions)

  selectionMenuElements.menu.addEventListener('pointerdown', (event) => {
    event.preventDefault()
  }, eventOptions)
  selectionMenuElements.menu.addEventListener('click', (event) => {
    const button = (event.target as Element).closest('.selection-inline-button') as HTMLElement | null
    if (!button?.dataset.action) {
      return
    }
    selectionMenuController.handleAction(button.dataset.action)
  }, eventOptions)

  return {
    captureViewPosition() {
      persistenceController.captureViewPosition()
    },
    destroy() {
      if (destroyed) {
        return
      }
      destroyed = true
      updateCompositionState(false)
      cancelScheduledViewPositionCapture()
      cancelScheduledOutlineRefresh()
      cancelScheduledResizeRefresh()
      cancelScheduledFindStatusRefresh()
      cancelScheduledLiveInlineDiff()
      flushPendingSplitParentChange()
      cancelPendingWikiStatusRefresh()
      cancelPendingLocalLinkStatusRefresh()
      setWikiLinkRefreshContext({
        refreshDecorations: () => undefined,
      })
      setLocalLinkRefreshContext({
        refreshDecorations: () => undefined,
      })
      setMermaidRuntimeSource(previousMermaidRuntimeSource)
      eventAbortController.abort()
      persistenceController.captureViewPosition()
      destroyDiffSplit()
      liveInlineDiffController?.destroy()
      liveInlineDiffController = null
      editorScrollArea?.destroy()
      editorScrollArea = null
      editor?.destroy()
      editor = null
      shell.disconnectController()
    },
    focus() {
      focusEditor()
    },
    openGitDiff(request) {
      const nextMode = request.mode === 'unified' ? 'diff-unified' : 'diff-split'
      applyMode(nextMode)
      diffSplitController?.setPreferredGitDiffScope(request.scope)

      if (typeof request.lineNumber !== 'number') {
        diffSplitController?.focus()
        return
      }

      const lineNumber = Math.max(1, Math.floor(request.lineNumber))
      const didNavigate = diffSplitController?.revealGitChangeLine({
        lineNumber,
        scope: request.scope,
      }) === true

      if (!didNavigate) {
        diffSplitController?.scrollToLine(lineNumber, 'center')
      }
      diffSplitController?.focus()
    },
    refreshLayout() {
      if (isDiffMode(currentMode)) {
        diffSplitController?.refreshLayout()
      } else {
        ensurePrimaryEditor('api').refreshLayout()
        editorScrollArea?.refresh()
        liveInlineDiffController?.refreshLayout()
      }
    },
    setGitBaseline(baseline) {
      currentGitBaseline = baseline
      if (!isDiffMode(currentMode)) {
        ensurePrimaryEditor('api').setGitBaseline(baseline)
      }
      diffSplitController?.setBaseline(baseline)
      liveInlineDiffController?.setBaseline(baseline)
    },
    setGitChangeContext(context) {
      currentGitChangeContext = context
      diffSplitController?.setGitChangeContext(context)
      liveInlineDiffController?.setGitChangeContext(context)
    },
    setGitDiffLineHighlightsEnabled(enabled) {
      gitDiffLineHighlightsEnabled = enabled
      syncGitDiffLineHighlights()
    },
    setFocusedLineHighlightVisible(visible) {
      focusedLineHighlightVisible = visible === true
      editor?.setFocusedLineHighlightVisible(focusedLineHighlightVisible)
      diffSplitController?.setFocusedLineHighlightVisible(focusedLineHighlightVisible)
      liveInlineDiffController?.setFocusedLineHighlightVisible(focusedLineHighlightVisible)
    },
    setOutlinePosition(position) {
      outlineController.setPosition(position)
    },
    setSavedText(text) {
      currentSavedText = text
      diffSplitController?.setFallbackOriginal({
        label: 'Saved document',
        text,
      })
      liveInlineDiffController?.setFallbackOriginal({
        label: 'Saved document',
        text,
      })
    },
    setText(text) {
      const normalizedNextText = normalizeEol(text)
      if (isDiffMode(currentMode)) {
        cancelPendingSplitParentChange()
        pendingSplitParentChangeText = null
      }
      currentText = text

      if (isDiffMode(currentMode)) {
        diffSplitController?.setText(text)
        liveInlineDiffController?.setText(text)
        return
      }

      const primaryEditor = ensurePrimaryEditor('set-text')
      const normalizedCurrentText = normalizeEol(primaryEditor.getText())
      if (normalizedNextText === normalizedCurrentText) {
        diffSplitController?.setText(text)
        liveInlineDiffController?.setText(text)
        return
      }

      primaryEditor.setText(text)
      diffSplitController?.setText(text)
      liveInlineDiffController?.setText(text)
      scheduleWikiLinkStatusRefresh(text)
      scheduleLocalLinkStatusRefresh(text)
      findPanelController.updateFindStatusSummary()
      scheduleOutlineRefreshIfVisible()
    },
  }
}
