import type { editor } from 'monaco-editor'
import type { EditorState as DiffEditorState } from '@pierre/diffs'
import type { MeoEditorMode, MeoEditorViewportPosition } from './meo-native-editor-types'

// A transient handoff between mounted editors; never serialized into layout.
export type EditorViewState =
  | { kind: 'meo'; mode: MeoEditorMode; ranges: { anchor: number; head: number }[];
      mainIndex: number; position: MeoEditorViewportPosition | null }
  | { kind: 'code'; view: editor.ICodeEditorViewState }
  | { kind: 'diff'; view: DiffEditorState | null; scrollTop: number; scrollLeft: number }

export type EditorViewHandle = {
  capture: () => EditorViewState | null
  restore: (state: EditorViewState) => void
  focus: () => void
}
