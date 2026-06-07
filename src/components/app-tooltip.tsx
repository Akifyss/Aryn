import type { ReactNode } from 'react'
import {
  Button as AriaButton,
  Tooltip as AriaTooltip,
  TooltipTrigger,
  type ButtonProps as AriaButtonProps,
  type TooltipProps as AriaTooltipProps,
} from 'react-aria-components'

type AppTooltipButtonProps = Omit<AriaButtonProps, 'children'> & {
  children: ReactNode
  closeDelay?: number
  delay?: number
  offset?: number
  placement?: AriaTooltipProps['placement']
  tooltip: ReactNode
}

export function AppTooltipButton({
  children,
  closeDelay = 0,
  delay,
  offset = 3,
  placement,
  tooltip,
  ...buttonProps
}: AppTooltipButtonProps) {
  return (
    <TooltipTrigger closeDelay={closeDelay} delay={delay}>
      <AriaButton {...buttonProps}>
        {children}
      </AriaButton>
      <AriaTooltip className='tooltip' offset={offset} placement={placement}>
        {tooltip}
      </AriaTooltip>
    </TooltipTrigger>
  )
}
