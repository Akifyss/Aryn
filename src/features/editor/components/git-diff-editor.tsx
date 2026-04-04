import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@heroui/react'
import { EditorState } from '@codemirror/state'
import {
  MergeView,
  unifiedMergeView,
} from '@codemirror/merge'
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
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { ArrowDownLine, ArrowUpLine, Refresh2Line, SaveLine } from '@mingcute/react'
import type { GitChangeItem, GitFileDiffResult } from '@/features/git/types'
import { getCodeMirrorLanguageSupport } from '@/features/editor/lib/codemirror-language'

type DiffViewMode = 'split' | 'unified'

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
    borderRight: '1px solid var(--panel-border)',
    backgroundColor: 'color-mix(in oklab, var(--panel-surface-base) 98%, white)',
    color: 'var(--panel-muted)',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in oklab, var(--accent) 4%, white)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'color-mix(in oklab, var(--accent) 7%, white)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in oklab, var(--accent) 18%, white)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--foreground)',
  },
})

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

export function GitDiffEditor({
  diff,
  onDiscardChange,
  onSaveEditedFile,
  onStageChange,
  onUnstageChange,
}: {
  diff: GitFileDiffResult
  onDiscardChange: (change: GitChangeItem) => void
  onSaveEditedFile: (filePath: string, content: string) => Promise<void>
  onStageChange: (change: GitChangeItem) => void
  onUnstageChange: (change: GitChangeItem) => void
}) {
  const defaultMode = diff.editorKind === 'rich-text' ? 'unified' : 'split'
  const [viewMode, setViewMode] = useState<DiffViewMode>(defaultMode)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const splitViewRef = useRef<MergeView | null>(null)
  const unifiedViewRef = useRef<EditorView | null>(null)
  const [draftContent, setDraftContent] = useState(diff.modifiedContent)
  const draftContentRef = useRef(diff.modifiedContent)
  const [isSaving, setIsSaving] = useState(false)
  const isEditable = diff.change.scope === 'unstaged' && diff.modifiedExists
  const isDirty = draftContent !== diff.modifiedContent
  const fileDescription = useMemo(
    () => {
      if (!diff.originalExists && diff.modifiedExists) {
        return 'new file'
      }

      if (diff.originalExists && !diff.modifiedExists) {
        return 'deleted file'
      }

      return diff.change.kind
    },
    [diff.change.kind, diff.modifiedExists, diff.originalExists],
  )

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

    const handleDraftChange = (content: string) => {
      draftContentRef.current = content
      setDraftContent(content)
    }

    const handleSave = () => {
      if (!isEditable || isSaving) {
        return
      }

      void (async () => {
        setIsSaving(true)

        try {
          await onSaveEditedFile(diff.change.path, draftContentRef.current)
        } finally {
          setIsSaving(false)
        }
      })()
    }

    const rightDoc = diff.modifiedExists ? draftContentRef.current : ''
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
            onChange: handleDraftChange,
            onSave: handleSave,
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
          onChange: handleDraftChange,
          onSave: handleSave,
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
    isSaving,
    onSaveEditedFile,
    viewMode,
  ])

  async function handleSave() {
    if (!isEditable || isSaving || !isDirty) {
      return
    }

    setIsSaving(true)

    try {
      await onSaveEditedFile(diff.change.path, draftContentRef.current)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className='git-diff-editor'>
      <header className='git-diff-header'>
        <div className='git-diff-header-copy'>
          <p className='eyebrow'>Git Diff</p>
          <h3>{diff.change.relativePath}</h3>
          <p>
            {diff.originalLabel}
            {' -> '}
            {diff.modifiedLabel}
            {' / '}
            {fileDescription}
          </p>
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

      <div className='git-diff-meta-row'>
        <span className='git-diff-meta-pill'>{diff.originalLabel}</span>
        <span className='git-diff-meta-arrow'>to</span>
        <span className='git-diff-meta-pill'>{diff.modifiedLabel}</span>
        <span className={`git-diff-meta-pill${isEditable ? ' is-editable' : ''}`}>{fileDescription}</span>
      </div>

      <div className='git-diff-codemirror-shell'>
        <div
          ref={containerRef}
          className={`git-diff-codemirror-host git-diff-codemirror-host-${viewMode}`}
        />
      </div>
    </div>
  )
}
