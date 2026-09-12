import { useEffect, useState, type CSSProperties } from 'react'
import { getShellChromeVars } from '../shell-layout'
import { resolveLayoutPlatformPreview, useLayoutPlatformPreview, useLayoutPlatformPreviewCommand } from './use-layout-platform-preview'

/** Native window state and development preview; workspace state belongs to the project. */
export function useWindowChrome(platform: string) {
  const [nativeFullScreen, setNativeFullScreen] = useState(false)
  const preview = useLayoutPlatformPreview()
  useLayoutPlatformPreviewCommand(platform, nativeFullScreen)

  useEffect(() => {
    let mounted = true
    let receivedEvent = false
    const unsubscribe = window.appApi.onWindowStateChanged(({ isFullScreen }) => {
      receivedEvent = true
      if (mounted) setNativeFullScreen(isFullScreen)
    })
    void window.appApi.isWindowMaximized().then(({ isFullScreen }) => {
      if (mounted && !receivedEvent) setNativeFullScreen(isFullScreen)
    })
    return () => { mounted = false; unsubscribe() }
  }, [])

  const state = resolveLayoutPlatformPreview(platform, nativeFullScreen, preview)
  return { ...state, shellChromeVars: getShellChromeVars(state.shellPlatform, { isFullScreen: state.isWindowFullScreen }) as CSSProperties }
}
