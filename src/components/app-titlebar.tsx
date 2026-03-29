import { useEffect, useState } from 'react'
import {
  CloseLine,
  FullscreenExitLine,
  FullscreenLine,
  MinimizeLine,
} from '@mingcute/react'

export function AppTitlebar() {
  const platform = window.appApi.platform
  const isMac = platform === 'darwin'
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
    <header className={`titlebar ${isMac ? 'is-macos' : 'is-windows'}`}>
      <div className={`titlebar-controls ${isMac ? 'titlebar-controls-macos' : 'titlebar-controls-windows'}`}>
        {isMac ? (
          <>
            <button
              aria-label='Close window'
              className='traffic-button traffic-close'
              type='button'
              onClick={() => {
                void window.appApi.closeWindow()
              }}
            />
            <button
              aria-label='Minimize window'
              className='traffic-button traffic-minimize'
              type='button'
              onClick={() => {
                void window.appApi.minimizeWindow()
              }}
            />
            <button
              aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
              className='traffic-button traffic-maximize'
              type='button'
              onClick={() => {
                void window.appApi.toggleMaximizeWindow().then(({ isMaximized: nextState }) => {
                  setIsMaximized(nextState)
                })
              }}
            />
          </>
        ) : (
          <>
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
                void window.appApi.closeWindow()
              }}
            >
              <CloseLine size={18} />
            </button>
          </>
        )}
      </div>
    </header>
  )
}
