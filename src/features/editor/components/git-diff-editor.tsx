import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { Button } from '@heroui/react'
import { EditorState } from '@codemirror/state'
import { MergeView, unifiedMergeView } from '@codemirror/merge'
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
import { ArrowDownLine, ArrowUpLine, Refresh2Line, SaveLine } from '@mingcute/react'
import * as monaco from 'monaco-editor'
import type { GitChangeItem, GitFileDiffResult } from '@/features/git/types'
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
  diff,
  isEditable,
  onDraftChange,
  onSave,
  viewMode,
}: {
  diff: GitFileDiffResult
  isEditable: boolean
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
          mergeControls: false,
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
    diff.modifiedContent,
    diff.modifiedExists,
    diff.originalContent,
    diff.originalExists,
    isEditable,
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
  diff,
  draftContent,
  isEditable,
  onDraftChange,
  onSave,
  theme,
  viewMode,
}: {
  diff: GitFileDiffResult
  draftContent: string
  isEditable: boolean
  onDraftChange: (content: string) => void
  onSave: () => void
  theme: MonacoThemePreference
  viewMode: DiffViewMode
}) {
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const latestDraftRef = useRef(draftContent)
  const onSaveRef = useRef(onSave)
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

  const handleMount = useCallback<NonNullable<ComponentProps<typeof DiffEditor>['onMount']>>((editor, monacoInstance) => {
    diffEditorRef.current = editor

    const originalEditor = editor.getOriginalEditor()
    const modifiedEditor = editor.getModifiedEditor()
    originalEditor.updateOptions({ tabSize: 2 })
    modifiedEditor.updateOptions({ tabSize: 2 })
    modifiedEditor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      void onSaveRef.current()
    })

    modifiedEditor.onDidChangeModelContent(() => {
      const nextValue = modifiedEditor.getValue()

      if (nextValue === latestDraftRef.current) {
        return
      }

      latestDraftRef.current = nextValue
      onDraftChange(nextValue)
    })
  }, [onDraftChange])

  useEffect(() => () => {
    diffEditorRef.current = null
  }, [])

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
    </div>
  )
}

export function GitDiffEditor({
  diff,
  onDiscardChange,
  onSaveEditedFile,
  onStageChange,
  onUnstageChange,
  theme = 'auto',
}: {
  diff: GitFileDiffResult
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
  const [isSaving, setIsSaving] = useState(false)
  const isEditable = diff.change.scope === 'unstaged' && diff.modifiedExists
  const isDirty = draftContent !== diff.modifiedContent

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
                className='git-diff-view-mode'
                onClick={() => {
                  onDiscardChange(diff.change)
                }}
              >
                <Refresh2Line size={15} />
                Discard
              </button>
              <button
                type='button'
                className='git-diff-view-mode'
                onClick={() => {
                  onStageChange(diff.change)
                }}
              >
                <ArrowUpLine size={15} />
                Stage
              </button>
            </>
          ) : (
            <button
              type='button'
              className='git-diff-view-mode'
              onClick={() => {
                onUnstageChange(diff.change)
              }}
            >
              <ArrowDownLine size={15} />
              Unstage
            </button>
          )}
          <button
            type='button'
            className={`git-diff-view-mode${viewMode === 'unified' ? ' is-active' : ''}`}
            onClick={() => {
              setViewMode('unified')
            }}
          >
            Inline
          </button>
          <button
            type='button'
            className={`git-diff-view-mode${viewMode === 'split' ? ' is-active' : ''}`}
            onClick={() => {
              setViewMode('split')
            }}
          >
            Split
          </button>
          <Button
            variant='primary'
            size='sm'
            isDisabled={!isEditable || !isDirty || isSaving}
            onPress={() => {
              void handleSave()
            }}
          >
            <SaveLine size={16} />
            {isSaving ? 'Saving' : 'Save'}
          </Button>
        </div>
      </header>

      {diff.editorKind === 'rich-text' ? (
        <RichTextDiffRenderer
          diff={{
            ...diff,
            modifiedContent: draftContent,
          }}
          isEditable={isEditable}
          onDraftChange={handleDraftChange}
          onSave={() => {
            void handleSave()
          }}
          viewMode={viewMode}
        />
      ) : (
        <CodeDiffRenderer
          diff={diff}
          draftContent={draftContent}
          isEditable={isEditable}
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
