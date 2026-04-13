import { useEffect, useState } from 'react'
import {
  CloseLine,
  FullscreenExitLine,
  FullscreenLine,
  MinimizeLine,
} from '@mingcute/react'
import { MacosWindowControls } from '@/components/macos-window-controls'

export function AppTitlebar({
  drawerSide = null,
  isDrawerOpen = false,
  onRequestClose,
}: {
  drawerSide?: 'left' | 'right' | null
  isDrawerOpen?: boolean
  onRequestClose?: () => void
}) {
  const platform = window.appApi.platform
  const isMac = platform === 'darwin'
  const isMacDrawerControlsOnly = isMac && drawerSide === 'right'
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    let mounted = true

    void window.appApi.isWindowMaximized().then(({ isMaximized: nextState }) => {
      if (mounted) {
        setIsMaximized(nextState)
      }
    })

    return () => {
      mounted = false
    }
  }, [])

  return (
    <header
      className={`titlebar ${isMac ? 'is-macos' : 'is-windows'}${isMacDrawerControlsOnly ? ' is-controls-only' : ''}`}
      data-drawer-open={isDrawerOpen ? 'true' : 'false'}
      data-react-aria-top-layer='true'
    >
      <div className='titlebar-side titlebar-side-left'>
        {isMac ? (
          <MacosWindowControls onRequestClose={onRequestClose} />
        ) : null}
      </div>

      {!isMacDrawerControlsOnly ? (
        <>
          <div className='titlebar-spacer' />

          <div className='titlebar-side titlebar-side-right'>
            {!isMac ? (
              <>
                <div className='titlebar-controls titlebar-controls-windows'>
                  <button
                    aria-label='Minimize window'
                    className='window-button'
                    type='button'
                    onClick={() => {
                      void window.appApi.minimizeWindow()
                    }}
                  >
                    <MinimizeLine size={16} />
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
                    {isMaximized ? <FullscreenExitLine size={16} /> : <FullscreenLine size={16} />}
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
                    <CloseLine size={18} />
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </header>
  )
}
