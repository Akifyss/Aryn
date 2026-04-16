import * as React from 'react'
import * as monaco from 'monaco-editor'
import { getCodeLanguage } from '@/features/workspace/lib/file-types'
import {
  Editor,
  configureMonaco,
  resolveMonacoTheme,
  type MonacoEditorOptions,
  type MonacoThemePreference,
} from '@/features/editor/lib/monaco'

export type CodeEditorProps = {
  disabled?: boolean
  filePath: string
  onCompositionChange?: (isComposing: boolean) => void
  onSave?: (nextValue: string) => void
  value: string
  onChange: (nextValue: string) => void
  theme?: MonacoThemePreference
}

configureMonaco()

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
  theme = "auto",
}: CodeEditorProps) {
  const monacoTheme = React.useMemo(() => resolveMonacoTheme(theme), [theme])
  const editorRef = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
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

  React.useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  React.useEffect(() => {
    onCompositionChangeRef.current = onCompositionChange
  }, [onCompositionChange])

  React.useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  const handleMount = React.useCallback<NonNullable<React.ComponentProps<typeof Editor>['onMount']>>((editor, monacoInstance) => {
    disposablesRef.current.forEach((disposable) => {
      disposable.dispose()
    })
    disposablesRef.current = []
    editorRef.current = editor

    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
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
  }, [emitChange])

  React.useEffect(() => {
    const editor = editorRef.current
    const model = editor?.getModel()

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

  React.useEffect(() => () => {
    disposablesRef.current.forEach((disposable) => {
      disposable.dispose()
    })
    disposablesRef.current = []
    editorRef.current = null
    pendingValueRef.current = null
    isFocusedRef.current = false
    isComposingRef.current = false
    isApplyingExternalValueRef.current = false
    onCompositionChangeRef.current?.(false)
  }, [])

  return (
    <div className='code-editor-shell'>
      <Editor
        defaultValue={value}
        height='100%'
        language={getCodeLanguage(filePath)}
        onMount={handleMount}
        options={{
          ...DEFAULT_EDITOR_OPTIONS,
          readOnly: disabled,
        }}
        path={filePath}
        theme={monacoTheme}
      />
    </div>
  )
}
