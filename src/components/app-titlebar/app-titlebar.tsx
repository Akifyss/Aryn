import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { CloseLine, MinimizeLine, RestoreLine, SquareLine } from '@mingcute/react'
import { resolveLayoutPlatformPreview, useLayoutPlatformPreview } from '@/features/layout/hooks/use-layout-platform-preview'

export function AppTitlebar({
  leftControls,
  onRequestClose,
}: {
  leftControls?: ReactNode
  onRequestClose?: () => void
}) {
  const platform = window.appApi.platform
  const platformPreview = useLayoutPlatformPreview()
  const isMac = resolveLayoutPlatformPreview(platform, false, platformPreview).shellPlatform === 'macos'
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    if (isMac) {
      return
    }

    let mounted = true
    const unsubscribe = window.appApi.onWindowStateChanged(({ isMaximized: nextState }) => {
      setIsMaximized(nextState)
    })

    void window.appApi.isWindowMaximized().then(({ isMaximized: nextState }) => {
      if (mounted) {
        setIsMaximized(nextState)
      }
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [isMac])

  return (
    <header
      className={`titlebar ${isMac ? 'is-macos' : 'is-windows'}`}
      data-react-aria-top-layer='true'
      data-platform-preview={platformPreview === 'system' ? undefined : platformPreview}
    >
      {leftControls}
      <div className='titlebar-side titlebar-side-left'>
        {platform !== 'darwin' && platformPreview === 'macos' ? (
          <span className='titlebar-preview-traffic-lights' role='img' aria-label='macOS 红绿灯占位（布局预览）'>
            <span /><span /><span />
          </span>
        ) : null}
      </div>

      <div className='titlebar-side titlebar-side-right'>
        {!isMac ? (
          <div className='titlebar-controls titlebar-controls-windows'>
            <button
              aria-label='Minimize window'
              className='window-button'
              type='button'
              onClick={() => {
                void window.appApi.minimizeWindow()
              }}
            >
              <MinimizeLine aria-hidden='true' />
            </button>
            <button
              aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
              className='window-button'
              type='button'
              onClick={() => {
                void window.appApi.toggleMaximizeWindow().then(({ isMaximized: nextState }) => {
                  setIsMaximized(nextState)
                })
              }}
            >
              {isMaximized
                ? <RestoreLine aria-hidden='true' />
                : <SquareLine aria-hidden='true' />}
            </button>
            <button
              aria-label='Close window'
              className='window-button window-button-close'
              type='button'
              onClick={() => {
                if (onRequestClose) {
                  onRequestClose()
                  return
                }

                void window.appApi.closeWindow()
              }}
            >
              <CloseLine aria-hidden='true' />
            </button>
          </div>
        ) : null}
      </div>
    </header>
  )
}
