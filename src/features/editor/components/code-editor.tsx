import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { getCodeLanguage } from '@/features/workspace/lib/file-types'

type MonacoEnvironmentShape = {
  getWorker: (_moduleId: string, label: string) => Worker
}

type CodeEditorProps = {
  disabled?: boolean
  filePath: string
  value: string
  onChange: (nextValue: string) => void
}

let isMonacoConfigured = false

function configureMonaco() {
  if (isMonacoConfigured) {
    return
  }

  loader.config({ monaco })

  ;(self as typeof self & { MonacoEnvironment?: MonacoEnvironmentShape }).MonacoEnvironment = {
    getWorker(_, label) {
      switch (label) {
        case 'json':
          return new jsonWorker()
        case 'css':
        case 'scss':
        case 'less':
          return new cssWorker()
        case 'html':
        case 'handlebars':
        case 'razor':
          return new htmlWorker()
        case 'typescript':
        case 'javascript':
          return new tsWorker()
        default:
          return new editorWorker()
      }
    },
  }

  isMonacoConfigured = true
}

configureMonaco()

const DEFAULT_EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
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
  onChange,
  value,
}: CodeEditorProps) {
  return (
    <div className='code-editor-shell'>
      <Editor
        height='100%'
        language={getCodeLanguage(filePath)}
        options={{
          ...DEFAULT_EDITOR_OPTIONS,
          readOnly: disabled,
        }}
        path={filePath}
        theme='vs'
        value={value}
        onChange={(nextValue) => {
          onChange(nextValue ?? '')
        }}
      />
    </div>
  )
}
