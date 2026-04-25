import { useEffect, useMemo, useRef } from 'react'
import type { GitChangeItem, GitDiffBlockAction, GitDiffSelection, GitRepositoryState } from '@/features/git/types'
import type { MeoSettings } from '@/hooks/use-settings-store'
import { createDefaultMeoHostEnvironment } from '@/features/editor/lib/meo-host-environment'
import { getGitStateRefreshKey, getUnavailableGitBaseline } from '@/features/editor/lib/meo-git-state'
import { mountNativeMeoEditor } from '@/features/editor/lib/meo-native-editor'
import '@/vendor/meo/webview/styles.css'
import 'katex/dist/katex.min.css'

type MeoEditorHostProps = {
  filePath: string
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

export function MeoEditorHost({
  filePath,
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
}: MeoEditorHostProps) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const controllerRef = useRef<MountedNativeMeo | null>(null)
  const contentRef = useRef(value)
  const pendingExternalValueRef = useRef<string | null>(null)
  const isComposingRef = useRef(false)
  const onChangeRef = useRef(onChange)
  const onCompositionChangeRef = useRef(onCompositionChange)
  const onOpenFileRef = useRef(onOpenFile)
  const onOpenGitDiffRef = useRef(onOpenGitDiff)
  const onApplyGitDiffSelectionRef = useRef(onApplyGitDiffSelection)
  const onSaveRef = useRef(onSave)
  const environment = useMemo(() => createDefaultMeoHostEnvironment(), [])
  const gitStateRefreshKey = useMemo(() => getGitStateRefreshKey(gitRepositoryState), [gitRepositoryState])
  const gitChangeContext = useMemo(() => ({
    stagedChange: findGitChangeForFile(gitRepositoryState?.stagedChanges, filePath),
    unstagedChange: findGitChangeForFile(gitRepositoryState?.unstagedChanges, filePath),
  }), [filePath, gitStateRefreshKey, gitRepositoryState])

  useEffect(() => {
    onChangeRef.current = onChange
    onCompositionChangeRef.current = onCompositionChange
    onOpenFileRef.current = onOpenFile
    onOpenGitDiffRef.current = onOpenGitDiff
    onApplyGitDiffSelectionRef.current = onApplyGitDiffSelection
    onSaveRef.current = onSave
  }, [onChange, onCompositionChange, onOpenFile, onOpenGitDiff, onApplyGitDiffSelection, onSave])

  useEffect(() => {
    const rootElement = rootRef.current
    if (!rootElement) {
      return
    }

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

    controllerRef.current = controller
    contentRef.current = value

    return () => {
      pendingExternalValueRef.current = null
      isComposingRef.current = false
      onCompositionChangeRef.current?.(false)
      controller.destroy()
      controllerRef.current = null
    }
  }, [environment, filePath, meoSettings.imageFolder, meoSettings.rememberPositionLines, workspacePath])

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
    controllerRef.current?.setSavedText(savedValue)
  }, [savedValue])

  useEffect(() => {
    controllerRef.current?.setGitChangeContext(gitChangeContext)
  }, [gitChangeContext])

  useEffect(() => {
    controllerRef.current?.setGitDiffLineHighlightsEnabled(meoSettings.gitDiffLineHighlights)
  }, [meoSettings.gitDiffLineHighlights])

  useEffect(() => {
    controllerRef.current?.setOutlinePosition(meoSettings.outlinePosition)
  }, [meoSettings.outlinePosition])

  useEffect(() => {
    const shellElement = shellRef.current
    if (!shellElement) {
      return
    }

    const applyResolvedTheme = () => {
      const resolvedTheme = resolvePreferredTheme(theme)
      shellElement.classList.add('meo-native-theme')
      shellElement.classList.toggle('light', resolvedTheme === 'light')
      shellElement.classList.toggle('dark', resolvedTheme === 'dark')
      shellElement.dataset.theme = resolvedTheme
      controllerRef.current?.refreshLayout()
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

    if (!workspacePath) {
      controller.setGitBaseline(getUnavailableGitBaseline('not-repo'))
      return
    }

    void environment.appApi.getGitBaseline(workspacePath, filePath)
      .then((baseline) => {
        if (!disposed) {
          controller.setGitBaseline(baseline)
        }
      })
      .catch(() => {
        if (!disposed) {
          controller.setGitBaseline(getUnavailableGitBaseline('error'))
        }
      })

    return () => {
      disposed = true
    }
  }, [environment, filePath, gitStateRefreshKey, workspacePath])

  return (
    <div ref={shellRef} className='meo-editor-shell'>
      <div ref={rootRef} className='meo-editor-root-host' />
    </div>
  )
}
