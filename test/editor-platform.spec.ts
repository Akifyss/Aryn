import { describe, expect, it } from 'vitest'
import {
  DIFF_ENGINE_OPTIONS,
  EDITOR_RUNTIME_OPTIONS,
  resolveDiffEngineChoice,
  resolveEditorRuntimeChoice,
} from '../src/features/editor/lib/editor-platform'

describe('editor platform routing', () => {
  it('keeps the stable editor runtime selectable', () => {
    const stableOption = EDITOR_RUNTIME_OPTIONS.find((option) => option.id === 'monaco-standalone')

    expect(stableOption?.isSelectable).toBe(true)
    expect(resolveEditorRuntimeChoice('monaco-standalone')).toMatchObject({
      fallbackReason: null,
      preferredId: 'monaco-standalone',
      resolvedId: 'monaco-standalone',
    })
  })

  it('falls back when a planned editor runtime is requested', () => {
    expect(resolveEditorRuntimeChoice('vscode-compat')).toMatchObject({
      preferredId: 'vscode-compat',
      resolvedId: 'monaco-standalone',
    })
  })

  it('keeps the stable diff engine selectable', () => {
    const stableOption = DIFF_ENGINE_OPTIONS.find((option) => option.id === 'codemirror-merge')

    expect(stableOption?.isSelectable).toBe(true)
    expect(resolveDiffEngineChoice('codemirror-merge')).toMatchObject({
      fallbackReason: null,
      preferredId: 'codemirror-merge',
      resolvedId: 'codemirror-merge',
    })
  })

  it('falls back when an unavailable diff engine is requested', () => {
    expect(resolveDiffEngineChoice('vscode-workbench')).toMatchObject({
      preferredId: 'vscode-workbench',
      resolvedId: 'codemirror-merge',
    })
    expect(resolveDiffEngineChoice('monaco-diff')).toMatchObject({
      preferredId: 'monaco-diff',
      resolvedId: 'codemirror-merge',
    })
  })
})
