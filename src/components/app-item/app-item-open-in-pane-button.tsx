import { ArrowLeftLine, ArrowRightLine } from '@mingcute/react'
import { AppItemActionButton } from './app-item'

export type AppItemOpenInPaneAction = {
  direction: 'left' | 'right'
  onOpen: () => void
}

export function AppItemOpenInPaneButton({ direction, onOpen, disabled }: AppItemOpenInPaneAction & {
  disabled?: boolean
}) {
  return (
    <AppItemActionButton
      aria-label={direction === 'right' ? '在右侧打开' : '在左侧打开'}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onOpen()
      }}
    >
      {direction === 'right' ? <ArrowRightLine aria-hidden='true' /> : <ArrowLeftLine aria-hidden='true' />}
    </AppItemActionButton>
  )
}
