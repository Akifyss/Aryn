import { useEffect, useState } from 'react'
import { Button, ButtonGroup, Chip, Tooltip } from '@heroui/react'

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
        <div className='titlebar-brand'>
          <span className='titlebar-dot' />
          <span className='titlebar-name'>AWA</span>
          <Chip size='sm' variant='soft'>Desktop</Chip>
        </div>
      </div>

      <div className='titlebar-actions'>
        <ButtonGroup size='sm' variant='ghost'>
          <Tooltip>
            <Tooltip.Trigger>
              <Button
                isIconOnly
                onPress={() => {
                  void window.appApi.minimizeWindow()
                }}
              >
                <span className='window-action-glyph'>_</span>
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>Minimize</Tooltip.Content>
          </Tooltip>
          <Tooltip>
            <Tooltip.Trigger>
              <Button
                isIconOnly
                onPress={() => {
                  void window.appApi.toggleMaximizeWindow().then(({ isMaximized: nextState }) => {
                    setIsMaximized(nextState)
                  })
                }}
              >
                <span className='window-action-glyph'>{isMaximized ? '❐' : '□'}</span>
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>{isMaximized ? 'Restore' : 'Maximize'}</Tooltip.Content>
          </Tooltip>
          <Tooltip>
            <Tooltip.Trigger>
              <Button
                isIconOnly
                variant='danger-soft'
                onPress={() => {
                  void window.appApi.closeWindow()
                }}
              >
                <span className='window-action-glyph'>×</span>
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>Close</Tooltip.Content>
          </Tooltip>
        </ButtonGroup>
      </div>
    </header>
  )
}
