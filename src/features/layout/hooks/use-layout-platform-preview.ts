import { useEffect } from 'react'
import { create } from 'zustand'
import { deriveShellPlatform } from '../shell-layout'

export type LayoutPlatformPreview = 'system' | 'macos' | 'macos-fullscreen' | 'windows'
const isDevelopment = import.meta.env?.DEV === true

// Development-only UI state. Never persist it or override the native platform API.
const usePreviewStore = create<{ mode: LayoutPlatformPreview }>(() => ({ mode: 'system' }))

export function useLayoutPlatformPreview() {
  const mode = usePreviewStore(state => state.mode)
  return isDevelopment ? mode : 'system'
}

export function resolveLayoutPlatformPreview(platform: string, isFullScreen: boolean, mode: LayoutPlatformPreview) {
  return {
    shellPlatform: mode === 'system' ? deriveShellPlatform(platform) : mode === 'windows' ? 'windows' as const : 'macos' as const,
    isWindowFullScreen: mode === 'system' ? isFullScreen : mode === 'macos-fullscreen',
  }
}

export function useLayoutPlatformPreviewCommand(platform: string, isFullScreen: boolean) {
  useEffect(() => {
    if (!isDevelopment) return

    const command = (mode?: LayoutPlatformPreview) => {
      if (mode !== undefined) {
        if (!['system', 'macos', 'macos-fullscreen', 'windows'].includes(mode)) {
          throw new Error('可选布局：system、macos、macos-fullscreen、windows')
        }
        usePreviewStore.setState({ mode })
      }
      const selected = usePreviewStore.getState().mode
      return { mode: selected, ...resolveLayoutPlatformPreview(platform, isFullScreen, selected) }
    }
    window.arynLayoutPreview = command
    return () => {
      if (window.arynLayoutPreview === command) delete window.arynLayoutPreview
    }
  }, [platform, isFullScreen])
}

declare global {
  interface Window {
    /** Temporary renderer layout preview, available only in the development build. */
    arynLayoutPreview?: (mode?: LayoutPlatformPreview) => ReturnType<typeof resolveLayoutPlatformPreview> & { mode: LayoutPlatformPreview }
  }
}
