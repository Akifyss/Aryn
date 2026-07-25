import {
  type ReactNode,
  forwardRef,
} from 'react'
import {
  AppTooltipButton,
  type AppTooltipButtonProps,
} from '@/components/app-tooltip'

export type AppIconButtonSize = 'md' | 'sm'
export type AppIconButtonVariant = 'ghost' | 'outline' | 'solid'

export type AppIconButtonProps = Omit<AppTooltipButtonProps, 'children'> & {
  children?: ReactNode
  isActive?: boolean
  label?: string
  size?: AppIconButtonSize
  variant?: AppIconButtonVariant
}

function resolveTextLabel(...values: ReactNode[]) {
  return values.find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  )
}

function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

export const AppIconButton = forwardRef<HTMLButtonElement, AppIconButtonProps>(function AppIconButton(
  {
    'aria-label': ariaLabel,
    children,
    className,
    isActive,
    label,
    size = 'md',
    title,
    tooltip,
    type = 'button',
    variant = 'ghost',
    ...props
  },
  ref,
) {
  const resolvedLabel = resolveTextLabel(ariaLabel, label, tooltip, title)
  const resolvedTooltip = tooltip === undefined ? (title ?? label ?? ariaLabel) : tooltip

  return (
    <AppTooltipButton
      {...props}
      ref={ref}
      type={type}
      aria-label={resolvedLabel}
      className={cx('app-icon-button', className)}
      data-active={isActive ? 'true' : undefined}
      data-size={size}
      data-variant={variant}
      tooltip={resolvedTooltip}
    >
      {children}
    </AppTooltipButton>
  )
})
