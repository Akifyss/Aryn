import { useCallback, useEffect, useRef } from 'react'

type AppWindowCloseOptions = {
  confirmDiscardDirtyTabs: (reason: 'close') => Promise<boolean>
}

export type AppWindowCloseRequestState = {
  isInFlight: boolean
}

export async function requestAppWindowClose(
  state: AppWindowCloseRequestState,
  confirmDiscardDirtyTabs: () => Promise<boolean>,
  closeWindow: () => Promise<void>,
) {
  if (state.isInFlight) {
    return
  }

  state.isInFlight = true

  try {
    if (!(await confirmDiscardDirtyTabs())) {
      return
    }

    await closeWindow()
  } finally {
    state.isInFlight = false
  }
}

export function useAppWindowClose({
  confirmDiscardDirtyTabs,
}: AppWindowCloseOptions) {
  const confirmDiscardDirtyTabsRef = useRef(confirmDiscardDirtyTabs)
  const requestStateRef = useRef<AppWindowCloseRequestState>({ isInFlight: false })

  useEffect(() => {
    confirmDiscardDirtyTabsRef.current = confirmDiscardDirtyTabs
  }, [confirmDiscardDirtyTabs])

  const requestWindowClose = useCallback(async () => {
    try {
      await requestAppWindowClose(
        requestStateRef.current,
        () => confirmDiscardDirtyTabsRef.current('close'),
        () => window.appApi.closeWindow(),
      )
    } catch (error) {
      console.error('[window] Failed to close the application window.', error)
    }
  }, [])

  useEffect(() => (
    window.appApi.onWindowCloseRequested(() => {
      void requestWindowClose()
    })
  ), [requestWindowClose])

  return requestWindowClose
}
