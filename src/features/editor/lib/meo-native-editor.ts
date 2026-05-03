import type { GitBaselinePayload, GitBlameResult } from '@/features/git/types'
import {
  getRelativeFsPath,
  isExternalHref,
  resolveImageUrl,
  resolveLocalLinkResults,
  resolveOpenLinkFilePath,
  resolveWikiLinkResults,
} from '@/features/editor/lib/meo-links'
import {
  shouldRememberViewPosition,
} from '@/features/editor/lib/meo-state'
import { createEditor } from '@/vendor/meo/webview/editor'
import { createFindPanelController } from '@/vendor/meo/webview/helpers/findPanel'
import { setGitDiffLineHighlightsEnabled } from '@/vendor/meo/webview/helpers/gitDiffLineHighlights'
import { handleSavedImagePath, handleImagePaste, initializeImageHandling, resolveImageSrc, setImageSrcResolver, settleImageSrcRequest } from '@/vendor/meo/webview/helpers/images'
import { cancelPendingLocalLinkStatusRefresh, handleResolvedLocalLinks, initializeLocalLinkHandling, requestLocalLinkStatuses, scheduleLocalLinkStatusRefresh, setLocalLinkRefreshContext } from '@/vendor/meo/webview/helpers/localLinks'
import { createOutlineController } from '@/vendor/meo/webview/helpers/outline'
import { createSelectionMenuController } from '@/vendor/meo/webview/helpers/selectionMenu'
import { handleEditorShortcut, isPrimaryModifier, isShortcutKey, normalizeEol } from '@/vendor/meo/webview/helpers/shortcuts'
import { setMermaidRuntimeSource } from '@/vendor/meo/webview/helpers/mermaidDiagram'
import { cancelPendingWikiStatusRefresh, handleResolvedWikiLinks, initializeWikiLinkHandling, requestWikiLinkStatuses, scheduleWikiLinkStatusRefresh, setWikiLinkRefreshContext } from '@/vendor/meo/webview/helpers/wikiLinks'
import { meoMermaidRuntimeUrl } from '@/features/editor/lib/meo-mermaid-runtime-url'
import {
  createMeoDiffSplitController,
  type MeoDiffSplitController,
} from '@/features/editor/lib/meo-native-diff-split'
import {
  createMeoLiveInlineDiffController,
  type MeoLiveInlineDiffController,
} from '@/features/editor/lib/meo-native-live-inline-diff'
import { mountMeoBaseScrollArea } from '@/features/editor/lib/meo-base-scroll-area'
import { createMeoViewPositionPersistenceController } from '@/features/editor/lib/meo-native-editor-persistence'
import { createNativeMeoEditorShell } from '@/features/editor/lib/meo-native-editor-shell'
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
  root,
  savedValue,
  workspacePath,
}: MountNativeMeoEditorOptions): NativeMeoController {
  let currentText = initialValue
  let currentSavedText = savedValue
  let gitDiffLineHighlightsEnabled = meoSettings.gitDiffLineHighlights
  let destroyed = false
  let compositionState = false
  const previousMermaidRuntimeSource = setMermaidRuntimeSource(meoMermaidRuntimeUrl)
  const {
    cancelScheduledViewPositionCapture,
    controller: persistenceController,
  } = createMeoViewPositionPersistenceController({
    filePath,
    getCurrentText: () => currentText,
    getEditorPosition: () => (
      currentMode === 'diff-split'
        ? diffSplitController?.getTopVisiblePosition() ?? null
        : editor ? editor.getTopVisiblePosition() : null
    ),
    rememberPositionLines: meoSettings.rememberPositionLines,
  })
  let currentMode: MeoEditorMode = persistenceController.getInitialMode()
  let persistedWebviewState: unknown = { mode: currentMode }
  let lineNumbersVisible = persistenceController.getInitialLineNumbersVisible()
  let gitChangesGutterVisible = persistenceController.getInitialGitChangesGutterVisible()
  let currentGitBaseline: GitBaselinePayload | null = null
  let currentGitChangeContext = gitChangeContext
  let pendingOutlineRefreshFrame = 0
  let pendingResizeFrame = 0
  let pendingFindStatusRefreshFrame = 0
  let pendingFindStatusRefreshTimer = 0
  let pendingSplitParentChangeFrame = 0
  let pendingSplitParentChangeText: string | null = null
  let pendingSplitParentChangeTimer = 0

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

  root.replaceChildren()
  root.classList.add('meo-native-root')
  root.classList.add('editor-root')
  const shell = createNativeMeoEditorShell()
  const {
    buttons: {
      bulletListBtn,
      codeBlockBtn,
      diffNextChangeBtn,
      diffPreviousChangeBtn,
      diffSplitButton,
      findToggleBtn,
      gitChangesGutterBtn,
      headingDropdown,
      hrBtn,
      imageBtn,
      lineNumbersBtn,
      linkBtn,
      liveButton,
      numberedListBtn,
      outlineBtn,
      quoteBtn,
      sourceButton,
      tableBtn,
      taskBtn,
      wikiLinkBtn,
    },
    editorHost,
    editorWrapper,
    findPanelElements,
    modeGroup,
    selectionMenuElements,
    toolbar,
  } = shell

  let editor!: MeoEditorInstance
  let editorScrollArea: ReturnType<typeof mountMeoBaseScrollArea> | null = null
  let diffSplitController: MeoDiffSplitController | null = null
  let liveInlineDiffController: MeoLiveInlineDiffController | null = null

  const getActiveEditor = () => (
    currentMode === 'diff-split' ? diffSplitController : editor
  )

  const outlineController = createOutlineController({
    editorWrapper,
    getEditor: getActiveEditor,
    outlineButton: outlineBtn,
    root,
  })

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

  editorWrapper.replaceChildren(editorHost, outlineController.sidebar, selectionMenuElements.menu)
  root.replaceChildren(toolbar, editorWrapper)

  const findPanelController = createFindPanelController(
    findPanelElements,
    getActiveEditor,
    toolbar,
    modeGroup,
  )
  const selectionMenuController = createSelectionMenuController(selectionMenuElements, getActiveEditor)

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
    liveButton.classList.toggle('is-active', currentMode === 'live')
    sourceButton.classList.toggle('is-active', currentMode === 'source')
    diffSplitButton.classList.toggle('is-active', currentMode === 'diff-split')
    liveButton.setAttribute('aria-selected', currentMode === 'live' ? 'true' : 'false')
    sourceButton.setAttribute('aria-selected', currentMode === 'source' ? 'true' : 'false')
    diffSplitButton.setAttribute('aria-selected', currentMode === 'diff-split' ? 'true' : 'false')
    editorHost.classList.toggle('meo-diff-split-active', currentMode === 'diff-split')
    root.classList.toggle('is-diff-split-mode', currentMode === 'diff-split')
  }

  const updateLineNumbersUi = () => {
    lineNumbersBtn.classList.toggle('is-active', lineNumbersVisible)
    lineNumbersBtn.setAttribute('aria-pressed', lineNumbersVisible ? 'true' : 'false')
    lineNumbersBtn.title = lineNumbersVisible ? 'Hide Line Numbers' : 'Show Line Numbers'
  }

  const updateGitChangesGutterUi = () => {
    gitChangesGutterBtn.classList.toggle('is-active', gitChangesGutterVisible)
    gitChangesGutterBtn.setAttribute('aria-pressed', gitChangesGutterVisible ? 'true' : 'false')
    gitChangesGutterBtn.title = gitChangesGutterVisible ? 'Hide Git Changes' : 'Show Git Changes'
  }

  const syncGitDiffLineHighlights = () => {
    if (!editor) {
      return
    }

    setGitDiffLineHighlightsEnabled(
      editor,
      currentMode === 'source' && gitChangesGutterVisible && gitDiffLineHighlightsEnabled,
    )
  }

  const setLineNumbersVisible = (visible: boolean, options?: { persist?: boolean }) => {
    lineNumbersVisible = visible !== false
    editor.setLineNumbers(lineNumbersVisible)
    diffSplitController?.setLineNumbersVisible(lineNumbersVisible)
    liveInlineDiffController?.setLineNumbersVisible(lineNumbersVisible)
    updateLineNumbersUi()
    if (options?.persist !== false) {
      persistenceController.persistLineNumbersVisible(lineNumbersVisible)
    }
  }

  const setGitChangesGutterVisible = (visible: boolean, options?: { persist?: boolean }) => {
    gitChangesGutterVisible = visible !== false
    editor.setGitGutterVisible(gitChangesGutterVisible)
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
    if (outlineController.isVisible()) {
      outlineController.refresh()
    }
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

  const ensureDiffSplit = () => {
    if (diffSplitController) {
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

    diffSplitController = createMeoDiffSplitController({
      baseline: currentGitBaseline,
      diffGutterVisible: gitChangesGutterVisible,
      fallbackOriginalLabel: 'Saved document',
      fallbackOriginalText: currentSavedText,
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
        selectionMenuController.update(selectionState)
      },
      onViewportChange: () => {
        persistenceController.scheduleViewPositionCapture()
      },
      parent: editorHost,
      text: currentText,
    })
  }

  const applyMode = (mode: MeoEditorMode, options?: { persist?: boolean }) => {
    const nextMode = mode === 'diff-split' ? 'diff-split' : mode === 'live' ? 'live' : 'source'
    const previousTopPosition = getActiveEditor()?.getTopVisiblePosition?.() ?? null
    if (nextMode === currentMode) {
      if (nextMode === 'diff-split') {
        ensureDiffSplit()
        updateModeUi()
        diffSplitController?.refreshLayout()
      }
      return
    }

    if (currentMode === 'diff-split') {
      flushPendingSplitParentChange()
    }
    currentMode = nextMode
    if (currentMode === 'diff-split') {
      ensureDiffSplit()
      if (previousTopPosition) {
        diffSplitController?.restoreTopLine(previousTopPosition.line, previousTopPosition.lineOffset)
      }
    } else {
      destroyDiffSplit()
      editor.setText(currentText)
      editor.setMode(currentMode)
      if (previousTopPosition) {
        editor.restoreTopLine(previousTopPosition.line, previousTopPosition.lineOffset)
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
        onSave?.(currentMode === 'diff-split' ? diffSplitController?.getText() ?? currentText : editor.getText())
        return
      case 'setMode':
        if (message.mode === 'live' || message.mode === 'source' || message.mode === 'diff-split') {
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
          currentText,
          meoSettings.rememberPositionLines,
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
        editor.refreshDecorations()
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
        editor.refreshDecorations()
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

  editor = createVendorEditor({
    initialGitGutter: gitChangesGutterVisible,
    initialLineNumbers: lineNumbersVisible,
    initialMode: currentMode === 'diff-split' ? 'live' : currentMode,
    text: initialValue,
    initialTopLine: persistenceController.getInitialRestoreTopLine(initialValue, meoSettings.rememberPositionLines),
    initialTopLineOffset: persistenceController.getInitialRestoreTopLineOffset(initialValue, meoSettings.rememberPositionLines),
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
    onToggleGitInlineSplitForLine: (request: { lineNumber?: number, scope: 'staged' | 'unstaged' }) => (
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
      selectionMenuController.update(selectionState)
    },
    onViewportChange: () => {
      persistenceController.scheduleViewPositionCapture()
    },
    parent: editorHost,
  })
  const editorScrollDOM = editor.view.scrollDOM
  const editorDOM = editor.view.dom
  if (editorScrollDOM instanceof HTMLElement && editorDOM instanceof HTMLElement) {
    editorScrollArea = mountMeoBaseScrollArea({
      className: 'meo-editor-base-scroll-area',
      hostParent: editorDOM,
      viewport: editorScrollDOM,
    })
  }

  liveInlineDiffController = createMeoLiveInlineDiffController({
    baseline: currentGitBaseline,
    diffGutterVisible: gitChangesGutterVisible,
    fallbackOriginalLabel: 'Saved document',
    fallbackOriginalText: currentSavedText,
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
      selectionMenuController.update(selectionState)
    },
    onViewportChange: () => {
      persistenceController.scheduleViewPositionCapture()
    },
    text: currentText,
    view: editor.view as unknown as import('@codemirror/view').EditorView,
  })

  syncGitDiffLineHighlights()
  if (currentMode === 'diff-split') {
    ensureDiffSplit()
    const initialDiffTopLine = persistenceController.getInitialRestoreTopLine(initialValue, meoSettings.rememberPositionLines)
    if (typeof initialDiffTopLine === 'number') {
      ;(diffSplitController as MeoDiffSplitController | null)?.restoreTopLine(
        initialDiffTopLine,
        persistenceController.getInitialRestoreTopLineOffset(initialValue, meoSettings.rememberPositionLines),
      )
    }
    updateModeUi()
  }
  requestWikiLinkStatuses(initialValue)
  requestLocalLinkStatuses(initialValue)

  setWikiLinkRefreshContext({
    refreshDecorations: () => getActiveEditor()?.refreshDecorations?.(),
  })
  setLocalLinkRefreshContext({
    refreshDecorations: () => getActiveEditor()?.refreshDecorations?.(),
  })

  const focusEditor = () => {
    if (currentMode === 'diff-split') {
      diffSplitController?.focus()
      return
    }

    editor.focus()
  }

  const toggleFindPanel = () => {
    if (findPanelController.isVisible()) {
      findPanelController.close()
      return
    }

    findPanelController.open('find')
  }

  const handleFormatAction = (action: MeoEditorInsertFormat, options?: unknown) => {
    const activeEditor = getActiveEditor()
    if (!activeEditor) {
      return
    }

    activeEditor.insertFormat(action, options)
    activeEditor.focus()
  }

  const isEventInsideMeoSurface = (eventTarget: EventTarget | null) => (
    eventTarget instanceof Node && root.contains(eventTarget)
  )

  const isEventInsideDiffEditablePane = (eventTarget: EventTarget | null) => (
    eventTarget instanceof Node && diffSplitController?.view.dom.contains(eventTarget) === true
  )

  const shortcutHandler = (event: KeyboardEvent) => {
    const hasEditorFocus = currentMode === 'diff-split'
      ? diffSplitController?.hasFocus() === true
      : editor.hasFocus()

    if (!hasEditorFocus && !isEventInsideMeoSurface(event.target)) {
      return
    }

    if (currentMode === 'diff-split') {
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
        findPanelController.open('find')
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
        findPanelController.open('replace')
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

    handleEditorShortcut(event, {
      applyMode: (mode) => {
        applyMode(mode)
        return true
      },
      currentMode,
      editor,
      flushPendingChangesNow: () => undefined,
      openFindPanel: (target) => findPanelController.open(target),
      pendingText: null,
      requestSave: () => {
        onSave?.(editor.getText())
      },
      syncedText: normalizeEol(currentText),
      vimModeEnabled: false,
    })
  }

  const pasteHandler = async (event: ClipboardEvent) => {
    if (currentMode === 'diff-split') {
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

    if (!editor.hasFocus() && !isEventInsideMeoSurface(event.target)) {
      return
    }

    const selection = editor.view.state.selection.main
    const line = editor.view.state.doc.lineAt(selection.head)
    await handleImagePaste(event, editor, {
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
      editor.refreshSelectionOverlay()
      editor.refreshLayout()
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

    editor.refreshLayout()
    diffSplitController?.refreshLayout()
  }

  const compositionStartHandler = () => {
    updateCompositionState(true)
  }

  const compositionEndHandler = () => {
    updateCompositionState(false)
  }

  window.addEventListener('keydown', shortcutHandler, true)
  window.addEventListener('paste', pasteHandler)
  window.addEventListener('resize', resizeHandler)
  window.addEventListener('blur', blurHandler)
  document.addEventListener('visibilitychange', visibilityHandler)
  root.addEventListener('compositionstart', compositionStartHandler, true)
  root.addEventListener('compositionend', compositionEndHandler, true)

  headingDropdown.addEventListener('click', (event) => {
    const option = (event.target as Element).closest('.heading-dropdown-option') as HTMLElement | null
    if (!option) {
      return
    }
    handleFormatAction('heading', Number.parseInt(option.dataset.level ?? '1', 10))
    focusEditor()
  })

  bulletListBtn.addEventListener('click', () => handleFormatAction('bulletList'))
  numberedListBtn.addEventListener('click', () => handleFormatAction('numberedList'))
  taskBtn.addEventListener('click', () => handleFormatAction('task'))
  tableBtn.addEventListener('click', () => {
    handleFormatAction('table', { cols: 3, rows: 3 })
  })
  codeBlockBtn.addEventListener('click', () => handleFormatAction('codeBlock'))
  linkBtn.addEventListener('click', () => handleFormatAction('link'))
  wikiLinkBtn.addEventListener('click', () => handleFormatAction('wikiLink'))
  imageBtn.addEventListener('click', () => handleFormatAction('image'))
  quoteBtn.addEventListener('click', () => handleFormatAction('quote'))
  hrBtn.addEventListener('click', () => handleFormatAction('hr'))
  outlineBtn.addEventListener('click', () => {
    setOutlineVisible(!outlineController.isVisible())
  })
  findToggleBtn.addEventListener('click', toggleFindPanel)
  lineNumbersBtn.addEventListener('click', () => {
    setLineNumbersVisible(!lineNumbersVisible)
  })
  gitChangesGutterBtn.addEventListener('click', () => {
    setGitChangesGutterVisible(!gitChangesGutterVisible)
  })
  diffPreviousChangeBtn.addEventListener('click', () => {
    diffSplitController?.previousChange()
    diffSplitController?.focus()
  })
  diffNextChangeBtn.addEventListener('click', () => {
    diffSplitController?.nextChange()
    diffSplitController?.focus()
  })
  liveButton.addEventListener('click', () => {
    applyMode('live')
  })
  sourceButton.addEventListener('click', () => {
    applyMode('source')
  })
  diffSplitButton.addEventListener('click', () => {
    applyMode('diff-split')
  })

  findPanelElements.findInput.addEventListener('input', () => {
    findPanelController.updateFindStatusSummary()
  })
  findPanelElements.wholeWordBtn.addEventListener('click', () => {
    findPanelController.toggleWholeWord()
    persistenceController.persistFindOptions(findPanelController.getSearchOptions())
  })
  findPanelElements.caseSensitiveBtn.addEventListener('click', () => {
    findPanelController.toggleCaseSensitive()
    persistenceController.persistFindOptions(findPanelController.getSearchOptions())
  })
  findPanelElements.findPrevBtn.addEventListener('click', () => {
    findPanelController.runFind(true)
  })
  findPanelElements.findNextBtn.addEventListener('click', () => {
    findPanelController.runFind(false)
  })
  findPanelElements.replaceBtn.addEventListener('click', () => {
    findPanelController.runReplace()
  })
  findPanelElements.replaceAllBtn.addEventListener('click', () => {
    findPanelController.runReplaceAll()
  })
  findPanelElements.findInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return
    }
    event.preventDefault()
    findPanelController.runFind(event.shiftKey, { focusEditor: false })
  })
  findPanelElements.replaceInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return
    }
    event.preventDefault()
    findPanelController.runReplace()
  })

  selectionMenuElements.menu.addEventListener('pointerdown', (event) => {
    event.preventDefault()
  })
  selectionMenuElements.menu.addEventListener('click', (event) => {
    const button = (event.target as Element).closest('.selection-inline-button') as HTMLElement | null
    if (!button?.dataset.action) {
      return
    }
    selectionMenuController.handleAction(button.dataset.action)
  })

  return {
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
      window.removeEventListener('keydown', shortcutHandler, true)
      window.removeEventListener('paste', pasteHandler)
      window.removeEventListener('resize', resizeHandler)
      window.removeEventListener('blur', blurHandler)
      document.removeEventListener('visibilitychange', visibilityHandler)
      root.removeEventListener('compositionstart', compositionStartHandler, true)
      root.removeEventListener('compositionend', compositionEndHandler, true)
      persistenceController.captureViewPosition()
      destroyDiffSplit()
      liveInlineDiffController?.destroy()
      liveInlineDiffController = null
      editorScrollArea?.destroy()
      editorScrollArea = null
      editor.destroy()
      root.replaceChildren()
    },
    focus() {
      focusEditor()
    },
    refreshLayout() {
      editor.refreshLayout()
      editorScrollArea?.refresh()
      diffSplitController?.refreshLayout()
      liveInlineDiffController?.refreshLayout()
    },
    setGitBaseline(baseline) {
      currentGitBaseline = baseline
      editor.setGitBaseline(baseline)
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
      const normalizedCurrentText = normalizeEol(editor.getText())
      if (currentMode === 'diff-split') {
        cancelPendingSplitParentChange()
        pendingSplitParentChangeText = null
      }
      currentText = text

      if (currentMode === 'diff-split') {
        diffSplitController?.setText(text)
        liveInlineDiffController?.setText(text)
        return
      }

      if (normalizedNextText === normalizedCurrentText) {
        diffSplitController?.setText(text)
        liveInlineDiffController?.setText(text)
        return
      }

      editor.setText(text)
      diffSplitController?.setText(text)
      liveInlineDiffController?.setText(text)
      scheduleWikiLinkStatusRefresh(text)
      scheduleLocalLinkStatusRefresh(text)
      findPanelController.updateFindStatusSummary()
      scheduleOutlineRefreshIfVisible()
    },
  }
}
