import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  WorkspaceIconThemeCatalogOption,
  WorkspaceIconThemeMode,
  WorkspaceIconThemeSelection,
  WorkspaceIconThemesByMode,
} from '@/features/workspace/types'
import type { AppTheme } from '@/hooks/use-settings-store'

export type ResolvedAppTheme = 'light' | 'dark'

type WindowAppearanceTheme = ResolvedAppTheme | 'system'

type UseAppAppearanceControllerOptions = {
  platform: NodeJS.Platform
  theme: AppTheme
  onStatusMessage: (message: string) => void
}

function createEmptyWorkspaceIconThemes(): WorkspaceIconThemesByMode {
  return {
    dark: null,
    light: null,
  }
}

function resolveAppTheme(theme: AppTheme): ResolvedAppTheme {
  if (theme !== 'auto') {
    return theme
  }

  if (typeof window === 'undefined') {
    return 'light'
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useAppAppearanceController({
  platform,
  theme,
  onStatusMessage,
}: UseAppAppearanceControllerOptions) {
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedAppTheme>(() => resolveAppTheme(theme))
  const [isApplyingIconTheme, setIsApplyingIconTheme] = useState(false)
  const [iconThemes, setIconThemes] = useState<WorkspaceIconThemesByMode>(createEmptyWorkspaceIconThemes)
  const [iconThemeOptions, setIconThemeOptions] = useState<WorkspaceIconThemeCatalogOption[]>([])
  const iconTheme = useMemo(() => iconThemes[resolvedTheme], [iconThemes, resolvedTheme])

  useEffect(() => {
    const applyDocumentTheme = (nextTheme: ResolvedAppTheme) => {
      const body = window.document.body
      const root = window.document.documentElement

      setResolvedTheme(nextTheme)
      root.classList.remove('light', 'dark')
      root.classList.add(nextTheme)
      root.setAttribute('data-theme', nextTheme)
      body.classList.remove('light', 'dark')
      body.classList.add(nextTheme)

      const meta = window.document.querySelector('meta[name="theme-color"]')
      meta?.setAttribute('content', nextTheme === 'dark' ? '#0a0a0b' : '#ffffff')
    }

    const applyTheme = (
      nextTheme: ResolvedAppTheme,
      appearanceTheme: WindowAppearanceTheme = nextTheme,
    ) => {
      applyDocumentTheme(nextTheme)
      void window.appApi.setWindowTheme({
        appearanceTheme,
        backgroundTheme: nextTheme,
      })
    }

    if (theme === 'auto') {
      if (platform !== 'darwin') {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
        applyTheme(mediaQuery.matches ? 'dark' : 'light', 'system')

        const handleChange = (event: MediaQueryListEvent) => {
          applyTheme(event.matches ? 'dark' : 'light', 'system')
        }
        mediaQuery.addEventListener('change', handleChange)
        return () => mediaQuery.removeEventListener('change', handleChange)
      }

      let disposed = false
      const unsubscribeWindowTheme = window.appApi.onWindowThemeChanged(({ resolvedTheme: nextTheme }) => {
        applyDocumentTheme(nextTheme)
      })

      void window.appApi.setWindowTheme({ appearanceTheme: 'system' }).then(
        ({ resolvedTheme: nextTheme }) => {
          if (!disposed) {
            applyDocumentTheme(nextTheme ?? resolveAppTheme('auto'))
          }
        },
        () => {
          if (!disposed) {
            applyDocumentTheme(resolveAppTheme('auto'))
          }
        },
      )

      return () => {
        disposed = true
        unsubscribeWindowTheme()
      }
    }

    applyTheme(theme)
  }, [platform, theme])

  const hydrateWorkspaceIconThemes = useCallback(async (isCancelled: () => boolean) => {
    try {
      const [lightIconTheme, darkIconTheme, catalog] = await Promise.all([
        window.appApi.getWorkspaceIconTheme('light'),
        window.appApi.getWorkspaceIconTheme('dark'),
        window.appApi.getWorkspaceIconThemeCatalog(),
      ])

      if (!isCancelled()) {
        setIconThemes({
          dark: darkIconTheme,
          light: lightIconTheme,
        })
        setIconThemeOptions(catalog)
      }
    } catch {
      if (!isCancelled()) {
        setIconThemes(createEmptyWorkspaceIconThemes())
        setIconThemeOptions([])
      }
    }
  }, [])

  const selectWorkspaceIconTheme = useCallback(async (
    mode: WorkspaceIconThemeMode,
    selection: WorkspaceIconThemeSelection,
  ) => {
    const currentIconTheme = iconThemes[mode]
    const isDefaultSelection = !selection.themeId && !selection.sourceVsixPath

    if (
      !isDefaultSelection
      && currentIconTheme?.activeThemeId === selection.themeId
      && currentIconTheme.sourceVsixPath === selection.sourceVsixPath
    ) {
      return
    }

    try {
      setIsApplyingIconTheme(true)
      const nextIconTheme = await window.appApi.setWorkspaceIconTheme(mode, selection)

      setIconThemes((currentValue) => ({
        ...currentValue,
        [mode]: nextIconTheme,
      }))
      setIconThemeOptions(await window.appApi.getWorkspaceIconThemeCatalog())
      onStatusMessage(nextIconTheme
        ? `${nextIconTheme.extensionLabel}: ${nextIconTheme.activeThemeLabel}`
        : '文件图标主题：默认')
    } catch (error) {
      onStatusMessage(error instanceof Error ? error.message : 'Unable to switch the icon theme.')
    } finally {
      setIsApplyingIconTheme(false)
    }
  }, [iconThemes, onStatusMessage])

  return {
    hydrateWorkspaceIconThemes,
    iconTheme,
    iconThemeOptions,
    iconThemes,
    isApplyingIconTheme,
    resolvedTheme,
    selectWorkspaceIconTheme,
  }
}
