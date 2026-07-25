import { useCallback, useEffect, useRef, useState } from 'react'
import { AppButton } from '@/components/app-button'
import { AppAlertDialog } from '@/components/app-dialog'

export type AppConfirmationOptions = {
  cancelLabel?: string
  confirmLabel?: string
  isDanger?: boolean
  message: string
  title: string
}

type AppConfirmDialogProps = {
  confirmation: AppConfirmationOptions | null
  onCancel: () => void
  onConfirm: () => void
}

export function AppConfirmDialog({
  confirmation,
  onCancel,
  onConfirm,
}: AppConfirmDialogProps) {
  // Preserve the content while Base UI plays the closing transition.
  const lastConfirmationRef = useRef<AppConfirmationOptions | null>(confirmation)
  if (confirmation) {
    lastConfirmationRef.current = confirmation
  }
  const visibleConfirmation = confirmation ?? lastConfirmationRef.current

  return (
    <AppAlertDialog.Root
      open={Boolean(confirmation)}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onCancel()
        }
      }}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) {
          lastConfirmationRef.current = null
        }
      }}
    >
      <AppAlertDialog.Popup>
        <AppAlertDialog.Header>
          <AppAlertDialog.Icon tone={visibleConfirmation?.isDanger ? 'danger' : 'warning'} />
          <AppAlertDialog.Title>{visibleConfirmation?.title}</AppAlertDialog.Title>
        </AppAlertDialog.Header>
        <AppAlertDialog.Body>
          <AppAlertDialog.Description className='whitespace-pre-wrap'>
            {visibleConfirmation?.message}
          </AppAlertDialog.Description>
        </AppAlertDialog.Body>
        <AppAlertDialog.Footer>
          <AppAlertDialog.Close
            render={<AppButton variant='outline' />}
          >
            {visibleConfirmation?.cancelLabel ?? '取消'}
          </AppAlertDialog.Close>
          <AppButton
            variant={visibleConfirmation?.isDanger ? 'danger' : 'primary'}
            onClick={onConfirm}
          >
            {visibleConfirmation?.confirmLabel ?? '确认'}
          </AppButton>
        </AppAlertDialog.Footer>
      </AppAlertDialog.Popup>
    </AppAlertDialog.Root>
  )
}

export function useAppConfirmation() {
  const [confirmation, setConfirmation] = useState<AppConfirmationOptions | null>(null)
  const pendingResolutionRef = useRef<((confirmed: boolean) => void) | null>(null)

  const settleConfirmation = useCallback((confirmed: boolean) => {
    const resolve = pendingResolutionRef.current
    if (!resolve) {
      return
    }

    pendingResolutionRef.current = null
    setConfirmation(null)
    resolve(confirmed)
  }, [])

  const requestConfirmation = useCallback((options: AppConfirmationOptions) => (
    new Promise<boolean>((resolve) => {
      pendingResolutionRef.current?.(false)
      pendingResolutionRef.current = resolve
      setConfirmation(options)
    })
  ), [])

  useEffect(() => () => {
    const resolve = pendingResolutionRef.current
    pendingResolutionRef.current = null
    resolve?.(false)
  }, [])

  const cancelConfirmation = useCallback(
    () => settleConfirmation(false),
    [settleConfirmation],
  )
  const confirmConfirmation = useCallback(
    () => settleConfirmation(true),
    [settleConfirmation],
  )

  return {
    cancelConfirmation,
    confirmConfirmation,
    confirmation,
    requestConfirmation,
  }
}
