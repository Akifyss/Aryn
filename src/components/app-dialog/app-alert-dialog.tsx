import {
  type ComponentPropsWithoutRef,
  type HTMLAttributes,
  type ReactNode,
  forwardRef,
} from 'react'
import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog'
import { AlertLine, CloseLine, InformationLine, WarningLine } from '@mingcute/react'
import { AppIconButton } from '@/components/app-icon-button'
import './styles.css'

export type AppAlertDialogTone = 'danger' | 'default' | 'warning'

type AlertDialogSize = 'lg' | 'md' | 'sm'

type AlertDialogPopupProps = Omit<
  ComponentPropsWithoutRef<typeof BaseAlertDialog.Popup>,
  'className' | 'children'
> & {
  children: ReactNode
  className?: string
  closeButtonDisabled?: boolean
  size?: AlertDialogSize
}

type AlertDialogTitleProps = Omit<
  ComponentPropsWithoutRef<typeof BaseAlertDialog.Title>,
  'className'
> & {
  className?: string
}

type AlertDialogDescriptionProps = Omit<
  ComponentPropsWithoutRef<typeof BaseAlertDialog.Description>,
  'className'
> & {
  className?: string
}

type AlertDialogIconProps = HTMLAttributes<HTMLDivElement> & {
  tone?: AppAlertDialogTone
}

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

const AlertDialogPopup = forwardRef<HTMLDivElement, AlertDialogPopupProps>(
  function AlertDialogPopup(
    {
      children,
      className,
      closeButtonDisabled = false,
      size = 'md',
      ...popupProps
    },
    ref,
  ) {
    return (
      <BaseAlertDialog.Portal>
        <BaseAlertDialog.Backdrop
          data-app-modal-layer=''
          data-slot='app-alert-dialog-backdrop'
          className='app-dialog-backdrop'
        />
        <BaseAlertDialog.Viewport
          data-slot='app-alert-dialog-viewport'
          className='app-dialog-viewport'
        >
          <BaseAlertDialog.Popup
            {...popupProps}
            ref={ref}
            data-size={size}
            data-slot='app-alert-dialog-popup'
            className={joinClassNames('app-alert-dialog-popup', className)}
          >
            {children}
            {closeButtonDisabled ? (
              <BaseAlertDialog.Close
                disabled
                render={(
                  <AppIconButton
                    aria-label='关闭'
                    className='app-dialog-close-button'
                    disabled
                    tooltip={null}
                  />
                )}
              >
                <CloseLine aria-hidden='true' />
              </BaseAlertDialog.Close>
            ) : (
              <BaseAlertDialog.Close
                render={(
                  <AppIconButton
                    aria-label='关闭'
                    className='app-dialog-close-button'
                    tooltip='关闭'
                    placement='top'
                  />
                )}
              >
                <CloseLine aria-hidden='true' />
              </BaseAlertDialog.Close>
            )}
          </BaseAlertDialog.Popup>
        </BaseAlertDialog.Viewport>
      </BaseAlertDialog.Portal>
    )
  },
)

const AlertDialogTitle = forwardRef<
  HTMLHeadingElement,
  AlertDialogTitleProps
>(function AlertDialogTitle({ className, ...props }, ref) {
  return (
    <BaseAlertDialog.Title
      ref={ref}
      data-slot='app-alert-dialog-title'
      className={joinClassNames('app-alert-dialog-title', className)}
      {...props}
    />
  )
})

const AlertDialogDescription = forwardRef<
  HTMLParagraphElement,
  AlertDialogDescriptionProps
>(function AlertDialogDescription({ className, ...props }, ref) {
  return (
    <BaseAlertDialog.Description
      ref={ref}
      data-slot='app-alert-dialog-description'
      className={joinClassNames(
        'app-alert-dialog-description',
        className,
      )}
      {...props}
    />
  )
})

const AlertDialogHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function AlertDialogHeader({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot='app-alert-dialog-header'
        className={joinClassNames('app-alert-dialog-header', className)}
        {...props}
      />
    )
  },
)

const AlertDialogBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function AlertDialogBody({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot='app-alert-dialog-body'
        className={joinClassNames('app-alert-dialog-body', className)}
        {...props}
      />
    )
  },
)

const AlertDialogFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function AlertDialogFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot='app-alert-dialog-footer'
        className={joinClassNames('app-alert-dialog-footer', className)}
        {...props}
      />
    )
  },
)

const AlertDialogIcon = forwardRef<HTMLDivElement, AlertDialogIconProps>(
  function AlertDialogIcon({ className, tone = 'default', ...props }, ref) {
    const StatusIcon = tone === 'danger'
      ? AlertLine
      : tone === 'warning'
        ? WarningLine
        : InformationLine

    return (
      <div
        {...props}
        ref={ref}
        data-slot='app-alert-dialog-icon'
        data-tone={tone}
        className={joinClassNames('app-alert-dialog-icon', className)}
      >
        <StatusIcon aria-hidden='true' />
      </div>
    )
  },
)

export const AppAlertDialog = {
  Body: AlertDialogBody,
  Close: BaseAlertDialog.Close,
  Description: AlertDialogDescription,
  Footer: AlertDialogFooter,
  Header: AlertDialogHeader,
  Icon: AlertDialogIcon,
  Popup: AlertDialogPopup,
  Root: BaseAlertDialog.Root,
  Title: AlertDialogTitle,
  Trigger: BaseAlertDialog.Trigger,
}

export type { AlertDialogPopupProps as AppAlertDialogPopupProps }
