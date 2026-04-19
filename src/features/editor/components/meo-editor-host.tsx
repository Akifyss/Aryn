import { useEffect, useMemo, useRef } from 'react'
import type { GitRepositoryState } from '@/features/git/types'
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
  onSave?: (nextValue: string) => void
  onChange: (nextValue: string) => void
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

export function MeoEditorHost({
  filePath,
  gitRepositoryState,
  meoSettings,
  onCompositionChange,
  onOpenFile,
  onOpenGitDiff,
  onSave,
  onChange,
  theme = 'auto',
  value,
  workspacePath,
}: MeoEditorHostProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const controllerRef = useRef<MountedNativeMeo | null>(null)
  const contentRef = useRef(value)
  const pendingExternalValueRef = useRef<string | null>(null)
  const isComposingRef = useRef(false)
  const onChangeRef = useRef(onChange)
  const onCompositionChangeRef = useRef(onCompositionChange)
  const onOpenFileRef = useRef(onOpenFile)
  const onOpenGitDiffRef = useRef(onOpenGitDiff)
  const onSaveRef = useRef(onSave)
  const environment = useMemo(() => createDefaultMeoHostEnvironment(), [])
  const preferredTheme = useMemo(() => resolvePreferredTheme(theme), [theme])
  const gitStateRefreshKey = useMemo(() => getGitStateRefreshKey(gitRepositoryState), [gitRepositoryState])

  useEffect(() => {
    onChangeRef.current = onChange
    onCompositionChangeRef.current = onCompositionChange
    onOpenFileRef.current = onOpenFile
    onOpenGitDiffRef.current = onOpenGitDiff
    onSaveRef.current = onSave
  }, [onChange, onCompositionChange, onOpenFile, onOpenGitDiff, onSave])

  useEffect(() => {
    const rootElement = rootRef.current
    if (!rootElement) {
      return
    }

    const controller = mountNativeMeoEditor({
      environment,
      filePath,
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
      onSave: (nextValue) => {
        onSaveRef.current?.(nextValue)
      },
      root: rootElement,
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
    controllerRef.current?.setGitDiffLineHighlightsEnabled(meoSettings.gitDiffLineHighlights)
  }, [meoSettings.gitDiffLineHighlights])

  useEffect(() => {
    controllerRef.current?.setOutlinePosition(meoSettings.outlinePosition)
  }, [meoSettings.outlinePosition])

  useEffect(() => {
    const rootElement = document.documentElement
    rootElement.classList.add('meo-native-theme')
    controllerRef.current?.refreshLayout()

    if (theme !== 'auto') {
      return () => {
        rootElement.classList.remove('meo-native-theme')
      }
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      controllerRef.current?.refreshLayout()
    }
    mediaQuery.addEventListener('change', handleChange)

    return () => {
      mediaQuery.removeEventListener('change', handleChange)
      rootElement.classList.remove('meo-native-theme')
    }
  }, [preferredTheme, theme])

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
    <div className='meo-editor-shell'>
      <div ref={rootRef} className='meo-editor-root-host' />
    </div>
  )
}
