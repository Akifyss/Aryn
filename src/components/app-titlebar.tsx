import { useEffect, useState } from 'react'
import { Button, Chip, Tooltip } from '@heroui/react'
import { 
  MinimizeLine, 
  FullscreenLine, 
  FullscreenExitLine,
  CloseLine 
} from '@mingcute/react'

export function AppTitlebar() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    let mounted = true
    void window.appApi.isWindowMaximized().then(({ isMaximized: nextState }) => {
      if (mounted) setIsMaximized(nextState)
    })
    return () => { mounted = false }
  }, [])

  return (
    <header className='titlebar'>
      <div className='titlebar-drag'>
        <div className='titlebar-brand select-none pointer-events-none'>
          <span className='titlebar-dot' />
          <span className='titlebar-name'>AWA Workspace</span>
          <Chip size='sm' variant='soft' color="default" className="h-5 text-[10px] font-bold px-1.5 uppercase">Beta</Chip>
        </div>
      </div>

      <div className='titlebar-actions'>
        <div className="flex items-center">
          <Tooltip>
            <Tooltip.Trigger>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                className="w-10 h-10 rounded-none hover:bg-slate-100"
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
                size="sm"
                variant="ghost"
                className="w-10 h-10 rounded-none hover:bg-slate-100"
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
                size="sm"
                variant="ghost"
                className="w-10 h-10 rounded-none hover:bg-red-500 hover:text-white"
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
