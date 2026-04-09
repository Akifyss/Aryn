import * as React from 'react'
import { getCodeLanguage } from '@/features/workspace/lib/file-types'
import {
  Editor,
  configureMonaco,
  resolveMonacoTheme,
  type MonacoEditorOptions,
  type MonacoThemePreference,
} from '@/features/editor/lib/monaco'

type CodeEditorProps = {
  disabled?: boolean
  filePath: string
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
  onChange,
  value,
  theme = "auto",
}: CodeEditorProps) {
  const monacoTheme = React.useMemo(() => resolveMonacoTheme(theme), [theme])

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
        theme={monacoTheme}
        value={value}
        onChange={(nextValue) => {
          onChange(nextValue ?? '')
        }}
      />
    </div>
  )
}
