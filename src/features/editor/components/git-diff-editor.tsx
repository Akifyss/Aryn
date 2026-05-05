import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react'
import * as monaco from 'monaco-editor'
import { AddLine, Back2Line } from '@mingcute/react'
import { Icon } from '@iconify/react'
import type { GitChangeItem, GitDiffBlockAction, GitDiffSelection, GitFileDiffResult } from '@/features/git/types'
import { getCodeLanguage } from '@/features/workspace/lib/file-types'
import {
  DiffEditor,
  configureMonaco,
  resolveMonacoTheme,
  type MonacoDiffEditorOptions,
  type MonacoThemePreference,
} from '@/features/editor/lib/monaco'
import type { WorkspaceDiffNavigationRequest } from '@/features/workspace/store/use-workspace-store'

type DiffNavigationSide = 'modified' | 'original'

type DiffNavigationTarget = {
  focusEditor: boolean
  lineNumber: number
  selectLine: boolean
  side: DiffNavigationSide
}

const DIFF_NAVIGATION_HIGHLIGHT_DURATION_MS = 2200

configureMonaco()

const DEFAULT_DIFF_OPTIONS: MonacoDiffEditorOptions = {
  automaticLayout: true,
  diffWordWrap: 'on',
  fontFamily: '"SF Mono", "Cascadia Code", Consolas, "Liberation Mono", monospace',
  fontLigatures: true,
  fontSize: 13.5,
  ignoreTrimWhitespace: false,
  lineNumbersMinChars: 3,
  minimap: { enabled: false },
  originalEditable: false,
  overviewRulerBorder: false,
  padding: {
    bottom: 18,
    top: 18,
  },
  readOnly: false,
  renderLineHighlight: 'gutter',
  renderSideBySide: true,
  renderWhitespace: 'selection',
  roundedSelection: false,
  scrollBeyondLastLine: false,
  smoothScrolling: true,
}

function getGitActionsDisabledReason(options: {
  isApplyingAction: boolean
  isComposing: boolean
  isSaving: boolean
}) {
  if (options.isSaving || options.isApplyingAction) {
    return 'Wait for the current file action to finish first.'
  }

  if (options.isComposing) {
    return 'Finish the current IME composition first.'
  }

  return null
}

function getNavigationSelectionLineStart(
  selection: GitFileDiffResult['selections'][number],
  side: DiffNavigationSide,
) {
  return Math.max(1, side === 'modified' ? selection.modifiedStartLine : selection.originalStartLine)
}

function getNavigationSelectionLineCount(
  selection: GitFileDiffResult['selections'][number],
  side: DiffNavigationSide,
) {
  return side === 'modified' ? selection.modifiedLineCount : selection.originalLineCount
}

function getDistanceToLineRange(lineNumber: number, startLine: number, lineCount: number) {
  const normalizedStartLine = Math.max(1, startLine)

  if (lineCount <= 0) {
    return Math.abs(lineNumber - normalizedStartLine)
  }

  const endLine = normalizedStartLine + lineCount - 1

  if (lineNumber < normalizedStartLine) {
    return normalizedStartLine - lineNumber
  }

  if (lineNumber > endLine) {
    return lineNumber - endLine
  }

  return 0
}

function clampRequestedLineToSelectionRange(
  selection: GitFileDiffResult['selections'][number],
  side: DiffNavigationSide,
  requestedLineNumber: number,
) {
  const startLineNumber = getNavigationSelectionLineStart(selection, side)
  const lineCount = getNavigationSelectionLineCount(selection, side)
  const endLineNumber = lineCount > 0 ? startLineNumber + lineCount - 1 : startLineNumber

  return Math.max(startLineNumber, Math.min(requestedLineNumber, endLineNumber))
}

function resolveNavigationTarget(
  selections: GitFileDiffResult['selections'],
  requestedLineNumber: number,
  preferredSide: DiffNavigationSide,
): DiffNavigationTarget | null {
  let bestTarget: DiffNavigationTarget | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const selection of selections) {
    const fallbackSide = preferredSide === 'modified' ? 'original' : 'modified'
    const preferredSideLineCount = getNavigationSelectionLineCount(selection, preferredSide)
    const fallbackSideLineCount = getNavigationSelectionLineCount(selection, fallbackSide)
    const preferredDistance = getDistanceToLineRange(
      requestedLineNumber,
      getNavigationSelectionLineStart(selection, preferredSide),
      preferredSideLineCount,
    )
    const fallbackDistance = getDistanceToLineRange(
      requestedLineNumber,
      getNavigationSelectionLineStart(selection, fallbackSide),
      fallbackSideLineCount,
    )
    let side: DiffNavigationSide
    let distance: number
    let passiveBoundaryReveal = false

    if (preferredSideLineCount <= 0 && fallbackSideLineCount > 0) {
      side = fallbackSide
      distance = preferredDistance
      passiveBoundaryReveal = true
    } else if (fallbackSideLineCount <= 0 && preferredSideLineCount > 0) {
      side = preferredSide
      distance = preferredDistance
    } else if (preferredDistance < fallbackDistance) {
      side = preferredSide
      distance = preferredDistance
    } else if (fallbackDistance < preferredDistance) {
      side = fallbackSide
      distance = fallbackDistance
    } else {
      side = preferredSide
      distance = preferredDistance
    }

    if (
      distance < bestDistance
      || (
        distance === bestDistance
        && side === preferredSide
        && bestTarget?.side !== preferredSide
      )
    ) {
      bestDistance = distance
      bestTarget = {
        focusEditor: !passiveBoundaryReveal,
        lineNumber: clampRequestedLineToSelectionRange(selection, side, requestedLineNumber),
        selectLine: !passiveBoundaryReveal,
        side,
      }
    }
  }

  return bestTarget
}

function normalizeEditorLineNumber(lineNumber: number, model: monaco.editor.ITextModel) {
  return Math.max(1, Math.min(model.getLineCount(), Math.floor(lineNumber)))
}

function getDiffSelectionKey(selection: GitDiffSelection | null) {
  if (!selection) {
    return ''
  }

  return [
    selection.originalStartLine,
    selection.originalLineCount,
    selection.modifiedStartLine,
    selection.modifiedLineCount,
  ].join(':')
}

function isLineInsideSelection(selection: GitDiffSelection, side: DiffNavigationSide, lineNumber: number) {
  const normalizedLineNumber = Math.max(1, Math.floor(lineNumber))
  const startLine = getNavigationSelectionLineStart(selection, side)
  const lineCount = getNavigationSelectionLineCount(selection, side)

  if (lineCount <= 0) {
    return normalizedLineNumber === startLine
  }

  return normalizedLineNumber >= startLine && normalizedLineNumber < startLine + lineCount
}

function findSelectionAtLine(
  selections: readonly GitDiffSelection[],
  side: DiffNavigationSide,
  lineNumber: number,
) {
  return selections.find((selection) => isLineInsideSelection(selection, side, lineNumber)) ?? null
}

function clearNavigationHighlight(
  decorations: monaco.editor.IEditorDecorationsCollection | null,
  timerRef: { current: number | null },
) {
  if (timerRef.current) {
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  decorations?.clear()
}

function revealEditorLine(
  editor: monaco.editor.IStandaloneCodeEditor,
  lineNumber: number,
  decorationsRef: { current: monaco.editor.IEditorDecorationsCollection | null },
  timerRef: { current: number | null },
  { focusEditor = true, selectLine = true }: { focusEditor?: boolean, selectLine?: boolean } = {},
) {
  const model = editor.getModel()

  if (!model) {
    return
  }

  const safeLineNumber = normalizeEditorLineNumber(lineNumber, model)
  const range = new monaco.Range(safeLineNumber, 1, safeLineNumber, model.getLineMaxColumn(safeLineNumber))

  if (selectLine) {
    editor.setSelection(range)
    editor.setPosition({
      column: 1,
      lineNumber: safeLineNumber,
    })
  }

  editor.revealLineInCenter(safeLineNumber, monaco.editor.ScrollType.Smooth)

  if (focusEditor) {
    editor.focus()
  }

  clearNavigationHighlight(decorationsRef.current, timerRef)
  if (!decorationsRef.current) {
    decorationsRef.current = editor.createDecorationsCollection()
  }

  decorationsRef.current.set([{
    options: {
      className: 'git-diff-monaco-navigation-line',
      isWholeLine: true,
    },
    range,
  }])

  timerRef.current = window.setTimeout(() => {
    timerRef.current = null
    decorationsRef.current?.clear()
  }, DIFF_NAVIGATION_HIGHLIGHT_DURATION_MS)
}

function MonacoDiffRenderer({
  diff,
  isEditable,
  isComposing,
  navigationRequest,
  onCompositionChange,
  onActiveSelectionChange,
  onDraftChange,
  onSave,
  theme = 'auto',
}: {
  diff: GitFileDiffResult
  isEditable: boolean
  isComposing: boolean
  navigationRequest: WorkspaceDiffNavigationRequest | null
  onActiveSelectionChange: (selection: GitDiffSelection | null) => void
  onCompositionChange: (isComposing: boolean) => void
  onDraftChange: (content: string) => void
  onSave: () => void
  theme?: MonacoThemePreference
}) {
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const disposablesRef = useRef<monaco.IDisposable[]>([])
  const isApplyingExternalValueRef = useRef(false)
  const activeSideRef = useRef<DiffNavigationSide | null>(null)
  const isModifiedFocusedRef = useRef(false)
  const isComposingRef = useRef(isComposing)
  const lastActiveSelectionKeyRef = useRef('')
  const lastForwardedValueRef = useRef(diff.modifiedContent)
  const lastHandledNavigationRequestKeyRef = useRef<string | null>(null)
  const compositionEndTimerRef = useRef<number | null>(null)
  const modifiedNavigationDecorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const originalNavigationDecorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const modifiedNavigationHighlightTimerRef = useRef<number | null>(null)
  const originalNavigationHighlightTimerRef = useRef<number | null>(null)
  const onActiveSelectionChangeRef = useRef(onActiveSelectionChange)
  const onCompositionChangeRef = useRef(onCompositionChange)
  const onDraftChangeRef = useRef(onDraftChange)
  const onSaveRef = useRef(onSave)
  const selectionsRef = useRef(diff.selections)
  const monacoTheme = resolveMonacoTheme(theme)
  const language = getCodeLanguage(diff.change.path)

  const emitActiveSelectionChange = useCallback((nextSelection: GitDiffSelection | null) => {
    const nextKey = getDiffSelectionKey(nextSelection)

    if (lastActiveSelectionKeyRef.current === nextKey) {
      return
    }

    lastActiveSelectionKeyRef.current = nextKey
    onActiveSelectionChangeRef.current(nextSelection)
  }, [])

  const updateActiveSelectionFromEditor = useCallback((
    side: DiffNavigationSide,
    editor: monaco.editor.IStandaloneCodeEditor,
  ) => {
    const lineNumber = editor.getPosition()?.lineNumber

    if (typeof lineNumber !== 'number') {
      emitActiveSelectionChange(null)
      return
    }

    emitActiveSelectionChange(findSelectionAtLine(selectionsRef.current, side, lineNumber))
  }, [emitActiveSelectionChange])

  const emitDraftChange = useCallback((nextValue: string) => {
    if (nextValue === lastForwardedValueRef.current) {
      return
    }

    lastForwardedValueRef.current = nextValue
    onDraftChangeRef.current(nextValue)
  }, [])

  useEffect(() => {
    onActiveSelectionChangeRef.current = onActiveSelectionChange
  }, [onActiveSelectionChange])

  useEffect(() => {
    onCompositionChangeRef.current = onCompositionChange
  }, [onCompositionChange])

  useEffect(() => {
    onDraftChangeRef.current = onDraftChange
  }, [onDraftChange])

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    isComposingRef.current = isComposing
  }, [isComposing])

  useEffect(() => {
    selectionsRef.current = diff.selections
    const diffEditor = diffEditorRef.current
    const activeSide = activeSideRef.current

    if (!diffEditor || !activeSide) {
      emitActiveSelectionChange(null)
      return
    }

    updateActiveSelectionFromEditor(
      activeSide,
      activeSide === 'original'
        ? diffEditor.getOriginalEditor()
        : diffEditor.getModifiedEditor(),
    )
  }, [diff.selections, emitActiveSelectionChange, updateActiveSelectionFromEditor])

  useEffect(() => {
    activeSideRef.current = null
    emitActiveSelectionChange(null)
  }, [diff.change.path, diff.change.scope, emitActiveSelectionChange])

  useEffect(() => {
    const diffEditor = diffEditorRef.current

    if (!diffEditor) {
      return
    }

    diffEditor.updateOptions({
      originalEditable: false,
      readOnly: !isEditable,
    })
  }, [isEditable])

  const handleMount = useCallback<NonNullable<ComponentProps<typeof DiffEditor>['onMount']>>((editor, monacoInstance) => {
    disposablesRef.current.forEach((disposable) => {
      disposable.dispose()
    })
    disposablesRef.current = []
    diffEditorRef.current = editor

    const modifiedEditor = editor.getModifiedEditor()
    const originalEditor = editor.getOriginalEditor()

    modifiedEditor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      onSaveRef.current()
    })

    disposablesRef.current = [
      modifiedEditor.onDidFocusEditorText(() => {
        activeSideRef.current = 'modified'
        isModifiedFocusedRef.current = true
        updateActiveSelectionFromEditor('modified', modifiedEditor)
      }),
      modifiedEditor.onDidBlurEditorText(() => {
        isModifiedFocusedRef.current = false
      }),
      modifiedEditor.onDidCompositionStart(() => {
        isComposingRef.current = true
        onCompositionChangeRef.current(true)
      }),
      modifiedEditor.onDidCompositionEnd(() => {
        if (compositionEndTimerRef.current) {
          window.clearTimeout(compositionEndTimerRef.current)
        }

        compositionEndTimerRef.current = window.setTimeout(() => {
          compositionEndTimerRef.current = null
          isComposingRef.current = false
          onCompositionChangeRef.current(false)
          emitDraftChange(modifiedEditor.getValue())
        }, 0)
      }),
      modifiedEditor.onDidChangeModelContent(() => {
        if (isApplyingExternalValueRef.current) {
          return
        }

        const nextValue = modifiedEditor.getValue()

        if (isComposingRef.current) {
          return
        }

        emitDraftChange(nextValue)
      }),
      modifiedEditor.onDidChangeCursorPosition(() => {
        if (activeSideRef.current === 'modified') {
          updateActiveSelectionFromEditor('modified', modifiedEditor)
        }
      }),
      originalEditor.onDidFocusEditorText(() => {
        activeSideRef.current = 'original'
        isModifiedFocusedRef.current = false
        updateActiveSelectionFromEditor('original', originalEditor)
      }),
      originalEditor.onDidChangeCursorPosition(() => {
        if (activeSideRef.current === 'original') {
          updateActiveSelectionFromEditor('original', originalEditor)
        }
      }),
    ]
  }, [emitDraftChange, updateActiveSelectionFromEditor])

  useEffect(() => () => {
    disposablesRef.current.forEach((disposable) => {
      disposable.dispose()
    })
    disposablesRef.current = []
    if (compositionEndTimerRef.current) {
      window.clearTimeout(compositionEndTimerRef.current)
      compositionEndTimerRef.current = null
    }
    clearNavigationHighlight(modifiedNavigationDecorationsRef.current, modifiedNavigationHighlightTimerRef)
    clearNavigationHighlight(originalNavigationDecorationsRef.current, originalNavigationHighlightTimerRef)
    modifiedNavigationDecorationsRef.current = null
    originalNavigationDecorationsRef.current = null
    activeSideRef.current = null
    diffEditorRef.current = null
    isApplyingExternalValueRef.current = false
    isComposingRef.current = false
    isModifiedFocusedRef.current = false
    emitActiveSelectionChange(null)
    onCompositionChangeRef.current(false)
  }, [emitActiveSelectionChange])

  useEffect(() => {
    const diffEditor = diffEditorRef.current
    const originalModel = diffEditor?.getOriginalEditor().getModel()

    if (!originalModel || originalModel.getValue() === diff.originalContent) {
      return
    }

    originalModel.setValue(diff.originalContent)
  }, [diff.change.path, diff.change.scope, diff.originalContent])

  useEffect(() => {
    const diffEditor = diffEditorRef.current
    const modifiedEditor = diffEditor?.getModifiedEditor()
    const modifiedModel = modifiedEditor?.getModel()

    if (!modifiedEditor || !modifiedModel) {
      lastForwardedValueRef.current = diff.modifiedContent
      return
    }

    const currentValue = modifiedModel.getValue()

    if (currentValue === diff.modifiedContent) {
      lastForwardedValueRef.current = diff.modifiedContent
      return
    }

    if (isModifiedFocusedRef.current || isComposingRef.current) {
      return
    }

    isApplyingExternalValueRef.current = true
    try {
      modifiedEditor.executeEdits('external-sync', [{
        forceMoveMarkers: true,
        range: modifiedModel.getFullModelRange(),
        text: diff.modifiedContent,
      }])
      modifiedEditor.pushUndoStop()
      lastForwardedValueRef.current = diff.modifiedContent
    } finally {
      isApplyingExternalValueRef.current = false
    }
  }, [diff.change.path, diff.change.scope, diff.modifiedContent])

  useEffect(() => {
    if (!navigationRequest || lastHandledNavigationRequestKeyRef.current === navigationRequest.requestKey) {
      return
    }

    const frameHandle = window.requestAnimationFrame(() => {
      const diffEditor = diffEditorRef.current

      if (!diffEditor) {
        return
      }

      const preferredSide = navigationRequest.source === 'revision' ? 'original' : 'modified'
      const target = resolveNavigationTarget(
        diff.selections,
        navigationRequest.lineNumber,
        preferredSide,
      ) ?? {
        focusEditor: true,
        lineNumber: navigationRequest.lineNumber,
        selectLine: true,
        side: preferredSide,
      }

      if (target.side === 'original') {
        revealEditorLine(
          diffEditor.getOriginalEditor(),
          target.lineNumber,
          originalNavigationDecorationsRef,
          originalNavigationHighlightTimerRef,
          {
            focusEditor: target.focusEditor,
            selectLine: target.selectLine,
          },
        )
        clearNavigationHighlight(modifiedNavigationDecorationsRef.current, modifiedNavigationHighlightTimerRef)
      } else {
        revealEditorLine(
          diffEditor.getModifiedEditor(),
          target.lineNumber,
          modifiedNavigationDecorationsRef,
          modifiedNavigationHighlightTimerRef,
          {
            focusEditor: target.focusEditor,
            selectLine: target.selectLine,
          },
        )
        clearNavigationHighlight(originalNavigationDecorationsRef.current, originalNavigationHighlightTimerRef)
      }

      lastHandledNavigationRequestKeyRef.current = navigationRequest.requestKey
    })

    return () => {
      window.cancelAnimationFrame(frameHandle)
    }
  }, [diff.selections, navigationRequest])

  return (
    <div className='git-diff-monaco-shell'>
      <DiffEditor
        height='100%'
        modified={diff.modifiedContent}
        modifiedLanguage={language}
        modifiedModelPath={`git-diff-modified://${diff.change.scope}/${encodeURIComponent(diff.change.path)}`}
        onMount={handleMount}
        options={{
          ...DEFAULT_DIFF_OPTIONS,
          readOnly: !isEditable,
        }}
        original={diff.originalContent}
        originalLanguage={language}
        originalModelPath={`git-diff-original://${diff.change.scope}/${encodeURIComponent(diff.change.path)}`}
        theme={monacoTheme}
      />
    </div>
  )
}

export function GitDiffEditor({
  diff,
  draftContent: initialDraftContent,
  hasDirtyRelatedFileTab = false,
  navigationRequest = null,
  onApplyBlockAction,
  onDiscardChange,
  onDraftChange: onDraftContentChange,
  onSaveEditedFile,
  onStageChange,
  onUnstageChange,
  theme = 'auto',
}: {
  diff: GitFileDiffResult
  draftContent: string
  hasDirtyRelatedFileTab?: boolean
  navigationRequest?: WorkspaceDiffNavigationRequest | null
  onApplyBlockAction: (change: GitChangeItem, selection: GitDiffSelection, action: GitDiffBlockAction) => Promise<void>
  onDiscardChange: (change: GitChangeItem) => void
  onDraftChange: (content: string) => void
  onSaveEditedFile: (filePath: string, content: string) => Promise<void>
  onStageChange: (change: GitChangeItem) => void
  onUnstageChange: (change: GitChangeItem) => void
  theme?: MonacoThemePreference
}) {
  const [draftContent, setDraftContent] = useState(initialDraftContent)
  const [activeHunkSelection, setActiveHunkSelection] = useState<GitDiffSelection | null>(null)
  const [isApplyingHunkAction, setIsApplyingHunkAction] = useState(false)
  const [isComposing, setIsComposing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const draftContentRef = useRef(initialDraftContent)
  const isComposingRef = useRef(false)
  const isSavingRef = useRef(false)
  const latestModifiedContentRef = useRef(diff.modifiedContent)
  const onDraftContentChangeRef = useRef(onDraftContentChange)
  const isEditable = diff.change.scope === 'unstaged' && diff.modifiedExists
  const gitActionsDisabledReason = getGitActionsDisabledReason({
    isApplyingAction: isApplyingHunkAction,
    isComposing,
    isSaving,
  })
  const areFileGitActionsEnabled = gitActionsDisabledReason === null
  const areHunkGitActionsEnabled = areFileGitActionsEnabled && Boolean(activeHunkSelection)

  useEffect(() => {
    setDraftContent((current) => current === initialDraftContent ? current : initialDraftContent)
    draftContentRef.current = initialDraftContent
    latestModifiedContentRef.current = diff.modifiedContent
  }, [diff.change.path, diff.change.scope, diff.modifiedContent, initialDraftContent])

  useEffect(() => {
    draftContentRef.current = draftContent
  }, [draftContent])

  useEffect(() => {
    onDraftContentChangeRef.current = onDraftContentChange
  }, [onDraftContentChange])

  useEffect(() => {
    onDraftContentChangeRef.current(draftContent)
  }, [draftContent])

  useEffect(() => {
    isSavingRef.current = isSaving
  }, [isSaving])

  useEffect(() => {
    setIsComposing(false)
    isComposingRef.current = false
    setActiveHunkSelection(null)
  }, [diff.change.path, diff.change.scope])

  const handleCompositionChange = useCallback((nextValue: boolean) => {
    isComposingRef.current = nextValue
    setIsComposing((current) => current === nextValue ? current : nextValue)
  }, [])

  const handleDraftChange = useCallback((content: string) => {
    setDraftContent((current) => current === content ? current : content)
  }, [])

  const handleSave = useCallback(async () => {
    if (
      !isEditable
      || hasDirtyRelatedFileTab
      || isComposingRef.current
      || isSavingRef.current
      || draftContentRef.current === latestModifiedContentRef.current
    ) {
      return
    }

    setIsSaving(true)
    isSavingRef.current = true

    try {
      await onSaveEditedFile(diff.change.path, draftContentRef.current)
      latestModifiedContentRef.current = draftContentRef.current
    } finally {
      isSavingRef.current = false
      setIsSaving(false)
    }
  }, [diff.change.path, hasDirtyRelatedFileTab, isEditable, onSaveEditedFile])

  const getHunkActionTitle = useCallback((label: string) => {
    if (gitActionsDisabledReason) {
      return gitActionsDisabledReason
    }

    if (!activeHunkSelection) {
      return 'Select a changed hunk first.'
    }

    return label
  }, [activeHunkSelection, gitActionsDisabledReason])

  const handleHunkAction = useCallback(async (action: GitDiffBlockAction) => {
    if (!areHunkGitActionsEnabled || !activeHunkSelection) {
      return
    }

    setIsApplyingHunkAction(true)

    try {
      await onApplyBlockAction(diff.change, activeHunkSelection, action)
      setActiveHunkSelection(null)
    } finally {
      setIsApplyingHunkAction(false)
    }
  }, [activeHunkSelection, areHunkGitActionsEnabled, diff.change, onApplyBlockAction])

  return (
    <div className='git-diff-editor'>
      <header className='git-diff-header'>
        <div className='git-diff-header-title-area'>
          <h3 className='git-diff-header-title'>{diff.change.relativePath}</h3>
        </div>

        <div className='git-diff-view-modes'>
          {diff.change.scope === 'unstaged' ? (
            <>
              <button
                type='button'
                className='git-diff-view-mode git-diff-view-mode-icon-only'
                aria-label='Discard'
                title='Discard'
                disabled={!areFileGitActionsEnabled}
                onClick={() => {
                  onDiscardChange(diff.change)
                }}
              >
                <Back2Line size={16} />
              </button>
              <button
                type='button'
                className='git-diff-view-mode git-diff-view-mode-icon-only'
                aria-label='Stage'
                title='Stage'
                disabled={!areFileGitActionsEnabled}
                onClick={() => {
                  onStageChange(diff.change)
                }}
              >
                <AddLine size={16} />
              </button>
              <button
                type='button'
                className='git-diff-view-mode git-diff-view-mode-with-label'
                aria-label='Discard current hunk'
                title={getHunkActionTitle('Discard current hunk')}
                disabled={!areHunkGitActionsEnabled}
                onClick={() => {
                  void handleHunkAction('discard')
                }}
              >
                <Back2Line size={16} />
                <span>Discard hunk</span>
              </button>
              <button
                type='button'
                className='git-diff-view-mode git-diff-view-mode-with-label'
                aria-label='Stage current hunk'
                title={getHunkActionTitle('Stage current hunk')}
                disabled={!areHunkGitActionsEnabled}
                onClick={() => {
                  void handleHunkAction('stage')
                }}
              >
                <AddLine size={16} />
                <span>Stage hunk</span>
              </button>
            </>
          ) : (
            <>
              <button
                type='button'
                className='git-diff-view-mode git-diff-view-mode-icon-only'
                aria-label='Unstage'
                title='Unstage'
                disabled={!areFileGitActionsEnabled}
                onClick={() => {
                  onUnstageChange(diff.change)
                }}
              >
                <Icon icon='mdi:minus' width={16} height={16} />
              </button>
              <button
                type='button'
                className='git-diff-view-mode git-diff-view-mode-with-label'
                aria-label='Unstage current hunk'
                title={getHunkActionTitle('Unstage current hunk')}
                disabled={!areHunkGitActionsEnabled}
                onClick={() => {
                  void handleHunkAction('unstage')
                }}
              >
                <Icon icon='mdi:minus' width={16} height={16} />
                <span>Unstage hunk</span>
              </button>
            </>
          )}
        </div>
      </header>

      <MonacoDiffRenderer
        diff={{
          ...diff,
          modifiedContent: draftContent,
        }}
        isComposing={isComposing}
        isEditable={isEditable}
        navigationRequest={navigationRequest}
        onActiveSelectionChange={setActiveHunkSelection}
        onCompositionChange={handleCompositionChange}
        onDraftChange={handleDraftChange}
        onSave={() => {
          void handleSave()
        }}
        theme={theme}
      />
    </div>
  )
}
