import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

type MonacoEnvironmentShape = {
  getWorker: (_moduleId: string, label: string) => Worker
}

let isMonacoConfigured = false

export type MonacoEditorOptions = monaco.editor.IStandaloneEditorConstructionOptions
export type MonacoDiffEditorOptions = monaco.editor.IDiffEditorConstructionOptions
export { Editor }

export function configureMonaco() {
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
