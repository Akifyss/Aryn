import {
  type ComponentPropsWithoutRef,
  createContext,
  forwardRef,
  useContext,
} from 'react'
import {
  AppButton,
  type AppButtonProps,
  type AppButtonSize,
  type AppButtonVariant,
} from '@/components/app-button'
import {
  AppIconButton,
  type AppIconButtonProps,
} from '@/components/app-icon-button'

type AppSplitButtonContextValue = {
  size: AppButtonSize
  variant: AppButtonVariant
}

const AppSplitButtonContext = createContext<AppSplitButtonContextValue | null>(null)

export type AppSplitButtonRootProps = ComponentPropsWithoutRef<'div'> & {
  size?: AppButtonSize
  variant?: AppButtonVariant
}

export type AppSplitButtonActionProps = Omit<
  AppButtonProps,
  'size' | 'variant'
>

export type AppSplitButtonTriggerProps = Omit<
  AppIconButtonProps,
  'size' | 'tooltip' | 'variant'
> & {
  tooltip: string
}

function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

function useAppSplitButtonContext(componentName: string) {
  const context = useContext(AppSplitButtonContext)

  if (!context) {
    throw new Error(`${componentName} must be rendered inside AppSplitButton.Root`)
  }

  return context
}

const AppSplitButtonRoot = forwardRef<HTMLDivElement, AppSplitButtonRootProps>(
  function AppSplitButtonRoot(
    {
      children,
      className,
      role = 'group',
      size = 'md',
      variant = 'primary',
      ...props
    },
    ref,
  ) {
    return (
      <AppSplitButtonContext.Provider value={{ size, variant }}>
        <div
          {...props}
          ref={ref}
          role={role}
          className={cx('app-split-button', className)}
          data-size={size}
          data-variant={variant}
        >
          {children}
        </div>
      </AppSplitButtonContext.Provider>
    )
  },
)

const AppSplitButtonAction = forwardRef<HTMLElement, AppSplitButtonActionProps>(
  function AppSplitButtonAction({ className, ...props }, ref) {
    const { size, variant } = useAppSplitButtonContext('AppSplitButton.Action')

    return (
      <AppButton
        {...props}
        ref={ref}
        size={size}
        variant={variant}
        className={
          typeof className === 'function'
            ? (state) => cx(
                'app-split-button-segment app-split-button-action',
                className(state),
              )
            : cx('app-split-button-segment app-split-button-action', className)
        }
      />
    )
  },
)

const AppSplitButtonTrigger = forwardRef<
  HTMLButtonElement,
  AppSplitButtonTriggerProps
>(function AppSplitButtonTrigger({ className, tooltip, ...props }, ref) {
  const { size } = useAppSplitButtonContext('AppSplitButton.Trigger')

  return (
    <AppIconButton
      {...props}
      ref={ref}
      size={size}
      tooltip={tooltip}
      variant='ghost'
      className={cx(
        'app-split-button-segment app-split-button-trigger',
        className,
      )}
    />
  )
})

export const AppSplitButton = {
  Root: AppSplitButtonRoot,
  Action: AppSplitButtonAction,
  Trigger: AppSplitButtonTrigger,
}
