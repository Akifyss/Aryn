import {
  Button as BaseButton,
  type ButtonProps as BaseButtonProps,
} from '@base-ui/react/button'
import { forwardRef } from 'react'

export type AppButtonSize = 'md' | 'sm'
export type AppButtonVariant =
  | 'danger'
  | 'ghost'
  | 'outline'
  | 'primary'

export type AppButtonProps = BaseButtonProps & {
  size?: AppButtonSize
  variant?: AppButtonVariant
}

function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

export const AppButton = forwardRef<HTMLElement, AppButtonProps>(function AppButton(
  {
    children,
    className,
    size = 'md',
    type = 'button',
    variant = 'primary',
    ...props
  },
  ref,
) {
  return (
    <BaseButton
      {...props}
      ref={ref}
      type={type}
      className={
        typeof className === 'function'
          ? (state) => cx('app-button', className(state))
          : cx('app-button', className)
      }
      data-size={size}
      data-variant={variant}
    >
      {children}
    </BaseButton>
  )
})
