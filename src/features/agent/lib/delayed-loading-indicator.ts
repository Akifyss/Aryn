export const SESSION_LOADING_INDICATOR_DELAY_MS = 200

type TimerHandle = ReturnType<typeof globalThis.setTimeout>

type DelayedLoadingIndicatorOptions = {
  delayMs?: number
  onVisibilityChange: (visible: boolean) => void
  schedule?: typeof globalThis.setTimeout
  cancel?: typeof globalThis.clearTimeout
}

export function createDelayedLoadingIndicator({
  delayMs = SESSION_LOADING_INDICATOR_DELAY_MS,
  onVisibilityChange,
  schedule = globalThis.setTimeout,
  cancel = globalThis.clearTimeout,
}: DelayedLoadingIndicatorOptions) {
  let timer: TimerHandle | null = null
  let visible = false

  function clearPendingTimer() {
    if (timer === null) return
    cancel(timer)
    timer = null
  }

  function syncVisibility(nextVisible: boolean) {
    if (visible === nextVisible) return
    visible = nextVisible
    onVisibilityChange(nextVisible)
  }

  return {
    begin() {
      clearPendingTimer()

      // Once shown, keep the indicator stable across rapid session changes.
      if (visible) return
      timer = schedule(() => {
        timer = null
        syncVisibility(true)
      }, delayMs)
    },

    finish() {
      clearPendingTimer()
      syncVisibility(false)
    },

    cancelPending() {
      clearPendingTimer()
    },

    isVisible() {
      return visible
    },
  }
}
