import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'

export function AppTitlebar({
  isDrawerOpen = false,
  isLeftDrawerOpen = false,
  leftControls,
  onRequestClose,
}: {
  isDrawerOpen?: boolean
  isLeftDrawerOpen?: boolean
  leftControls?: ReactNode
  onRequestClose?: () => void
}) {
  const platform = window.appApi.platform
  const isMac = platform === 'darwin'
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    if (isMac) {
      return
    }

    let mounted = true

    void window.appApi.isWindowMaximized().then(({ isMaximized: nextState }) => {
      if (mounted) {
        setIsMaximized(nextState)
      }
    })

    return () => {
      mounted = false
    }
  }, [isMac])

  return (
    <header
      className={`titlebar ${isMac ? 'is-macos' : 'is-windows'}`}
      data-drawer-open={isDrawerOpen ? 'true' : 'false'}
      data-left-drawer-open={isLeftDrawerOpen ? 'true' : 'false'}
      data-react-aria-top-layer='true'
    >
      {leftControls}
      <div className='titlebar-side titlebar-side-left' />
      <div className='titlebar-spacer' />

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
              <Icon icon='material-symbols:chrome-minimize-rounded' width={16} height={16} />
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
              <Icon
                icon={isMaximized
                  ? 'material-symbols:chrome-restore-outline-rounded'
                  : 'material-symbols:chrome-maximize-outline'}
                width={16}
                height={16}
              />
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
              <Icon icon='material-symbols:close-rounded' width={16} height={16} />
            </button>
          </div>
        ) : null}
      </div>
    </header>
  )
}
