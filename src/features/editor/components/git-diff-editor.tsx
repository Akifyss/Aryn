import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
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
import * as monaco from 'monaco-editor'
import type { GitChangeItem, GitDiffBlockAction, GitDiffSelection, GitFileDiffResult } from '@/features/git/types'
import { getCodeMirrorLanguageSupport } from '@/features/editor/lib/codemirror-language'
import {
  DiffEditor,
  configureMonaco,
  resolveMonacoTheme,
  type MonacoDiffEditorOptions,
  type MonacoThemePreference,
} from '@/features/editor/lib/monaco'
import { getCodeLanguage } from '@/features/workspace/lib/file-types'

type DiffViewMode = 'split' | 'unified'
type CodeMirrorChunk = {
  fromA: number
  toA: number
  fromB: number
  toB: number
}
type MonacoLineChange = monaco.editor.ILineChange
type MonacoBlockOverlayItem = {
  key: string
  selection: GitDiffSelection
  top: number
}

configureMonaco()

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
  '.cm-gutters': {
    borderRight: '1px solid var(--separator)',
    backgroundColor: 'var(--surface-secondary)',
    color: 'var(--muted)',
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

const DEFAULT_MONACO_DIFF_OPTIONS: MonacoDiffEditorOptions = {
  automaticLayout: true,
  diffAlgorithm: 'advanced',
  diffWordWrap: 'inherit',
  enableSplitViewResizing: true,
  fontFamily: '"SF Mono", "Cascadia Code", Consolas, "Liberation Mono", monospace',
  fontLigatures: true,
  fontSize: 13.5,
  hideUnchangedRegions: {
    enabled: true,
    contextLineCount: 3,
    minimumLineCount: 4,
    revealLineCount: 3,
  },
  ignoreTrimWhitespace: false,
  lineNumbersMinChars: 3,
  minimap: { enabled: false },
  originalEditable: false,
  overviewRulerBorder: false,
  padding: {
    top: 18,
    bottom: 18,
  },
  readOnly: false,
  renderGutterMenu: false,
  renderIndicators: true,
  renderMarginRevertIcon: false,
  renderOverviewRuler: false,
  roundedSelection: false,
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  useInlineViewWhenSpaceIsLimited: false,
}

function getLineCountFromMonacoRange(startLine: number, endLine: number) {
  if (startLine === 0 && endLine === 0) {
    return 0
  }

  return Math.max(0, endLine - startLine + 1)
}

function createSelectionFromMonacoLineChange(change: MonacoLineChange): GitDiffSelection {
  return {
    modifiedLineCount: getLineCountFromMonacoRange(change.modifiedStartLineNumber, change.modifiedEndLineNumber),
    modifiedStartLine: Math.max(1, change.modifiedStartLineNumber || change.modifiedEndLineNumber || 1),
    originalLineCount: getLineCountFromMonacoRange(change.originalStartLineNumber, change.originalEndLineNumber),
    originalStartLine: Math.max(1, change.originalStartLineNumber || change.originalEndLineNumber || 1),
  }
}

function getTextLineCount(doc: Text, from: number, to: number) {
  if (from === to) {
    return 0
  }

  const startLine = doc.lineAt(Math.min(from, doc.length)).number
  const endLine = doc.lineAt(Math.max(0, Math.min(doc.length, to) - 1)).number
  return Math.max(0, endLine - startLine + 1)
}

function getTextAnchorLine(doc: Text, from: number, to: number) {
  if (doc.lines === 0) {
    return 1
  }

  const anchorPos = from === to
    ? Math.min(from, doc.length)
    : Math.min(from, Math.max(0, to - 1))

  return doc.lineAt(anchorPos).number
}

function createSelectionFromCodeMirrorChunk(originalDoc: Text, modifiedDoc: Text, chunk: CodeMirrorChunk): GitDiffSelection {
  return {
    modifiedLineCount: getTextLineCount(modifiedDoc, chunk.fromB, chunk.toB),
    modifiedStartLine: getTextAnchorLine(modifiedDoc, chunk.fromB, chunk.toB),
    originalLineCount: getTextLineCount(originalDoc, chunk.fromA, chunk.toA),
    originalStartLine: getTextAnchorLine(originalDoc, chunk.fromA, chunk.toA),
  }
}

function getBlockActionsDisabledReason(
  diff: GitFileDiffResult,
  options: {
    hasDirtyFileTab: boolean
    isApplyingAction: boolean
    isDirty: boolean
    isSaving: boolean
  },
) {
  if (options.isSaving || options.isApplyingAction) {
    return 'Wait for the current file action to finish first.'
  }

  if (options.isDirty) {
    return 'Save changes before applying Git block actions.'
  }

  if (options.hasDirtyFileTab) {
    return 'Save other open editor tabs for this file before applying Git block actions.'
  }

  if (diff.change.scope === 'unstaged' && diff.change.kind === 'untracked') {
    return 'Block actions are not available for untracked files yet.'
  }

  return null
}

function createDiffExtensions({
  editable,
  filePath,
  onChange,
  onSave,
}: {
  editable: boolean
  filePath: string
  onChange: (content: string) => void
  onSave: () => void
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
    EditorView.lineWrapping,
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
  ]
}

function RichTextDiffRenderer({
  blockActionsDisabledReason,
  areBlockActionsEnabled,
  diff,
  isEditable,
  onBlockAction,
  onDraftChange,
  onSave,
  viewMode,
}: {
  blockActionsDisabledReason: string | null
  areBlockActionsEnabled: boolean
  diff: GitFileDiffResult
  isEditable: boolean
  onBlockAction: (selection: GitDiffSelection, action: GitDiffBlockAction) => void
  onDraftChange: (content: string) => void
  onSave: () => void
  viewMode: DiffViewMode
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const splitViewRef = useRef<MergeView | null>(null)
  const unifiedViewRef = useRef<EditorView | null>(null)

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
    const handleSplitBlockAction = (
      event: MouseEvent,
      action: GitDiffBlockAction,
    ) => {
      event.preventDefault()
      event.stopPropagation()

      if (!areBlockActionsEnabled || !splitViewRef.current) {
        return
      }

      const chunkRoot = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-chunk]')
      const chunkIndex = chunkRoot?.dataset.chunk ? Number(chunkRoot.dataset.chunk) : Number.NaN
      const chunk = Number.isInteger(chunkIndex)
        ? (splitViewRef.current as MergeView & { chunks?: CodeMirrorChunk[] }).chunks?.[chunkIndex]
        : undefined

      if (!chunk) {
        return
      }

      onBlockAction(
        createSelectionFromCodeMirrorChunk(splitViewRef.current.a.state.doc, splitViewRef.current.b.state.doc, chunk),
        action,
      )
    }
    const createSplitBlockControls = () => {
      const container = document.createElement('div')
      container.className = 'git-diff-block-controls'
      container.onmousedown = (event) => {
        event.preventDefault()
        event.stopPropagation()
      }

      if (diff.change.scope === 'unstaged') {
        const discardButton = document.createElement('button')
        discardButton.type = 'button'
        discardButton.className = 'git-diff-block-control'
        discardButton.textContent = '↶'
        discardButton.title = areBlockActionsEnabled ? 'Discard block' : blockActionsDisabledReason ?? 'Discard block'
        discardButton.setAttribute('aria-label', discardButton.title)
        discardButton.disabled = !areBlockActionsEnabled
        discardButton.onmousedown = (event) => {
          handleSplitBlockAction(event, 'discard')
        }
        container.append(discardButton)

        const stageButton = document.createElement('button')
        stageButton.type = 'button'
        stageButton.className = 'git-diff-block-control'
        stageButton.textContent = '+'
        stageButton.title = areBlockActionsEnabled ? 'Stage block' : blockActionsDisabledReason ?? 'Stage block'
        stageButton.setAttribute('aria-label', stageButton.title)
        stageButton.disabled = !areBlockActionsEnabled
        stageButton.onmousedown = (event) => {
          handleSplitBlockAction(event, 'stage')
        }
        container.append(stageButton)
      } else {
        const unstageButton = document.createElement('button')
        unstageButton.type = 'button'
        unstageButton.className = 'git-diff-block-control'
        unstageButton.textContent = '−'
        unstageButton.title = areBlockActionsEnabled ? 'Unstage block' : blockActionsDisabledReason ?? 'Unstage block'
        unstageButton.setAttribute('aria-label', unstageButton.title)
        unstageButton.disabled = !areBlockActionsEnabled
        unstageButton.onmousedown = (event) => {
          handleSplitBlockAction(event, 'unstage')
        }
        container.append(unstageButton)
      }

      return container
    }
    const createUnifiedBlockControl = (action: GitDiffBlockAction, title: string, label: string) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'git-diff-block-control'
      button.textContent = label
      button.title = areBlockActionsEnabled ? title : blockActionsDisabledReason ?? title
      button.setAttribute('aria-label', button.title)
      button.disabled = !areBlockActionsEnabled
      button.onmousedown = (event) => {
        event.preventDefault()
        event.stopPropagation()

        if (!areBlockActionsEnabled || !unifiedViewRef.current) {
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

        onBlockAction(
          createSelectionFromCodeMirrorChunk(getOriginalDoc(unifiedViewRef.current.state), unifiedViewRef.current.state.doc, chunk),
          action,
        )
      }

      return button
    }

    if (viewMode === 'split') {
      splitViewRef.current = new MergeView({
        a: {
          doc: leftDoc,
          extensions: createDiffExtensions({
            editable: false,
            filePath: diff.change.path,
            onChange: () => {},
            onSave: () => {},
          }),
        },
        b: {
          doc: rightDoc,
          extensions: createDiffExtensions({
            editable: isEditable,
            filePath: diff.change.path,
            onChange: onDraftChange,
            onSave,
          }),
        },
        gutter: true,
        highlightChanges: true,
        collapseUnchanged: {
          margin: 3,
          minSize: 4,
        },
        diffConfig: {
          scanLimit: 500,
          timeout: 1000,
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
          onChange: onDraftChange,
          onSave,
        }),
        unifiedMergeView({
          allowInlineDiffs: true,
          collapseUnchanged: {
            margin: 3,
            minSize: 4,
          },
          diffConfig: {
            scanLimit: 500,
            timeout: 1000,
          },
          gutter: true,
          highlightChanges: true,
          mergeControls: (kind) => {
            if (diff.change.scope === 'unstaged') {
              return kind === 'accept'
                ? createUnifiedBlockControl('stage', 'Stage block', '+')
                : createUnifiedBlockControl('discard', 'Discard block', '↶')
            }

            return kind === 'accept'
              ? createUnifiedBlockControl('unstage', 'Unstage block', '−')
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
    blockActionsDisabledReason,
    diff.change.path,
    diff.change.scope,
    diff.modifiedContent,
    diff.modifiedExists,
    diff.originalContent,
    diff.originalExists,
    areBlockActionsEnabled,
    isEditable,
    onBlockAction,
    onDraftChange,
    onSave,
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

function CodeDiffRenderer({
  blockActionsDisabledReason,
  areBlockActionsEnabled,
  diff,
  draftContent,
  isEditable,
  onBlockAction,
  onDraftChange,
  onSave,
  theme,
  viewMode,
}: {
  blockActionsDisabledReason: string | null
  areBlockActionsEnabled: boolean
  diff: GitFileDiffResult
  draftContent: string
  isEditable: boolean
  onBlockAction: (selection: GitDiffSelection, action: GitDiffBlockAction) => void
  onDraftChange: (content: string) => void
  onSave: () => void
  theme: MonacoThemePreference
  viewMode: DiffViewMode
}) {
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const diffEditorDisposablesRef = useRef<monaco.IDisposable[]>([])
  const latestDraftRef = useRef(draftContent)
  const onSaveRef = useRef(onSave)
  const [overlayVersion, setOverlayVersion] = useState(0)
  const [lineChanges, setLineChanges] = useState<readonly MonacoLineChange[]>([])
  const language = useMemo(() => getCodeLanguage(diff.change.path), [diff.change.path])
  const monacoTheme = useMemo(() => resolveMonacoTheme(theme), [theme])
  const editorOptions = useMemo<MonacoDiffEditorOptions>(() => ({
    ...DEFAULT_MONACO_DIFF_OPTIONS,
    experimental: {
      useTrueInlineView: viewMode === 'unified',
    },
    readOnly: !isEditable,
    renderSideBySide: viewMode === 'split',
  }), [isEditable, viewMode])

  useEffect(() => {
    latestDraftRef.current = draftContent
  }, [draftContent])

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  const syncLineChanges = useCallback(() => {
    const editor = diffEditorRef.current

    if (!editor) {
      setLineChanges([])
      return
    }

    setLineChanges(editor.getLineChanges() ?? [])
    setOverlayVersion((current) => current + 1)
  }, [])

  const handleMount = useCallback<NonNullable<ComponentProps<typeof DiffEditor>['onMount']>>((editor, monacoInstance) => {
    diffEditorDisposablesRef.current.forEach((disposable) => {
      disposable.dispose()
    })
    diffEditorDisposablesRef.current = []
    diffEditorRef.current = editor

    const originalEditor = editor.getOriginalEditor()
    const modifiedEditor = editor.getModifiedEditor()
    originalEditor.updateOptions({ tabSize: 2 })
    modifiedEditor.updateOptions({ tabSize: 2 })
    modifiedEditor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      void onSaveRef.current()
    })

    diffEditorDisposablesRef.current = [
      editor.onDidUpdateDiff(() => {
        syncLineChanges()
      }),
      originalEditor.onDidScrollChange(() => {
        setOverlayVersion((current) => current + 1)
      }),
      modifiedEditor.onDidScrollChange(() => {
        setOverlayVersion((current) => current + 1)
      }),
      originalEditor.onDidLayoutChange(() => {
        setOverlayVersion((current) => current + 1)
      }),
      modifiedEditor.onDidLayoutChange(() => {
        setOverlayVersion((current) => current + 1)
      }),
    ]

    diffEditorDisposablesRef.current.push(modifiedEditor.onDidChangeModelContent(() => {
      const nextValue = modifiedEditor.getValue()

      if (nextValue === latestDraftRef.current) {
        return
      }

      latestDraftRef.current = nextValue
      onDraftChange(nextValue)
    }))

    syncLineChanges()
  }, [onDraftChange, syncLineChanges])

  useEffect(() => () => {
    diffEditorDisposablesRef.current.forEach((disposable) => {
      disposable.dispose()
    })
    diffEditorDisposablesRef.current = []
    diffEditorRef.current = null
  }, [])

  useEffect(() => {
    syncLineChanges()
  }, [diff.change.path, diff.change.scope, draftContent, diff.originalContent, syncLineChanges])

  const overlayItems = useMemo<MonacoBlockOverlayItem[]>(() => {
    const editor = diffEditorRef.current

    if (!editor || lineChanges.length === 0) {
      return []
    }

    const originalEditor = editor.getOriginalEditor()
    const modifiedEditor = editor.getModifiedEditor()

    return lineChanges.map((change, index) => {
      const modifiedLine = Math.max(1, change.modifiedStartLineNumber || change.modifiedEndLineNumber || 1)
      const originalLine = Math.max(1, change.originalStartLineNumber || change.originalEndLineNumber || 1)
      const top = viewMode === 'split'
        ? Math.min(
          modifiedEditor.getTopForLineNumber(modifiedLine),
          originalEditor.getTopForLineNumber(originalLine),
        )
        : modifiedEditor.getTopForLineNumber(modifiedLine)

      return {
        key: `${change.originalStartLineNumber}:${change.originalEndLineNumber}:${change.modifiedStartLineNumber}:${change.modifiedEndLineNumber}:${index}`,
        selection: createSelectionFromMonacoLineChange(change),
        top,
      }
    })
  }, [lineChanges, overlayVersion, viewMode])

  const renderBlockButtons = useCallback((selection: GitDiffSelection) => {
    if (diff.change.scope === 'staged') {
      return (
        <button
          type='button'
          className='git-diff-block-control'
          aria-label={areBlockActionsEnabled ? 'Unstage block' : blockActionsDisabledReason ?? 'Unstage block'}
          title={areBlockActionsEnabled ? 'Unstage block' : blockActionsDisabledReason ?? 'Unstage block'}
          disabled={!areBlockActionsEnabled}
          onClick={() => {
            onBlockAction(selection, 'unstage')
          }}
        >
          <Icon icon='mdi:minus' width={14} height={14} />
        </button>
      )
    }

    return (
      <>
        <button
          type='button'
          className='git-diff-block-control'
          aria-label={areBlockActionsEnabled ? 'Discard block' : blockActionsDisabledReason ?? 'Discard block'}
          title={areBlockActionsEnabled ? 'Discard block' : blockActionsDisabledReason ?? 'Discard block'}
          disabled={!areBlockActionsEnabled}
          onClick={() => {
            onBlockAction(selection, 'discard')
          }}
        >
          <Back2Line size={14} />
        </button>
        <button
          type='button'
          className='git-diff-block-control'
          aria-label={areBlockActionsEnabled ? 'Stage block' : blockActionsDisabledReason ?? 'Stage block'}
          title={areBlockActionsEnabled ? 'Stage block' : blockActionsDisabledReason ?? 'Stage block'}
          disabled={!areBlockActionsEnabled}
          onClick={() => {
            onBlockAction(selection, 'stage')
          }}
        >
          <AddLine size={14} />
        </button>
      </>
    )
  }, [areBlockActionsEnabled, blockActionsDisabledReason, diff.change.scope, onBlockAction])

  const encodedPath = encodeURIComponent(diff.change.path)

  return (
    <div className='git-diff-monaco-shell'>
      <DiffEditor
        className='git-diff-monaco-editor'
        height='100%'
        language={language}
        modified={diff.modifiedExists ? draftContent : ''}
        modifiedModelPath={`git-diff://modified/${encodedPath}?scope=${diff.change.scope}`}
        options={editorOptions}
        original={diff.originalExists ? diff.originalContent : ''}
        originalModelPath={`git-diff://original/${encodedPath}?scope=${diff.change.scope}`}
        theme={monacoTheme}
        onMount={handleMount}
      />
      {overlayItems.length > 0 ? (
        <div className={`git-diff-block-overlay git-diff-block-overlay-${viewMode}`}>
          {overlayItems.map((item) => (
            <div
              key={item.key}
              className='git-diff-block-controls git-diff-block-overlay-item'
              style={{ top: `${item.top + 8}px` }}
            >
              {renderBlockButtons(item.selection)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function GitDiffEditor({
  diff,
  hasDirtyRelatedFileTab = false,
  onApplyBlockAction,
  onDiscardChange,
  onSaveEditedFile,
  onStageChange,
  onUnstageChange,
  theme = 'auto',
}: {
  diff: GitFileDiffResult
  hasDirtyRelatedFileTab?: boolean
  onApplyBlockAction: (change: GitChangeItem, selection: GitDiffSelection, action: GitDiffBlockAction) => Promise<void>
  onDiscardChange: (change: GitChangeItem) => void
  onSaveEditedFile: (filePath: string, content: string) => Promise<void>
  onStageChange: (change: GitChangeItem) => void
  onUnstageChange: (change: GitChangeItem) => void
  theme?: MonacoThemePreference
}) {
  const defaultMode: DiffViewMode = 'split'
  const [viewMode, setViewMode] = useState<DiffViewMode>(defaultMode)
  const [draftContent, setDraftContent] = useState(diff.modifiedContent)
  const draftContentRef = useRef(diff.modifiedContent)
  const [isApplyingBlockAction, setIsApplyingBlockAction] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const isEditable = diff.change.scope === 'unstaged' && diff.modifiedExists
  const isDirty = draftContent !== diff.modifiedContent
  const blockActionsDisabledReason = getBlockActionsDisabledReason(diff, {
    hasDirtyFileTab: hasDirtyRelatedFileTab,
    isApplyingAction: isApplyingBlockAction,
    isDirty,
    isSaving,
  })
  const areBlockActionsEnabled = blockActionsDisabledReason === null
  const areFileGitActionsEnabled = !(isSaving || isApplyingBlockAction || (
    diff.change.scope === 'unstaged' && (isDirty || hasDirtyRelatedFileTab)
  ))

  useEffect(() => {
    setViewMode(defaultMode)
  }, [defaultMode, diff.change.path, diff.change.scope])

  useEffect(() => {
    setDraftContent(diff.modifiedContent)
    draftContentRef.current = diff.modifiedContent
  }, [diff.change.path, diff.change.scope, diff.modifiedContent])

  useEffect(() => {
    draftContentRef.current = draftContent
  }, [draftContent])

  const handleDraftChange = useCallback((content: string) => {
    setDraftContent((current) => current === content ? current : content)
  }, [])

  const handleSave = useCallback(async () => {
    if (!isEditable || isSaving || draftContentRef.current === diff.modifiedContent) {
      return
    }

    setIsSaving(true)

    try {
      await onSaveEditedFile(diff.change.path, draftContentRef.current)
    } finally {
      setIsSaving(false)
    }
  }, [diff.change.path, diff.modifiedContent, isEditable, isSaving, onSaveEditedFile])

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
          <button
            type='button'
            className='git-diff-view-mode git-diff-view-mode-icon-only'
            aria-label={isSaving ? 'Saving file' : 'Save file'}
            title={isSaving ? 'Saving file' : 'Save file'}
            disabled={!isEditable || !isDirty || isSaving}
            onClick={() => {
              void handleSave()
            }}
          >
            <Icon icon='lucide:save' width={16} height={16} />
          </button>
        </div>
      </header>

      {diff.editorKind === 'rich-text' ? (
        <RichTextDiffRenderer
          blockActionsDisabledReason={blockActionsDisabledReason}
          areBlockActionsEnabled={areBlockActionsEnabled}
          diff={{
            ...diff,
            modifiedContent: draftContent,
          }}
          isEditable={isEditable}
          onBlockAction={(selection, action) => {
            void handleBlockAction(selection, action)
          }}
          onDraftChange={handleDraftChange}
          onSave={() => {
            void handleSave()
          }}
          viewMode={viewMode}
        />
      ) : (
        <CodeDiffRenderer
          blockActionsDisabledReason={blockActionsDisabledReason}
          areBlockActionsEnabled={areBlockActionsEnabled}
          diff={diff}
          draftContent={draftContent}
          isEditable={isEditable}
          onBlockAction={(selection, action) => {
            void handleBlockAction(selection, action)
          }}
          onDraftChange={handleDraftChange}
          onSave={() => {
            void handleSave()
          }}
          theme={theme}
          viewMode={viewMode}
        />
      )}
    </div>
  )
}
