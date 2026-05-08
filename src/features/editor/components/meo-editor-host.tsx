import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GitChangeItem, GitDiffBlockAction, GitDiffSelection, GitRepositoryState } from '@/features/git/types'
import type { WorkspaceFileGitDiffRequest } from '@/features/workspace/store/use-workspace-store'
import type { MeoSettings } from '@/hooks/use-settings-store'
import { createDefaultMeoHostEnvironment } from '@/features/editor/lib/meo-host-environment'
import { getGitStateRefreshKey, getUnavailableGitBaseline } from '@/features/editor/lib/meo-git-state'
import { mountNativeMeoEditor } from '@/features/editor/lib/meo-native-editor'
import { getOpenFileProfileDuration, recordOpenFileProfile } from '@/lib/open-file-profile'
import '@/vendor/meo/webview/styles.css'
import 'katex/dist/katex.min.css'

type MeoEditorHostProps = {
  filePath: string
  gitDiffRequest?: WorkspaceFileGitDiffRequest | null
  gitRepositoryState?: GitRepositoryState | null
  meoSettings: MeoSettings
  onCompositionChange?: (isComposing: boolean) => void
  onOpenFile?: (filePath: string) => void
  onOpenGitDiff?: (
    filePath: string,
    options?: {
      lineNumber?: number
      source: 'revision' | 'worktree'
    },
  ) => void
  onApplyGitDiffSelection?: (change: GitChangeItem, selection: GitDiffSelection, action: GitDiffBlockAction) => Promise<void>
  onSave?: (nextValue: string) => void
  onChange: (nextValue: string) => void
  savedValue: string
  theme?: 'light' | 'dark' | 'auto'
  value: string
  workspacePath?: string | null
}

type MountedNativeMeo = ReturnType<typeof mountNativeMeoEditor>

export type MeoEditorHostHandle = {
  captureViewPosition: () => void
}

type GitBaselineFetchState = {
  gitStateRefreshKey: string
  requestKey: string
  status: 'pending' | 'ready'
}

const LONG_DOCUMENT_BASELINE_DELAY_CHARS = 12_000
const LONG_DOCUMENT_BASELINE_DELAY_MS = 1_400

function resolvePreferredTheme(theme: 'light' | 'dark' | 'auto') {
  if (theme !== 'auto') {
    return theme
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function normalizeFsPath(filePath: string) {
  return filePath.replace(/[\\/]+/g, '/').toLowerCase()
}

function findGitChangeForFile(changes: GitChangeItem[] | undefined, filePath: string) {
  const normalizedFilePath = normalizeFsPath(filePath)
  return changes?.find((change) => normalizeFsPath(change.path) === normalizedFilePath) ?? null
}

export const MeoEditorHost = forwardRef<MeoEditorHostHandle, MeoEditorHostProps>(function MeoEditorHost({
  filePath,
  gitDiffRequest = null,
  gitRepositoryState,
  meoSettings,
  onCompositionChange,
  onOpenFile,
  onOpenGitDiff,
  onApplyGitDiffSelection,
  onSave,
  onChange,
  savedValue,
  theme = 'auto',
  value,
  workspacePath,
}, forwardedRef) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const controllerRef = useRef<MountedNativeMeo | null>(null)
  const contentRef = useRef(value)
  const isGitBaselineReadyRef = useRef(false)
  const lastHandledGitDiffRequestKeyRef = useRef<string | null>(null)
  const lastGitBaselineFetchRef = useRef<GitBaselineFetchState | null>(null)
  const pendingExternalValueRef = useRef<string | null>(null)
  const isComposingRef = useRef(false)
  const appliedFocusedLineHighlightRef = useRef(meoSettings.focusedLineHighlight)
  const appliedGitDiffLineHighlightsRef = useRef(meoSettings.gitDiffLineHighlights)
  const appliedOutlinePositionRef = useRef(meoSettings.outlinePosition)
  const appliedSavedValueRef = useRef(savedValue)
  const onChangeRef = useRef(onChange)
  const onCompositionChangeRef = useRef(onCompositionChange)
  const onOpenFileRef = useRef(onOpenFile)
  const onOpenGitDiffRef = useRef(onOpenGitDiff)
  const onApplyGitDiffSelectionRef = useRef(onApplyGitDiffSelection)
  const onSaveRef = useRef(onSave)
  const environment = useMemo(() => createDefaultMeoHostEnvironment(), [])
  const resolvedTheme = useMemo(() => resolvePreferredTheme(theme), [theme])
  const [gitBaselineVersion, setGitBaselineVersion] = useState(0)
  const gitStateRefreshKey = useMemo(() => getGitStateRefreshKey(gitRepositoryState), [gitRepositoryState])
  const gitChangeContext = useMemo(() => ({
    stagedChange: findGitChangeForFile(gitRepositoryState?.stagedChanges, filePath),
    unstagedChange: findGitChangeForFile(gitRepositoryState?.unstagedChanges, filePath),
  }), [filePath, gitStateRefreshKey, gitRepositoryState])
  const appliedGitChangeContextRef = useRef(gitChangeContext)

  useImperativeHandle(forwardedRef, () => ({
    captureViewPosition() {
      controllerRef.current?.captureViewPosition()
    },
  }), [])

  useEffect(() => {
    onChangeRef.current = onChange
    onCompositionChangeRef.current = onCompositionChange
    onOpenFileRef.current = onOpenFile
    onOpenGitDiffRef.current = onOpenGitDiff
    onApplyGitDiffSelectionRef.current = onApplyGitDiffSelection
    onSaveRef.current = onSave
  }, [onChange, onCompositionChange, onOpenFile, onOpenGitDiff, onApplyGitDiffSelection, onSave])

  useLayoutEffect(() => {
    const rootElement = rootRef.current
    if (!rootElement) {
      return
    }

    const mountStartedAt = performance.now()
    recordOpenFileProfile('meo-host:layout-effect:start', {
      filePath,
      valueChars: value.length,
      workspacePath: workspacePath ?? null,
    })
    const controller = mountNativeMeoEditor({
      environment,
      filePath,
      gitChangeContext,
      initialValue: value,
      meoSettings,
      onChange: (nextValue) => {
        contentRef.current = nextValue
        onChangeRef.current(nextValue)
      },
      onCompositionChange: (nextValue) => {
        isComposingRef.current = nextValue
        onCompositionChangeRef.current?.(nextValue)

        if (!nextValue && pendingExternalValueRef.current !== null) {
          const pendingValue = pendingExternalValueRef.current
          pendingExternalValueRef.current = null
          contentRef.current = pendingValue
          controller.setText(pendingValue)
        }
      },
      onOpenFile: (nextFilePath) => {
        onOpenFileRef.current?.(nextFilePath)
      },
      onOpenGitDiff: (nextFilePath, options) => {
        onOpenGitDiffRef.current?.(nextFilePath, options)
      },
      onApplyGitDiffSelection: async (change, selection, action) => {
        await onApplyGitDiffSelectionRef.current?.(change, selection, action)
      },
      onSave: (nextValue) => {
        onSaveRef.current?.(nextValue)
      },
      root: rootElement,
      savedValue,
      workspacePath,
    })
    recordOpenFileProfile('meo-host:mount-native:end', {
      durationMs: getOpenFileProfileDuration(mountStartedAt),
      filePath,
    })

    controllerRef.current = controller
    contentRef.current = value
    appliedFocusedLineHighlightRef.current = meoSettings.focusedLineHighlight
    appliedGitChangeContextRef.current = gitChangeContext
    appliedGitDiffLineHighlightsRef.current = meoSettings.gitDiffLineHighlights
    appliedOutlinePositionRef.current = meoSettings.outlinePosition
    appliedSavedValueRef.current = savedValue
    recordOpenFileProfile('meo-host:controller-ready', {
      elapsedMs: getOpenFileProfileDuration(mountStartedAt),
      filePath,
    })

    return () => {
      recordOpenFileProfile('meo-host:cleanup:start', { filePath })
      pendingExternalValueRef.current = null
      isComposingRef.current = false
      onCompositionChangeRef.current?.(false)
      controller.destroy()
      controllerRef.current = null
      recordOpenFileProfile('meo-host:cleanup:end', { filePath })
    }
  }, [environment, filePath, meoSettings.imageFolder, workspacePath])

  useEffect(() => {
    const controller = controllerRef.current
    if (!controller) {
      contentRef.current = value
      return
    }

    if (value === contentRef.current) {
      return
    }

    if (isComposingRef.current) {
      pendingExternalValueRef.current = value
      return
    }

    pendingExternalValueRef.current = null
    contentRef.current = value
    controller.setText(value)
  }, [value])

  useEffect(() => {
    if (appliedSavedValueRef.current === savedValue) {
      return
    }

    appliedSavedValueRef.current = savedValue
    controllerRef.current?.setSavedText(savedValue)
  }, [savedValue])

  useEffect(() => {
    if (appliedGitChangeContextRef.current === gitChangeContext) {
      return
    }

    appliedGitChangeContextRef.current = gitChangeContext
    controllerRef.current?.setGitChangeContext(gitChangeContext)
  }, [gitChangeContext])

  useEffect(() => {
    if (appliedGitDiffLineHighlightsRef.current === meoSettings.gitDiffLineHighlights) {
      return
    }

    appliedGitDiffLineHighlightsRef.current = meoSettings.gitDiffLineHighlights
    controllerRef.current?.setGitDiffLineHighlightsEnabled(meoSettings.gitDiffLineHighlights)
  }, [meoSettings.gitDiffLineHighlights])

  useEffect(() => {
    if (appliedFocusedLineHighlightRef.current === meoSettings.focusedLineHighlight) {
      return
    }

    appliedFocusedLineHighlightRef.current = meoSettings.focusedLineHighlight
    controllerRef.current?.setFocusedLineHighlightVisible(meoSettings.focusedLineHighlight)
  }, [meoSettings.focusedLineHighlight])

  useEffect(() => {
    if (appliedOutlinePositionRef.current === meoSettings.outlinePosition) {
      return
    }

    appliedOutlinePositionRef.current = meoSettings.outlinePosition
    controllerRef.current?.setOutlinePosition(meoSettings.outlinePosition)
  }, [meoSettings.outlinePosition])

  useEffect(() => {
    const controller = controllerRef.current

    if (
      !controller
      || !gitDiffRequest
      || !isGitBaselineReadyRef.current
      || lastHandledGitDiffRequestKeyRef.current === gitDiffRequest.requestKey
    ) {
      return
    }

    controller.openGitDiff({
      lineNumber: gitDiffRequest.lineNumber,
      mode: gitDiffRequest.mode,
      scope: gitDiffRequest.scope,
    })
    lastHandledGitDiffRequestKeyRef.current = gitDiffRequest.requestKey
  }, [gitBaselineVersion, gitDiffRequest])

  useEffect(() => {
    const shellElement = shellRef.current
    if (!shellElement) {
      return
    }

    const applyResolvedTheme = () => {
      const nextResolvedTheme = resolvePreferredTheme(theme)
      const previousTheme = shellElement.dataset.theme
      shellElement.classList.add('meo-native-theme')
      shellElement.classList.toggle('light', nextResolvedTheme === 'light')
      shellElement.classList.toggle('dark', nextResolvedTheme === 'dark')
      shellElement.dataset.theme = nextResolvedTheme
      if (previousTheme && previousTheme !== nextResolvedTheme) {
        controllerRef.current?.refreshLayout()
      }
    }

    applyResolvedTheme()

    if (theme !== 'auto') {
      return
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', applyResolvedTheme)

    return () => {
      mediaQuery.removeEventListener('change', applyResolvedTheme)
    }
  }, [theme])

  useEffect(() => {
    const controller = controllerRef.current
    if (!controller) {
      return
    }

    let disposed = false

    const markGitBaselineReady = () => {
      if (disposed) {
        return
      }

      isGitBaselineReadyRef.current = true
      setGitBaselineVersion((version) => version + 1)
    }

    const requestKey = `${workspacePath ?? ''}\0${filePath}`
    const previousFetch = lastGitBaselineFetchRef.current
    if (
      previousFetch?.requestKey === requestKey
      && previousFetch.status === 'ready'
      && previousFetch.gitStateRefreshKey === 'no-state'
      && gitStateRefreshKey !== 'no-state'
    ) {
      markGitBaselineReady()
      recordOpenFileProfile('meo-host:git-baseline:skip', {
        filePath,
        reason: 'startup-git-state-hydration',
        workspacePath: workspacePath ?? null,
      })
      return
    }

    isGitBaselineReadyRef.current = false

    if (!workspacePath) {
      controller.setGitBaseline(getUnavailableGitBaseline('not-repo'))
      markGitBaselineReady()
      recordOpenFileProfile('meo-host:git-baseline:skip', { filePath, reason: 'no-workspace' })
      return
    }

    let baselineDelayTimer = 0
    const startBaselineRequest = () => {
      baselineDelayTimer = 0
      if (disposed) {
        return
      }

      const baselineStartedAt = performance.now()
      lastGitBaselineFetchRef.current = {
        gitStateRefreshKey,
        requestKey,
        status: 'pending',
      }
      recordOpenFileProfile('meo-host:git-baseline:start', { filePath, workspacePath })
      void environment.appApi.getGitBaseline(workspacePath, filePath)
        .then((baseline) => {
          if (!disposed) {
            controller.setGitBaseline(baseline)
            lastGitBaselineFetchRef.current = {
              gitStateRefreshKey,
              requestKey,
              status: 'ready',
            }
            markGitBaselineReady()
            recordOpenFileProfile('meo-host:git-baseline:end', {
              available: baseline.available,
              durationMs: getOpenFileProfileDuration(baselineStartedAt),
              filePath,
              reason: baseline.reason ?? null,
              tracked: baseline.tracked,
            })
          }
        })
        .catch(() => {
          if (!disposed) {
            controller.setGitBaseline(getUnavailableGitBaseline('error'))
            lastGitBaselineFetchRef.current = {
              gitStateRefreshKey,
              requestKey,
              status: 'ready',
            }
            markGitBaselineReady()
            recordOpenFileProfile('meo-host:git-baseline:end', {
              durationMs: getOpenFileProfileDuration(baselineStartedAt),
              filePath,
              kind: 'error',
            })
          }
        })
    }

    const baselineDelayMs = value.length >= LONG_DOCUMENT_BASELINE_DELAY_CHARS
      ? LONG_DOCUMENT_BASELINE_DELAY_MS
      : 0
    if (baselineDelayMs > 0) {
      recordOpenFileProfile('meo-host:git-baseline:scheduled', {
        delayMs: baselineDelayMs,
        filePath,
        valueChars: value.length,
        workspacePath,
      })
      baselineDelayTimer = window.setTimeout(startBaselineRequest, baselineDelayMs)
    } else {
      startBaselineRequest()
    }

    return () => {
      disposed = true
      if (baselineDelayTimer) {
        window.clearTimeout(baselineDelayTimer)
      }
      isGitBaselineReadyRef.current = false
    }
  }, [environment, filePath, gitStateRefreshKey, value.length, workspacePath])

  return (
    <div
      ref={shellRef}
      className={`meo-editor-shell meo-native-theme ${resolvedTheme}`}
      data-theme={resolvedTheme}
    >
      <div ref={rootRef} className='meo-editor-root-host' />
    </div>
  )
})
