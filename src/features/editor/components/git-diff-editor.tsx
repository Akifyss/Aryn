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
  endA: number
  endB: number
}
type MonacoLineChange = monaco.editor.ILineChange
type MonacoBlockOverlayItem = {
  key: string
  selection: GitDiffSelection
  top: number
}

configureMonaco()

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
    return '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3.25v9.5"/><path d="M3.25 8h9.5"/></svg>'
  }

  if (action === 'unstage') {
    return '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3.25 8h9.5"/></svg>'
  }

  return '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5.25 4.75H2.75V2.25"/><path d="M2.75 4.75A5.25 5.25 0 1 1 5 12.85"/></svg>'
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

  return null
}

function createDiffExtensions({
  editable,
  filePath,
  onChange,
  onSave,
  wrapLines,
}: {
  editable: boolean
  filePath: string
  onChange: (content: string) => void
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
  const onBlockActionRef = useRef(onBlockAction)
  const onDraftChangeRef = useRef(onDraftChange)
  const onSaveRef = useRef(onSave)
  const areBlockActionsEnabledRef = useRef(areBlockActionsEnabled)
  const blockActionsDisabledReasonRef = useRef(blockActionsDisabledReason)

  useEffect(() => {
    onBlockActionRef.current = onBlockAction
  }, [onBlockAction])

  useEffect(() => {
    onDraftChangeRef.current = onDraftChange
  }, [onDraftChange])

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

    splitView.b.dispatch({
      changes: {
        from: 0,
        to: splitView.b.state.doc.length,
        insert: diff.modifiedContent,
      },
    })
  }, [diff.modifiedContent])

  useEffect(() => {
    const unifiedView = unifiedViewRef.current

    if (!unifiedView) {
      return
    }

    const currentDoc = unifiedView.state.doc.toString()

    if (currentDoc === diff.modifiedContent) {
      return
    }

    unifiedView.dispatch({
      changes: {
        from: 0,
        to: unifiedView.state.doc.length,
        insert: diff.modifiedContent,
      },
    })
  }, [diff.modifiedContent])

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
            onChange: () => {},
            onSave: () => {},
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
  const latestModifiedContentRef = useRef(diff.modifiedContent)
  const [isApplyingBlockAction, setIsApplyingBlockAction] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const isSavingRef = useRef(false)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    latestModifiedContentRef.current = diff.modifiedContent
  }, [diff.change.path, diff.change.scope, diff.modifiedContent])

  useEffect(() => {
    draftContentRef.current = draftContent
  }, [draftContent])

  useEffect(() => {
    isSavingRef.current = isSaving
  }, [isSaving])

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

    if (!isEditable || isSavingRef.current || draftContentRef.current === latestModifiedContentRef.current) {
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
  }, [clearAutoSaveTimer, diff.change.path, isEditable, onSaveEditedFile])

  useEffect(() => {
    if (!isEditable || isSaving || !isDirty) {
      clearAutoSaveTimer()
      return
    }

    autoSaveTimerRef.current = setTimeout(() => {
      void handleSave()
    }, DIFF_AUTO_SAVE_DELAY_MS)

    return clearAutoSaveTimer
  }, [clearAutoSaveTimer, handleSave, isDirty, isEditable, isSaving])

  useEffect(() => () => {
    if (autoSaveTimerRef.current && isEditable && draftContentRef.current !== latestModifiedContentRef.current) {
      void handleSave()
      return
    }

    clearAutoSaveTimer()
  }, [clearAutoSaveTimer, handleSave, isEditable])

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
