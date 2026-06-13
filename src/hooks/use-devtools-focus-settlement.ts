import { useEffect, useRef } from 'react'

type DevToolsFocusSnapshot = {
  capturedAt: number
  element: HTMLElement
  focusVisible: boolean
}

const DEVTOOLS_FOCUS_SNAPSHOT_MAX_AGE_MS = 10_000
const DEVTOOLS_FOCUS_SETTLEMENT_CANCEL_WINDOW_MS = 500
const DEVTOOLS_FOCUS_SETTLEMENT_DELAYS_MS = [0, 50, 150, 400] as const
const WINDOW_CHROME_BUTTON_SELECTOR = '.panel-toggle-button, .agent-collapsed-tab-button'
const TEXT_ENTRY_FOCUS_TARGET_SELECTOR = [
  '[role="textbox"]',
  '.agent-composer-editor',
  '.cm-content',
  '.monaco-editor',
].join(', ')

// Docked DevTools can return focus to the renderer as keyboard-visible focus
// on an unrelated control. Keep the workaround scoped to the DevTools lifecycle.
function isTrackableFocusTarget(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement
    && element !== document.body
    && element !== document.documentElement
  )
}

function captureDevToolsFocusSnapshot(): DevToolsFocusSnapshot | null {
  const activeElement = document.activeElement

  if (!isTrackableFocusTarget(activeElement)) {
    return null
  }

  return {
    capturedAt: Date.now(),
    element: activeElement,
    focusVisible: activeElement.matches(':focus-visible'),
  }
}

function hasEditableAncestor(element: HTMLElement) {
  const editableAncestor = element.closest('[contenteditable]')

  return (
    editableAncestor instanceof HTMLElement
    && editableAncestor.contentEditable !== 'false'
  )
}

function isTextEntryFocusTarget(element: HTMLElement) {
  if (
    element instanceof HTMLInputElement
    || element instanceof HTMLSelectElement
    || element instanceof HTMLTextAreaElement
  ) {
    return true
  }

  return (
    element.isContentEditable
    || hasEditableAncestor(element)
    || !!element.closest(TEXT_ENTRY_FOCUS_TARGET_SELECTOR)
  )
}

function shouldReleaseDevToolsRestoredFocus(
  element: HTMLElement,
  openedFocusSnapshot: DevToolsFocusSnapshot | null,
) {
  if (isTextEntryFocusTarget(element)) {
    return false
  }

  if (openedFocusSnapshot?.element === element && openedFocusSnapshot.focusVisible) {
    return false
  }

  if (element.matches(WINDOW_CHROME_BUTTON_SELECTOR)) {
    return true
  }

  return element.matches(':focus-visible')
}

function getFreshDevToolsFocusSnapshot(snapshot: DevToolsFocusSnapshot | null) {
  if (!snapshot) {
    return null
  }

  if (snapshot.element === document.activeElement) {
    return snapshot
  }

  return Date.now() - snapshot.capturedAt <= DEVTOOLS_FOCUS_SNAPSHOT_MAX_AGE_MS
    ? snapshot
    : null
}

function restoreDevToolsOpenedFocus(openedFocusSnapshot: DevToolsFocusSnapshot | null) {
  if (
    !openedFocusSnapshot
    || !openedFocusSnapshot.element.isConnected
    || (!openedFocusSnapshot.focusVisible && !isTextEntryFocusTarget(openedFocusSnapshot.element))
  ) {
    return
  }

  const activeElement = document.activeElement

  if (activeElement === openedFocusSnapshot.element) {
    return
  }

  openedFocusSnapshot.element.focus({ preventScroll: true })
}

function settleDevToolsRestoredFocus(openedFocusSnapshot: DevToolsFocusSnapshot | null) {
  const activeElement = document.activeElement

  if (
    activeElement instanceof HTMLElement
    && shouldReleaseDevToolsRestoredFocus(activeElement, openedFocusSnapshot)
  ) {
    activeElement.blur()
  }

  restoreDevToolsOpenedFocus(openedFocusSnapshot)
}

function scheduleDevToolsFocusSettlement(openedFocusSnapshot: DevToolsFocusSnapshot | null) {
  let cancelled = false
  let cleanedUp = false
  let animationFrameId: number | null = null
  const timeoutIds = new Set<number>()

  const cleanup = () => {
    if (cleanedUp) {
      return
    }

    cleanedUp = true
    window.removeEventListener('keydown', cancelSettlement, true)
    window.removeEventListener('pointerdown', cancelSettlement, true)

    if (animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId)
    }

    for (const timeoutId of timeoutIds) {
      window.clearTimeout(timeoutId)
    }

    timeoutIds.clear()
  }

  const scheduleTimeout = (callback: () => void, delay: number) => {
    const timeoutId = window.setTimeout(() => {
      timeoutIds.delete(timeoutId)
      callback()
    }, delay)

    timeoutIds.add(timeoutId)
  }

  function cancelSettlement() {
    cancelled = true
    cleanup()
  }

  const settle = () => {
    if (!cancelled) {
      settleDevToolsRestoredFocus(openedFocusSnapshot)
    }
  }

  window.addEventListener('keydown', cancelSettlement, true)
  window.addEventListener('pointerdown', cancelSettlement, true)

  settle()
  animationFrameId = window.requestAnimationFrame(() => {
    animationFrameId = null
    settle()

    for (const delay of DEVTOOLS_FOCUS_SETTLEMENT_DELAYS_MS) {
      scheduleTimeout(settle, delay)
    }
  })
  scheduleTimeout(cleanup, DEVTOOLS_FOCUS_SETTLEMENT_CANCEL_WINDOW_MS)

  return cleanup
}

export function useDevToolsFocusSettlement() {
  const lastRendererFocusSnapshotRef = useRef<DevToolsFocusSnapshot | null>(null)
  const devToolsOpenedFocusSnapshotRef = useRef<DevToolsFocusSnapshot | null>(null)
  const pendingFocusSettlementCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const updateLastRendererFocusSnapshot = () => {
      const snapshot = captureDevToolsFocusSnapshot()

      if (snapshot) {
        lastRendererFocusSnapshotRef.current = snapshot
      }
    }

    const clearLastRendererFocusSnapshot = () => {
      lastRendererFocusSnapshotRef.current = null
    }

    updateLastRendererFocusSnapshot()
    document.addEventListener('focusin', updateLastRendererFocusSnapshot, true)
    document.addEventListener('pointerdown', clearLastRendererFocusSnapshot, true)

    return () => {
      document.removeEventListener('focusin', updateLastRendererFocusSnapshot, true)
      document.removeEventListener('pointerdown', clearLastRendererFocusSnapshot, true)
    }
  }, [])

  useEffect(() => {
    return window.appApi.onWindowDevToolsOpened(() => {
      pendingFocusSettlementCleanupRef.current?.()
      pendingFocusSettlementCleanupRef.current = null
      devToolsOpenedFocusSnapshotRef.current = (
        getFreshDevToolsFocusSnapshot(lastRendererFocusSnapshotRef.current)
        ?? captureDevToolsFocusSnapshot()
      )
    })
  }, [])

  useEffect(() => {
    const unsubscribe = window.appApi.onWindowDevToolsClosed(() => {
      const openedFocusSnapshot = devToolsOpenedFocusSnapshotRef.current
      devToolsOpenedFocusSnapshotRef.current = null

      pendingFocusSettlementCleanupRef.current?.()
      pendingFocusSettlementCleanupRef.current = scheduleDevToolsFocusSettlement(openedFocusSnapshot)
    })

    return () => {
      unsubscribe()
      pendingFocusSettlementCleanupRef.current?.()
      pendingFocusSettlementCleanupRef.current = null
    }
  }, [])
}
