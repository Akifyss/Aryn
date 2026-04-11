import { useCallback, useEffect, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EditorState, type Text } from '@codemirror/state'
import { getChunks, getOriginalDoc, MergeView, unifiedMergeView } from '@codemirror/merge'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { AddLine, Back2Line } from '@mingcute/react'
import { Icon } from '@iconify/react'
import type { GitChangeItem, GitDiffBlockAction, GitDiffSelection, GitFileDiffResult } from '@/features/git/types'
import { getCodeMirrorLanguageSupport } from '@/features/editor/lib/codemirror-language'

type DiffViewMode = 'split' | 'unified'
type CodeMirrorChunk = {
  fromA: number
  toA: number
  fromB: number
  toB: number
  endA: number
  endB: number
}

const DIFF_AUTO_SAVE_DELAY_MS = 1000

const DIFF_EDITOR_THEME = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--foreground)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-sans)',
    lineHeight: '1.72',
  },
  '.cm-content, .cm-line, .cm-gutter, .cm-gutterElement, .cm-tooltip': {
    fontFamily: 'var(--font-sans)',
    fontSize: '14px',
  },
  '.cm-content': {
    caretColor: 'var(--foreground)',
    paddingBottom: '2rem',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--default)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--default)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--default)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--foreground)',
  },
})

function getTextLineCount(doc: Text, from: number, to: number) {
  if (from === to) {
    return 0
  }

  const startLine = doc.lineAt(Math.min(from, doc.length)).number
  const endLine = doc.lineAt(Math.max(0, Math.min(doc.length, to) - 1)).number
  return Math.max(0, endLine - startLine + 1)
}

function createSelectionFromCodeMirrorChunk(originalDoc: Text, modifiedDoc: Text, chunk: CodeMirrorChunk): GitDiffSelection {
  const originalStartLine = originalDoc.lineAt(Math.min(chunk.fromA, originalDoc.length)).number
  const modifiedStartLine = modifiedDoc.lineAt(Math.min(chunk.fromB, modifiedDoc.length)).number
  const originalLineCount = chunk.fromA === chunk.toA ? 0 : getTextLineCount(originalDoc, chunk.fromA, chunk.endA)
  const modifiedLineCount = chunk.fromB === chunk.toB ? 0 : getTextLineCount(modifiedDoc, chunk.fromB, chunk.endB)

  return {
    modifiedLineCount,
    modifiedStartLine: modifiedLineCount === 0 ? Math.max(0, modifiedStartLine - 1) : modifiedStartLine,
    originalLineCount,
    originalStartLine: originalLineCount === 0 ? Math.max(0, originalStartLine - 1) : originalStartLine,
  }
}

function getCodeMirrorControlSvg(action: GitDiffBlockAction) {
  if (action === 'stage') {
    return renderToStaticMarkup(<AddLine aria-hidden='true' size={14} />)
  }

  if (action === 'unstage') {
    return '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3.25 8h9.5"/></svg>'
  }

  return renderToStaticMarkup(<Back2Line aria-hidden='true' size={14} />)
}

function getBlockActionsDisabledReason(options: {
  isComposing: boolean
  isApplyingAction: boolean
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

function createDiffExtensions({
  editable,
  filePath,
  onChange,
  onCompositionChange,
  onFocusChange,
  onSave,
  wrapLines,
}: {
  editable: boolean
  filePath: string
  onChange: (content: string) => void
  onCompositionChange: (isComposing: boolean) => void
  onFocusChange: (isFocused: boolean) => void
  onSave: () => void
  wrapLines: boolean
}) {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    drawSelection(),
    history(),
    foldGutter(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    EditorState.tabSize.of(2),
    ...(wrapLines ? [EditorView.lineWrapping] : []),
    EditorView.editable.of(editable),
    EditorState.readOnly.of(!editable),
    DIFF_EDITOR_THEME,
    getCodeMirrorLanguageSupport(filePath),
    keymap.of([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          if (!editable) {
            return false
          }

          onSave()
          return true
        },
      },
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...searchKeymap,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChange(update.state.doc.toString())
      }
    }),
    EditorView.domEventHandlers({
      compositionstart: () => {
        onCompositionChange(true)
        return false
      },
      compositionend: () => {
        window.setTimeout(() => {
          onCompositionChange(false)
        }, 0)
        return false
      },
      focus: () => {
        onFocusChange(true)
        return false
      },
      blur: () => {
        onFocusChange(false)
        return false
      },
    }),
  ]
}

function CodeMirrorDiffRenderer({
  blockActionsDisabledReason,
  areBlockActionsEnabled,
  diff,
  isEditable,
  onBlockAction,
  onDraftChange,
  onCompositionChange,
  isComposing,
  onSave,
  viewMode,
}: {
  blockActionsDisabledReason: string | null
  areBlockActionsEnabled: boolean
  diff: GitFileDiffResult
  isEditable: boolean
  onBlockAction: (selection: GitDiffSelection, action: GitDiffBlockAction) => void
  onDraftChange: (content: string) => void
  onCompositionChange: (isComposing: boolean) => void
  isComposing: boolean
  onSave: () => void
  viewMode: DiffViewMode
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const splitViewRef = useRef<MergeView | null>(null)
  const unifiedViewRef = useRef<EditorView | null>(null)
  const onBlockActionRef = useRef(onBlockAction)
  const onDraftChangeRef = useRef(onDraftChange)
  const onCompositionChangeRef = useRef(onCompositionChange)
  const onSaveRef = useRef(onSave)
  const [isModifiedFocused, setIsModifiedFocused] = useState(false)
  const areBlockActionsEnabledRef = useRef(areBlockActionsEnabled)
  const blockActionsDisabledReasonRef = useRef(blockActionsDisabledReason)

  useEffect(() => {
    onBlockActionRef.current = onBlockAction
  }, [onBlockAction])

  useEffect(() => {
    onDraftChangeRef.current = onDraftChange
  }, [onDraftChange])

  useEffect(() => {
    onCompositionChangeRef.current = onCompositionChange
  }, [onCompositionChange])

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    areBlockActionsEnabledRef.current = areBlockActionsEnabled
    blockActionsDisabledReasonRef.current = blockActionsDisabledReason
  }, [areBlockActionsEnabled, blockActionsDisabledReason])

  useEffect(() => {
    const host = containerRef.current

    if (!host) {
      return
    }

    const controls = host.querySelectorAll<HTMLElement>('.git-diff-native-control')
    controls.forEach((control) => {
      const action = control.dataset.action as GitDiffBlockAction | undefined

      if (!action) {
        return
      }

      const title = areBlockActionsEnabled
        ? action === 'stage'
          ? 'Stage block'
          : action === 'unstage'
            ? 'Unstage block'
            : 'Discard block'
        : blockActionsDisabledReason ?? (
          action === 'stage'
            ? 'Stage block'
            : action === 'unstage'
              ? 'Unstage block'
              : 'Discard block'
        )

      control.title = title
      control.setAttribute('aria-label', title)
      control.setAttribute('aria-disabled', areBlockActionsEnabled ? 'false' : 'true')
      control.setAttribute('tabindex', areBlockActionsEnabled ? '0' : '-1')
    })
  }, [areBlockActionsEnabled, blockActionsDisabledReason])

  useEffect(() => {
    const splitView = splitViewRef.current

    if (!splitView) {
      return
    }

    const currentDoc = splitView.b.state.doc.toString()

    if (currentDoc === diff.modifiedContent) {
      return
    }

    if (isModifiedFocused || isComposing) {
      return
    }

    splitView.b.dispatch({
      changes: {
        from: 0,
        to: splitView.b.state.doc.length,
        insert: diff.modifiedContent,
      },
    })
  }, [diff.modifiedContent, isComposing, isModifiedFocused])

  useEffect(() => {
    const unifiedView = unifiedViewRef.current

    if (!unifiedView) {
      return
    }

    const currentDoc = unifiedView.state.doc.toString()

    if (currentDoc === diff.modifiedContent) {
      return
    }

    if (isModifiedFocused || isComposing) {
      return
    }

    unifiedView.dispatch({
      changes: {
        from: 0,
        to: unifiedView.state.doc.length,
        insert: diff.modifiedContent,
      },
    })
  }, [diff.modifiedContent, isComposing, isModifiedFocused])

  useEffect(() => {
    const container = containerRef.current

    if (!container) {
      return
    }

    container.replaceChildren()
    splitViewRef.current?.destroy()
    splitViewRef.current = null
    unifiedViewRef.current?.destroy()
    unifiedViewRef.current = null

    const rightDoc = diff.modifiedExists ? diff.modifiedContent : ''
    const leftDoc = diff.originalExists ? diff.originalContent : ''
    const createCodeMirrorIconControl = ({
      action,
      onActivate,
      title,
    }: {
      action: GitDiffBlockAction
      onActivate: (event: MouseEvent | KeyboardEvent, action: GitDiffBlockAction) => void
      title: string
    }) => {
      const control = document.createElement('div')
      control.className = 'git-diff-native-control clickable-icon'
      const resolvedTitle = areBlockActionsEnabledRef.current ? title : blockActionsDisabledReasonRef.current ?? title
      control.title = resolvedTitle
      control.dataset.action = action
      control.setAttribute('role', 'button')
      control.setAttribute('tabindex', areBlockActionsEnabledRef.current ? '0' : '-1')
      control.setAttribute('aria-label', resolvedTitle)
      control.setAttribute('aria-disabled', areBlockActionsEnabledRef.current ? 'false' : 'true')
      control.innerHTML = getCodeMirrorControlSvg(action)

      const handleActivate = (event: MouseEvent | KeyboardEvent) => {
        event.preventDefault()
        event.stopPropagation()

        if (!areBlockActionsEnabledRef.current) {
          return
        }

        onActivate(event, action)
      }

      control.onmousedown = handleActivate
      control.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          handleActivate(event)
        }
      }

      return control
    }
    const handleSplitBlockAction = (
      event: MouseEvent | KeyboardEvent,
      action: GitDiffBlockAction,
    ) => {
      if (!areBlockActionsEnabledRef.current || !splitViewRef.current) {
        return
      }

      const controlsRoot = (event.currentTarget as HTMLElement).closest<HTMLElement>('.git-diff-native-controls')
      const controlsParent = controlsRoot?.parentElement
      const chunkIndex = controlsRoot && controlsParent
        ? Array.from(controlsParent.children).indexOf(controlsRoot)
        : -1
      const chunkState = getChunks(splitViewRef.current.b.state)
      const chunk = chunkIndex > -1
        ? chunkState?.chunks[chunkIndex] as CodeMirrorChunk | undefined
        : undefined

      if (!chunk) {
        return
      }

      onBlockActionRef.current(
        createSelectionFromCodeMirrorChunk(splitViewRef.current.a.state.doc, splitViewRef.current.b.state.doc, chunk),
        action,
      )
    }
    const createSplitBlockControls = () => {
      const container = document.createElement('div')
      container.className = 'git-diff-native-controls'
      container.onmousedown = (event) => {
        event.preventDefault()
        event.stopPropagation()
      }

      if (diff.change.scope === 'unstaged') {
        container.append(createCodeMirrorIconControl({
          action: 'stage',
          onActivate: handleSplitBlockAction,
          title: 'Stage block',
        }))
        container.append(createCodeMirrorIconControl({
          action: 'discard',
          onActivate: handleSplitBlockAction,
          title: 'Discard block',
        }))
      } else {
        container.append(createCodeMirrorIconControl({
          action: 'unstage',
          onActivate: handleSplitBlockAction,
          title: 'Unstage block',
        }))
      }

      return container
    }
    const createUnifiedBlockControl = (action: GitDiffBlockAction, title: string) => {
      const handleUnifiedBlockAction = (event: MouseEvent | KeyboardEvent, requestedAction: GitDiffBlockAction) => {
        if (!areBlockActionsEnabledRef.current || !unifiedViewRef.current) {
          return
        }

        const chunkHost = (event.currentTarget as HTMLElement).closest<HTMLElement>('.cm-deletedChunk')

        if (!chunkHost) {
          return
        }

        const position = unifiedViewRef.current.posAtDOM(chunkHost)
        const chunkState = getChunks(unifiedViewRef.current.state)
        const chunk = chunkState?.chunks.find((candidate) => (
          candidate.fromB <= position && candidate.endB >= position
        )) as CodeMirrorChunk | undefined

        if (!chunk) {
          return
        }

        onBlockActionRef.current(
          createSelectionFromCodeMirrorChunk(getOriginalDoc(unifiedViewRef.current.state), unifiedViewRef.current.state.doc, chunk),
          requestedAction,
        )
      }

      return createCodeMirrorIconControl({
        action,
        onActivate: handleUnifiedBlockAction,
        title,
      })
    }

    if (viewMode === 'split') {
      splitViewRef.current = new MergeView({
        a: {
          doc: leftDoc,
          extensions: createDiffExtensions({
            editable: false,
            filePath: diff.change.path,
            onChange: () => { },
            onCompositionChange: () => { },
            onFocusChange: () => { },
            onSave: () => { },
            wrapLines: diff.editorKind === 'rich-text',
          }),
        },
        b: {
          doc: rightDoc,
          extensions: createDiffExtensions({
            editable: isEditable,
            filePath: diff.change.path,
            onChange: (content) => {
              onDraftChangeRef.current(content)
            },
            onCompositionChange: (nextValue) => {
              onCompositionChangeRef.current(nextValue)
            },
            onFocusChange: setIsModifiedFocused,
            onSave: () => {
              onSaveRef.current()
            },
            wrapLines: diff.editorKind === 'rich-text',
          }),
        },
        gutter: true,
        highlightChanges: true,
        collapseUnchanged: {
          margin: 4,
          minSize: 6,
        },
        diffConfig: {
          scanLimit: isEditable ? 1000 : 10000,
          timeout: 200,
        },
        renderRevertControl: createSplitBlockControls,
        revertControls: 'a-to-b',
        parent: container,
      })

      return () => {
        splitViewRef.current?.destroy()
        splitViewRef.current = null
      }
    }

    unifiedViewRef.current = new EditorView({
      doc: rightDoc,
      extensions: [
        ...createDiffExtensions({
          editable: isEditable,
          filePath: diff.change.path,
          onChange: (content) => {
            onDraftChangeRef.current(content)
          },
          onCompositionChange: (nextValue) => {
            onCompositionChangeRef.current(nextValue)
          },
          onFocusChange: setIsModifiedFocused,
          onSave: () => {
            onSaveRef.current()
          },
          wrapLines: diff.editorKind === 'rich-text',
        }),
        unifiedMergeView({
          allowInlineDiffs: true,
          collapseUnchanged: {
            margin: 4,
            minSize: 6,
          },
          diffConfig: {
            scanLimit: isEditable ? 1000 : 10000,
            timeout: 200,
          },
          gutter: true,
          highlightChanges: true,
          mergeControls: (kind) => {
            if (diff.change.scope === 'unstaged') {
              return kind === 'accept'
                ? createUnifiedBlockControl('stage', 'Stage block')
                : createUnifiedBlockControl('discard', 'Discard block')
            }

            return kind === 'accept'
              ? createUnifiedBlockControl('unstage', 'Unstage block')
              : document.createElement('span')
          },
          original: leftDoc,
          syntaxHighlightDeletions: true,
        }),
      ],
      parent: container,
    })

    return () => {
      unifiedViewRef.current?.destroy()
      unifiedViewRef.current = null
    }
  }, [
    diff.change.path,
    diff.change.scope,
    diff.modifiedExists,
    diff.originalContent,
    diff.originalExists,
    isEditable,
    viewMode,
  ])

  return (
    <div className='git-diff-codemirror-shell'>
      <div
        ref={containerRef}
        className={`git-diff-codemirror-host git-diff-codemirror-host-${viewMode}`}
      />
    </div>
  )
}

export function GitDiffEditor({
  diff,
  draftContent: initialDraftContent,
  hasDirtyRelatedFileTab = false,
  onApplyBlockAction,
  onDiscardChange,
  onDraftChange: onDraftContentChange,
  onSaveEditedFile,
  onStageChange,
  onUnstageChange,
}: {
  diff: GitFileDiffResult
  draftContent: string
  hasDirtyRelatedFileTab?: boolean
  onApplyBlockAction: (change: GitChangeItem, selection: GitDiffSelection, action: GitDiffBlockAction) => Promise<void>
  onDiscardChange: (change: GitChangeItem) => void
  onDraftChange: (content: string) => void
  onSaveEditedFile: (filePath: string, content: string) => Promise<void>
  onStageChange: (change: GitChangeItem) => void
  onUnstageChange: (change: GitChangeItem) => void
}) {
  const defaultMode: DiffViewMode = 'split'
  const [viewMode, setViewMode] = useState<DiffViewMode>(defaultMode)
  const [draftContent, setDraftContent] = useState(initialDraftContent)
  const draftContentRef = useRef(initialDraftContent)
  const latestModifiedContentRef = useRef(diff.modifiedContent)
  const onDraftContentChangeRef = useRef(onDraftContentChange)
  const [isApplyingBlockAction, setIsApplyingBlockAction] = useState(false)
  const [isComposing, setIsComposing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const isSavingRef = useRef(false)
  const isComposingRef = useRef(false)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isEditable = diff.change.scope === 'unstaged' && diff.modifiedExists
  const isDirty = draftContent !== diff.modifiedContent
  const blockActionsDisabledReason = getBlockActionsDisabledReason({
    isComposing,
    isApplyingAction: isApplyingBlockAction,
    isSaving,
  })
  const areBlockActionsEnabled = blockActionsDisabledReason === null
  const areFileGitActionsEnabled = !(isSaving || isApplyingBlockAction || isComposing)

  useEffect(() => {
    setViewMode(defaultMode)
  }, [defaultMode, diff.change.path, diff.change.scope])

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
  }, [diff.change.path, diff.change.scope])

  const handleCompositionChange = useCallback((nextValue: boolean) => {
    isComposingRef.current = nextValue
    setIsComposing((current) => current === nextValue ? current : nextValue)
  }, [])

  const handleDraftChange = useCallback((content: string) => {
    setDraftContent((current) => current === content ? current : content)
  }, [])

  const clearAutoSaveTimer = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
  }, [])

  const handleSave = useCallback(async () => {
    clearAutoSaveTimer()

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
  }, [clearAutoSaveTimer, diff.change.path, hasDirtyRelatedFileTab, isEditable, onSaveEditedFile])

  useEffect(() => {
    if (!isEditable || hasDirtyRelatedFileTab || isComposing || isSaving || !isDirty) {
      clearAutoSaveTimer()
      return
    }

    autoSaveTimerRef.current = setTimeout(() => {
      void handleSave()
    }, DIFF_AUTO_SAVE_DELAY_MS)

    return clearAutoSaveTimer
  }, [clearAutoSaveTimer, handleSave, hasDirtyRelatedFileTab, isComposing, isDirty, isEditable, isSaving])

  const handleBlockAction = useCallback(async (selection: GitDiffSelection, action: GitDiffBlockAction) => {
    if (!areBlockActionsEnabled) {
      return
    }

    setIsApplyingBlockAction(true)

    try {
      await onApplyBlockAction(diff.change, selection, action)
    } finally {
      setIsApplyingBlockAction(false)
    }
  }, [areBlockActionsEnabled, diff.change, onApplyBlockAction])

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
            </>
          ) : (
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
          )}
          <button
            type='button'
            className='git-diff-view-mode git-diff-view-mode-icon-only'
            aria-label={viewMode === 'split' ? 'Current diff view: split. Click to switch to inline.' : 'Current diff view: inline. Click to switch to split.'}
            aria-pressed={viewMode === 'split'}
            title={viewMode === 'split' ? 'Current diff view: split. Click to switch to inline.' : 'Current diff view: inline. Click to switch to split.'}
            onClick={() => {
              setViewMode((currentMode) => (currentMode === 'split' ? 'unified' : 'split'))
            }}
          >
            <Icon icon={viewMode === 'split' ? 'lucide:columns-2' : 'lucide:between-horizontal-start'} width={16} height={16} />
          </button>
        </div>
      </header>

      <CodeMirrorDiffRenderer
        blockActionsDisabledReason={blockActionsDisabledReason}
        areBlockActionsEnabled={areBlockActionsEnabled}
        diff={{
          ...diff,
          modifiedContent: draftContent,
        }}
        isComposing={isComposing}
        isEditable={isEditable}
        onBlockAction={(selection, action) => {
          void handleBlockAction(selection, action)
        }}
        onCompositionChange={handleCompositionChange}
        onDraftChange={handleDraftChange}
        onSave={() => {
          void handleSave()
        }}
        viewMode={viewMode}
      />
    </div>
  )
}
