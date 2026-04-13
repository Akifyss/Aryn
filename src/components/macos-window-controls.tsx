import { useEffect, useState } from 'react'

export function MacosWindowControls({
  className = '',
  onRequestClose,
}: {
  className?: string
  onRequestClose?: () => void
}) {
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
    <div className={`titlebar-macos-left${className ? ` ${className}` : ''}`}>
      <button
        aria-label='Close window'
        className='traffic-button traffic-close'
        type='button'
        onClick={() => {
          if (onRequestClose) {
            onRequestClose()
            return
          }

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
    </div>
  )
}
