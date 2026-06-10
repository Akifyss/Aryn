import { Tooltip } from '@heroui/react'
import {
  Button as AriaButton,
  Focusable,
  type ButtonProps as AriaButtonProps,
} from 'react-aria-components'
import {
  type ButtonHTMLAttributes,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  forwardRef,
} from 'react'

type AppTooltipTriggerMode = 'context' | 'focusable' | 'wrapper'

type AppTooltipProps = {
  children: ReactElement
  closeDelay?: number
  delay?: number
  excludeFromTabOrder?: boolean
  isOpen?: boolean
  offset?: number
  placement?: ComponentProps<typeof Tooltip.Content>['placement']
  tooltip?: ReactNode
  triggerClassName?: string
  triggerMode?: AppTooltipTriggerMode
  triggerRole?: ComponentProps<typeof Tooltip.Trigger>['role']
}

type AppTooltipButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children?: ReactNode
  closeDelay?: number
  delay?: number
  disabled?: boolean
  isTooltipOpen?: boolean
  offset?: number
  placement?: ComponentProps<typeof Tooltip.Content>['placement']
  tooltip?: ReactNode
}

export function AppTooltip({
  children,
  closeDelay = 0,
  delay = 500,
  excludeFromTabOrder = false,
  isOpen,
  offset = 3,
  placement,
  tooltip,
  triggerClassName,
  triggerMode = 'wrapper',
  triggerRole,
}: AppTooltipProps) {
  if (tooltip === undefined || tooltip === null || tooltip === false) {
    return children
  }

  const trigger = triggerMode === 'context'
    ? children
    : triggerMode === 'focusable'
      ? (
          <Focusable excludeFromTabOrder={excludeFromTabOrder}>
            {children as unknown as ComponentProps<typeof Focusable>['children']}
          </Focusable>
        )
      : (
          <Tooltip.Trigger
            className={triggerClassName}
            role={triggerRole}
            tabIndex={excludeFromTabOrder ? -1 : undefined}
          >
            {children}
          </Tooltip.Trigger>
        )

  return (
    <Tooltip closeDelay={closeDelay} delay={delay} isOpen={isOpen}>
      {trigger}
      <Tooltip.Content
        className='app-tooltip'
        offset={offset}
        placement={placement}
      >
        {tooltip}
      </Tooltip.Content>
    </Tooltip>
  )
}

export const AppTooltipButton = forwardRef<HTMLButtonElement, AppTooltipButtonProps>(function AppTooltipButton(
  {
    children,
    closeDelay = 0,
    delay,
    disabled,
    isTooltipOpen,
    offset = 3,
    placement,
    title,
    tooltip,
    type = 'button',
    ...buttonProps
  },
  ref,
) {
  const resolvedTooltip = tooltip ?? title
  // Keep call sites compatible with native button props while using React Aria's
  // context-aware button as the HeroUI tooltip trigger.
  const ariaButtonProps = buttonProps as AriaButtonProps
  const button = (
    <AriaButton ref={ref} type={type} isDisabled={disabled} {...ariaButtonProps}>
      {children}
    </AriaButton>
  )

  if (resolvedTooltip === undefined || resolvedTooltip === null || resolvedTooltip === false) {
    return button
  }

  return (
    <AppTooltip
      closeDelay={closeDelay}
      delay={delay}
      isOpen={isTooltipOpen}
      offset={offset}
      placement={placement}
      tooltip={resolvedTooltip}
      triggerMode='context'
    >
      {button}
    </AppTooltip>
  )
})
