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
import { handleEditorShortcut, normalizeEol } from '@/vendor/meo/webview/helpers/shortcuts'
import { applyThemeSettings } from '@/vendor/meo/webview/helpers/theme'
import { setMermaidRuntimeSource } from '@/vendor/meo/webview/helpers/mermaidDiagram'
import { cancelPendingWikiStatusRefresh, handleResolvedWikiLinks, initializeWikiLinkHandling, requestWikiLinkStatuses, scheduleWikiLinkStatusRefresh, setWikiLinkRefreshContext } from '@/vendor/meo/webview/helpers/wikiLinks'
import { meoMermaidRuntimeUrl } from '@/features/editor/lib/meo-mermaid-runtime-url'
import { createMeoViewPositionPersistenceController } from '@/features/editor/lib/meo-native-editor-persistence'
import { createNativeMeoEditorShell } from '@/features/editor/lib/meo-native-editor-shell'
import type {
  MeoEditorCreateOptions,
  MeoEditorInsertFormat,
  MeoEditorInstance,
  MountNativeMeoEditorOptions,
  NativeMeoController,
  NativeMeoMessage,
} from '@/features/editor/lib/meo-native-editor-types'

function buildUnavailableBlameResult(
  reason: 'not-repo' | 'untracked' | 'git-unavailable' | 'error',
): GitBlameResult {
  return { kind: 'unavailable', reason }
}

export function mountNativeMeoEditor({
  environment,
  filePath,
  initialValue,
  meoSettings,
  onChange,
  onCompositionChange,
  onOpenFile,
  onOpenGitDiff,
  onSave,
  root,
  workspacePath,
}: MountNativeMeoEditorOptions): NativeMeoController {
  let currentText = initialValue
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
    getEditorPosition: () => (editor ? editor.getTopVisiblePosition() : null),
    rememberPositionLines: meoSettings.rememberPositionLines,
  })
  let currentMode: 'live' | 'source' = persistenceController.getInitialMode()
  let persistedWebviewState: unknown = { mode: currentMode }
  let lineNumbersVisible = persistenceController.getInitialLineNumbersVisible()
  let gitChangesGutterVisible = persistenceController.getInitialGitChangesGutterVisible()

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

  const outlineController = createOutlineController({
    editorWrapper,
    getEditor: () => editor,
    outlineButton: outlineBtn,
    root,
  })

  editorWrapper.replaceChildren(editorHost, outlineController.sidebar, selectionMenuElements.menu)
  root.replaceChildren(toolbar, editorWrapper)

  const findPanelController = createFindPanelController(
    findPanelElements,
    () => editor,
    toolbar,
    modeGroup,
  )
  const selectionMenuController = createSelectionMenuController(selectionMenuElements, () => editor)

  const updateModeUi = () => {
    liveButton.classList.toggle('is-active', currentMode === 'live')
    sourceButton.classList.toggle('is-active', currentMode === 'source')
    liveButton.setAttribute('aria-selected', currentMode === 'live' ? 'true' : 'false')
    sourceButton.setAttribute('aria-selected', currentMode === 'source' ? 'true' : 'false')
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
    updateLineNumbersUi()
    if (options?.persist !== false) {
      persistenceController.persistLineNumbersVisible(lineNumbersVisible)
    }
  }

  const setGitChangesGutterVisible = (visible: boolean, options?: { persist?: boolean }) => {
    gitChangesGutterVisible = visible !== false
    editor.setGitGutterVisible(gitChangesGutterVisible)
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

  const applyMode = (mode: 'live' | 'source', options?: { persist?: boolean }) => {
    const nextMode = mode === 'live' ? 'live' : 'source'
    if (nextMode === currentMode) {
      return
    }

    currentMode = nextMode
    editor.setMode(currentMode)
    updateModeUi()
    syncGitDiffLineHighlights()
    vscode.setState({ mode: currentMode })
    if (outlineController.isVisible()) {
      outlineController.refresh()
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

  const handleNativeMessage = async (message: NativeMeoMessage) => {
    switch (message.type) {
      case 'saveDocument':
        onSave?.(editor.getText())
        return
      case 'setMode':
        if (message.mode === 'live' || message.mode === 'source') {
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

  applyThemeSettings()
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
    initialMode: currentMode,
    text: initialValue,
    initialTopLine: persistenceController.getInitialRestoreTopLine(initialValue, meoSettings.rememberPositionLines),
    initialTopLineOffset: persistenceController.getInitialRestoreTopLineOffset(initialValue, meoSettings.rememberPositionLines),
    initialVimMode: false,
    onApplyChanges: (nextText: string) => {
      currentText = nextText
      onChange(nextText)
      scheduleWikiLinkStatusRefresh(nextText)
      scheduleLocalLinkStatusRefresh(nextText)
      findPanelController.updateFindStatusSummary()
      if (outlineController.isVisible()) {
        outlineController.refresh()
      }
    },
    onOpenGitRevisionForLine: (options: { lineNumber?: number }) => {
      onOpenGitDiff?.(filePath, {
        lineNumber: typeof options?.lineNumber === 'number' ? options.lineNumber : undefined,
        source: 'revision',
      })
    },
    onOpenGitWorktreeForLine: (options: { lineNumber?: number }) => {
      onOpenGitDiff?.(filePath, {
        lineNumber: typeof options?.lineNumber === 'number' ? options.lineNumber : undefined,
        source: 'worktree',
      })
    },
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

  syncGitDiffLineHighlights()
  requestWikiLinkStatuses(initialValue)
  requestLocalLinkStatuses(initialValue)

  setWikiLinkRefreshContext({
    refreshDecorations: () => editor.refreshDecorations(),
  })
  setLocalLinkRefreshContext({
    refreshDecorations: () => editor.refreshDecorations(),
  })

  const focusEditor = () => {
    editor.focus()
  }

  const toggleFindPanel = () => {
    if (findPanelController.isVisible()) {
      findPanelController.close()
      return
    }

    findPanelController.open('find')
  }

  const handleFormatAction = (action: MeoEditorInsertFormat) => {
    editor.insertFormat(action)
    editor.focus()
  }

  const updateCompositionState = (nextValue: boolean) => {
    if (compositionState === nextValue) {
      return
    }
    compositionState = nextValue
    onCompositionChange?.(nextValue)
  }

  const shortcutHandler = (event: KeyboardEvent) => {
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
    const selection = editor.view.state.selection.main
    const line = editor.view.state.doc.lineAt(selection.head)
    await handleImagePaste(event, editor, {
      lineNumber: line.number,
      lineOffset: selection.head - line.from,
    })
  }

  const resizeHandler = () => {
    findPanelController.updateAnchor()
    editor.refreshSelectionOverlay()
    editor.refreshLayout()
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
    editor.insertFormat('heading', Number.parseInt(option.dataset.level ?? '1', 10))
    focusEditor()
  })

  bulletListBtn.addEventListener('click', () => handleFormatAction('bulletList'))
  numberedListBtn.addEventListener('click', () => handleFormatAction('numberedList'))
  taskBtn.addEventListener('click', () => handleFormatAction('task'))
  tableBtn.addEventListener('click', () => {
    editor.insertFormat('table', { cols: 3, rows: 3 })
    focusEditor()
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
  liveButton.addEventListener('click', () => {
    applyMode('live')
  })
  sourceButton.addEventListener('click', () => {
    applyMode('source')
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
      editor.destroy()
      root.replaceChildren()
    },
    focus() {
      focusEditor()
    },
    refreshTheme() {
      applyThemeSettings()
      editor.refreshLayout()
    },
    setGitBaseline(baseline) {
      editor.setGitBaseline(baseline)
    },
    setGitDiffLineHighlightsEnabled(enabled) {
      gitDiffLineHighlightsEnabled = enabled
      syncGitDiffLineHighlights()
    },
    setOutlinePosition(position) {
      outlineController.setPosition(position)
    },
    setText(text) {
      const normalizedNextText = normalizeEol(text)
      const normalizedCurrentText = normalizeEol(editor.getText())
      currentText = text

      if (normalizedNextText === normalizedCurrentText) {
        return
      }

      editor.setText(text)
      scheduleWikiLinkStatusRefresh(text)
      scheduleLocalLinkStatusRefresh(text)
      findPanelController.updateFindStatusSummary()
      if (outlineController.isVisible()) {
        outlineController.refresh()
      }
    },
  }
}
