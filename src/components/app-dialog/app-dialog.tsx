import {
  type ComponentPropsWithoutRef,
  type HTMLAttributes,
  type ReactNode,
  forwardRef,
} from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { CloseLine } from '@mingcute/react'
import { AppTooltip } from '@/components/app-tooltip'
import './styles.css'

type DialogSize = 'custom' | 'lg' | 'md' | 'sm'

type DialogPopupProps = Omit<
  ComponentPropsWithoutRef<typeof BaseDialog.Popup>,
  'className' | 'children'
> & {
  children: ReactNode
  className?: string
  closeLabel?: string
  showCloseButton?: boolean
  size?: DialogSize
  viewportClassName?: string
}

type DialogTitleProps = Omit<
  ComponentPropsWithoutRef<typeof BaseDialog.Title>,
  'className'
> & {
  className?: string
}

type DialogDescriptionProps = Omit<
  ComponentPropsWithoutRef<typeof BaseDialog.Description>,
  'className'
> & {
  className?: string
}

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

const DialogPopup = forwardRef<HTMLDivElement, DialogPopupProps>(function DialogPopup(
  {
    children,
    className,
    closeLabel = '关闭',
    showCloseButton = false,
    size = 'md',
    viewportClassName,
    ...popupProps
  },
  ref,
) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop
        data-app-modal-layer=''
        data-slot='app-dialog-backdrop'
        className='app-dialog-backdrop'
      />
      <BaseDialog.Viewport
        data-slot='app-dialog-viewport'
        className={joinClassNames('app-dialog-viewport', viewportClassName)}
      >
        <BaseDialog.Popup
          {...popupProps}
          ref={ref}
          data-size={size}
          data-slot='app-dialog-popup'
          className={joinClassNames('app-dialog-popup', className)}
        >
          {children}
          {showCloseButton ? (
            <AppTooltip
              placement='top'
              tooltip={closeLabel}
              triggerMode='focusable'
            >
              <BaseDialog.Close
                aria-label={closeLabel}
                className='app-dialog-close-button'
              >
                <CloseLine aria-hidden='true' />
              </BaseDialog.Close>
            </AppTooltip>
          ) : null}
        </BaseDialog.Popup>
      </BaseDialog.Viewport>
    </BaseDialog.Portal>
  )
})

const DialogTitle = forwardRef<
  HTMLHeadingElement,
  DialogTitleProps
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <BaseDialog.Title
      ref={ref}
      data-slot='app-dialog-title'
      className={joinClassNames('app-dialog-title', className)}
      {...props}
    />
  )
})

const DialogDescription = forwardRef<
  HTMLParagraphElement,
  DialogDescriptionProps
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <BaseDialog.Description
      ref={ref}
      data-slot='app-dialog-description'
      className={joinClassNames('app-dialog-description', className)}
      {...props}
    />
  )
})

const DialogBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function DialogBody({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot='app-dialog-body'
        className={joinClassNames('app-dialog-body', className)}
        {...props}
      />
    )
  },
)

const DialogFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function DialogFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot='app-dialog-footer'
        className={joinClassNames('app-dialog-footer', className)}
        {...props}
      />
    )
  },
)

export const AppDialog = {
  Body: DialogBody,
  Close: BaseDialog.Close,
  Description: DialogDescription,
  Footer: DialogFooter,
  Popup: DialogPopup,
  Root: BaseDialog.Root,
  Title: DialogTitle,
  Trigger: BaseDialog.Trigger,
}

export type { DialogPopupProps as AppDialogPopupProps }
