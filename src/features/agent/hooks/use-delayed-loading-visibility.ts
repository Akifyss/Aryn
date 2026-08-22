import { useLayoutEffect, useRef, useState } from 'react'
import { createDelayedLoadingIndicator } from '@/features/agent/lib/delayed-loading-indicator'

/**
 * Delays a visual loading indicator while work remains active. Callers still
 * decide whether an existing surface is paintable and can bypass the delay when
 * showing nothing would otherwise produce a blank frame. A changing transition
 * key restarts the grace period for a newly selected destination.
 */
export function useDelayedLoadingVisibility(
  active: boolean,
  transitionKey: string | number | null = null,
) {
  const [visible, setVisible] = useState(false)
  const indicatorRef = useRef<ReturnType<typeof createDelayedLoadingIndicator> | null>(null)

  if (!indicatorRef.current) {
    indicatorRef.current = createDelayedLoadingIndicator({
      onVisibilityChange: setVisible,
    })
  }
  const indicator = indicatorRef.current

  useLayoutEffect(() => {
    if (active) {
      indicator.begin()
      return
    }
    indicator.finish()
  }, [active, indicator, transitionKey])

  useLayoutEffect(() => () => {
    indicator.cancelPending()
  }, [indicator])

  return visible
}
