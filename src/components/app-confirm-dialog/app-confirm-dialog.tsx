import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertDialog, Button } from '@heroui/react'

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
  return (
    <AlertDialog.Backdrop
      isOpen={Boolean(confirmation)}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onCancel()
        }
      }}
    >
      <AlertDialog.Container>
        <AlertDialog.Dialog>
          <AlertDialog.CloseTrigger />
          <AlertDialog.Header>
            <AlertDialog.Icon status={confirmation?.isDanger ? 'danger' : 'warning'} />
            <AlertDialog.Heading>{confirmation?.title}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p className='text-[var(--foreground-primary)] whitespace-pre-wrap'>
              {confirmation?.message}
            </p>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button variant='tertiary' onPress={onCancel}>
              {confirmation?.cancelLabel ?? '取消'}
            </Button>
            <Button
              variant={confirmation?.isDanger ? 'danger' : 'primary'}
              onPress={onConfirm}
            >
              {confirmation?.confirmLabel ?? '确认'}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
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
