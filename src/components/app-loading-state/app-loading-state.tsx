import {
  type HTMLAttributes,
  type ReactNode,
  forwardRef,
} from 'react'
import { Spinner } from '@heroui/react'

export type AppLoadingStateProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  fill?: boolean
  label?: ReactNode
}

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export const AppLoadingState = forwardRef<HTMLDivElement, AppLoadingStateProps>(
  function AppLoadingState(
    {
      'aria-atomic': ariaAtomic = true,
      'aria-live': ariaLive = 'polite',
      className,
      fill = false,
      label = '正在加载…',
      role = 'status',
      ...props
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        aria-atomic={ariaAtomic}
        aria-live={ariaLive}
        className={joinClasses('app-loading-state', fill && 'is-fill', className)}
        role={role}
        {...props}
      >
        <Spinner
          aria-hidden='true'
          color='accent'
          size='md'
        />
        {label ? <span className='app-loading-state-label'>{label}</span> : null}
      </div>
    )
  },
)
