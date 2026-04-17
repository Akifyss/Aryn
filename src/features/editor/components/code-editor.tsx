import * as React from 'react'
import { getCodeLanguage } from '@/features/workspace/lib/file-types'
import {
  acquireMonacoFileModel,
  createMonacoEditor,
  monaco,
  resolveMonacoTheme,
  type MonacoEditorOptions,
  type MonacoThemePreference,
} from '@/features/editor/lib/monaco'

type MonacoFileModelLease = Awaited<ReturnType<typeof acquireMonacoFileModel>>

type CodeEditorProps = {
  disabled?: boolean
  filePath: string
  onCompositionChange?: (isComposing: boolean) => void
  onSave?: (nextValue: string) => void
  value: string
  onChange: (nextValue: string) => void
  theme?: MonacoThemePreference
}

const DEFAULT_EDITOR_OPTIONS: MonacoEditorOptions = {
  automaticLayout: true,
  fontFamily: '"SF Mono", "Cascadia Code", Consolas, "Liberation Mono", monospace',
  fontLigatures: true,
  fontSize: 13.5,
  lineNumbersMinChars: 3,
  minimap: { enabled: false },
  overviewRulerBorder: false,
  padding: {
    top: 18,
    bottom: 18,
  },
  readOnly: false,
  renderLineHighlight: 'gutter',
  renderWhitespace: 'selection',
  roundedSelection: false,
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  tabSize: 2,
}

export function CodeEditor({
  disabled = false,
  filePath,
  onCompositionChange,
  onSave,
  onChange,
  value,
  theme = 'auto',
}: CodeEditorProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const monacoTheme = React.useMemo(() => resolveMonacoTheme(theme), [theme])
  const editorRef = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelLeaseRef = React.useRef<MonacoFileModelLease | null>(null)
  const disposablesRef = React.useRef<monaco.IDisposable[]>([])
  const isComposingRef = React.useRef(false)
  const isFocusedRef = React.useRef(false)
  const isApplyingExternalValueRef = React.useRef(false)
  const lastForwardedValueRef = React.useRef(value)
  const onChangeRef = React.useRef(onChange)
  const onCompositionChangeRef = React.useRef(onCompositionChange)
  const onSaveRef = React.useRef(onSave)
  const pendingValueRef = React.useRef<string | null>(null)
  const [isFocused, setIsFocused] = React.useState(false)

  const emitChange = React.useCallback((nextValue: string) => {
    if (nextValue === lastForwardedValueRef.current) {
      return
    }

    lastForwardedValueRef.current = nextValue
    onChangeRef.current(nextValue)
  }, [])

  const disposeEditorResources = React.useCallback(() => {
    disposablesRef.current.forEach((disposable) => {
      disposable.dispose()
    })
    disposablesRef.current = []
    editorRef.current?.dispose()
    editorRef.current = null
    modelLeaseRef.current?.release()
    modelLeaseRef.current = null
  }, [])

  React.useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  React.useEffect(() => {
    onCompositionChangeRef.current = onCompositionChange
  }, [onCompositionChange])

  React.useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  React.useEffect(() => {
    let cancelled = false

    const mountEditor = async () => {
      const container = containerRef.current

      if (!container) {
        return
      }

      try {
        const modelLease = await acquireMonacoFileModel(filePath, value)

        if (cancelled) {
          modelLease.release()
          return
        }

        const model = modelLease.modelRef.object.textEditorModel
        if (!model) {
          modelLease.release()
          return
        }

        const nextLanguage = getCodeLanguage(filePath)

        if (model.getLanguageId() !== nextLanguage) {
          monaco.editor.setModelLanguage(model, nextLanguage)
        }

        monaco.editor.setTheme(monacoTheme)
        container.replaceChildren()

        const editor = createMonacoEditor(container, {
          ...DEFAULT_EDITOR_OPTIONS,
          model,
          readOnly: disabled,
        })

        if (cancelled) {
          editor.dispose()
          modelLease.release()
          return
        }

        lastForwardedValueRef.current = model.getValue()
        editorRef.current = editor
        modelLeaseRef.current = modelLease

        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          onSaveRef.current?.(editor.getValue())
        })

        disposablesRef.current = [
          editor.onDidFocusEditorText(() => {
            isFocusedRef.current = true
            setIsFocused(true)
          }),
          editor.onDidBlurEditorText(() => {
            isFocusedRef.current = false
            setIsFocused(false)
          }),
          editor.onDidCompositionStart(() => {
            isComposingRef.current = true
            onCompositionChangeRef.current?.(true)
          }),
          editor.onDidCompositionEnd(() => {
            isComposingRef.current = false
            onCompositionChangeRef.current?.(false)

            const pendingValue = pendingValueRef.current
            pendingValueRef.current = null

            if (pendingValue !== null) {
              emitChange(pendingValue)
            }
          }),
          editor.onDidChangeModelContent(() => {
            if (isApplyingExternalValueRef.current) {
              return
            }

            const nextValue = editor.getValue()

            if (isComposingRef.current) {
              pendingValueRef.current = nextValue
              return
            }

            pendingValueRef.current = null
            emitChange(nextValue)
          }),
        ]
      } catch (error) {
        console.error('Failed to initialize Monaco editor', error)
      }
    }

    void mountEditor()

    return () => {
      cancelled = true
      disposeEditorResources()
      pendingValueRef.current = null
      isFocusedRef.current = false
      isComposingRef.current = false
      isApplyingExternalValueRef.current = false
      onCompositionChangeRef.current?.(false)
    }
  }, [disposeEditorResources, emitChange, filePath])

  React.useEffect(() => {
    editorRef.current?.updateOptions({
      readOnly: disabled,
    })
  }, [disabled])

  React.useEffect(() => {
    monaco.editor.setTheme(monacoTheme)
  }, [monacoTheme])

  React.useEffect(() => {
    const editor = editorRef.current
    const model = modelLeaseRef.current?.modelRef.object.textEditorModel ?? editor?.getModel()

    if (!editor || !model) {
      return
    }

    const currentModelValue = model.getValue()

    if (currentModelValue === value) {
      lastForwardedValueRef.current = value
      return
    }

    if (isFocusedRef.current || isComposingRef.current) {
      return
    }

    isApplyingExternalValueRef.current = true

    try {
      editor.executeEdits('external-sync', [{
        forceMoveMarkers: true,
        range: model.getFullModelRange(),
        text: value,
      }])
      editor.pushUndoStop()
      lastForwardedValueRef.current = value
    } finally {
      isApplyingExternalValueRef.current = false
    }
  }, [isFocused, value])

  return (
    <div className='code-editor-shell'>
      <div
        ref={containerRef}
        style={{ height: '100%', width: '100%' }}
      />
    </div>
  )
}
