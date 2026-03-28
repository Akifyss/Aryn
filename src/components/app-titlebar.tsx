import { useEffect, useState } from 'react'
import { Button, Tooltip } from '@heroui/react'
import {
  CloseLine,
  FullscreenExitLine,
  FullscreenLine,
  MinimizeLine,
} from '@mingcute/react'

export function AppTitlebar() {
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
    <header className='titlebar'>
      <div className='titlebar-drag'>
        <span className='titlebar-name select-none pointer-events-none'>AWA</span>
      </div>

      <div className='titlebar-actions'>
        <div className='titlebar-window-controls'>
          <Tooltip>
            <Tooltip.Trigger>
              <Button
                isIconOnly
                size='sm'
                variant='ghost'
                className='titlebar-control'
                onPress={() => {
                  void window.appApi.minimizeWindow()
                }}
              >
                <MinimizeLine size={16} />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>Minimize</Tooltip.Content>
          </Tooltip>

          <Tooltip>
            <Tooltip.Trigger>
              <Button
                isIconOnly
                size='sm'
                variant='ghost'
                className='titlebar-control'
                onPress={() => {
                  void window.appApi.toggleMaximizeWindow().then(({ isMaximized: nextState }) => {
                    setIsMaximized(nextState)
                  })
                }}
              >
                {isMaximized ? <FullscreenExitLine size={16} /> : <FullscreenLine size={16} />}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>{isMaximized ? 'Restore' : 'Maximize'}</Tooltip.Content>
          </Tooltip>

          <Tooltip>
            <Tooltip.Trigger>
              <Button
                isIconOnly
                size='sm'
                variant='ghost'
                className='titlebar-control titlebar-control-close'
                onPress={() => {
                  void window.appApi.closeWindow()
                }}
              >
                <CloseLine size={18} />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>Close</Tooltip.Content>
          </Tooltip>
        </div>
      </div>
    </header>
  )
}
