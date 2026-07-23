import { lazy } from 'react'
import {
  getOpenFileProfileDuration,
  recordOpenFileProfile,
} from '@/lib/open-file-profile'

export const CodeEditor = lazy(async () => {
  const startedAt = performance.now()
  recordOpenFileProfile('lazy:code-editor:start')
  const module = await import('@/features/editor/components/code-editor/code-editor')
  recordOpenFileProfile('lazy:code-editor:end', {
    durationMs: getOpenFileProfileDuration(startedAt),
  })
  return { default: module.CodeEditor }
})

export const GitDiffEditor = lazy(async () => {
  const startedAt = performance.now()
  recordOpenFileProfile('lazy:git-diff-editor:start')
  const module = await import('@/features/editor/components/git-diff-editor/git-diff-editor')
  recordOpenFileProfile('lazy:git-diff-editor:end', {
    durationMs: getOpenFileProfileDuration(startedAt),
  })
  return { default: module.GitDiffEditor }
})

let meoEditorHostModulePromise:
  Promise<typeof import('@/features/editor/components/meo-editor-host/meo-editor-host')>
  | null = null

function loadMeoEditorHostModule(reason: 'lazy' | 'startup-preload') {
  if (!meoEditorHostModulePromise) {
    const startedAt = performance.now()
    recordOpenFileProfile('lazy:meo-editor-host:start', { reason })
    meoEditorHostModulePromise = import(
      '@/features/editor/components/meo-editor-host/meo-editor-host'
    ).then((module) => {
      recordOpenFileProfile('lazy:meo-editor-host:end', {
        durationMs: getOpenFileProfileDuration(startedAt),
        reason,
      })
      return module
    })
  } else {
    recordOpenFileProfile('lazy:meo-editor-host:reuse', { reason })
  }

  return meoEditorHostModulePromise
}

if (typeof window !== 'undefined') {
  window.setTimeout(() => {
    void loadMeoEditorHostModule('startup-preload')
  }, 0)
}

export const MeoEditorHost = lazy(async () => {
  const startedAt = performance.now()
  const module = await loadMeoEditorHostModule('lazy')
  recordOpenFileProfile('lazy:meo-editor-host:lazy-resolved', {
    durationMs: getOpenFileProfileDuration(startedAt),
  })
  return { default: module.MeoEditorHost }
})
