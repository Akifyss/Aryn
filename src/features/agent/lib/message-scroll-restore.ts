export const AGENT_MESSAGES_RESTORE_ANCHOR_MAX_ATTEMPTS = 30
export const AGENT_MESSAGES_RESTORE_ANCHOR_STABLE_FRAMES = 3

const AGENT_MESSAGES_RESTORE_CANCEL_EVENT_TYPES = new Set([
  'beforeinput',
  'keydown',
  'mousedown',
  'pointerdown',
  'touchstart',
  'wheel',
])

type AnimationFrameScheduler = {
  cancelAnimationFrame: (handle: number) => void
  requestAnimationFrame: (callback: FrameRequestCallback) => number
}

type AgentMessagesBottomRestoreOptions = {
  getScrollTop?: () => number
  maxAttempts?: number
  scheduler?: AnimationFrameScheduler
  scrollRootElement?: EventTarget
  scrollToBottom: () => void
  stableFrames?: number
}

export type AgentMessagesBottomRestoreController = {
  cancel: () => void
}

export function shouldCancelAgentMessagesRestoreForEvent(event: Event) {
  return AGENT_MESSAGES_RESTORE_CANCEL_EVENT_TYPES.has(event.type)
}

function getDefaultAnimationFrameScheduler(): AnimationFrameScheduler {
  return {
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
  }
}

export function startAgentMessagesBottomRestore({
  getScrollTop,
  maxAttempts = AGENT_MESSAGES_RESTORE_ANCHOR_MAX_ATTEMPTS,
  scheduler = getDefaultAnimationFrameScheduler(),
  scrollRootElement,
  scrollToBottom,
  stableFrames = AGENT_MESSAGES_RESTORE_ANCHOR_STABLE_FRAMES,
}: AgentMessagesBottomRestoreOptions): AgentMessagesBottomRestoreController {
  let attempts = 0
  let frameId: number | null = null
  let isCancelled = false
  let lastScrollTop: number | null = null
  let stableFrameCount = 0

  const cleanup = () => {
    if (frameId !== null) {
      scheduler.cancelAnimationFrame(frameId)
      frameId = null
    }

    scrollRootElement?.removeEventListener('beforeinput', handleCancelEvent, true)
    scrollRootElement?.removeEventListener('keydown', handleCancelEvent, true)
    scrollRootElement?.removeEventListener('mousedown', handleCancelEvent, true)
    scrollRootElement?.removeEventListener('pointerdown', handleCancelEvent, true)
    scrollRootElement?.removeEventListener('touchstart', handleCancelEvent, true)
    scrollRootElement?.removeEventListener('wheel', handleCancelEvent, true)
  }

  const cancel = () => {
    if (isCancelled) {
      return
    }

    isCancelled = true
    cleanup()
  }

  function handleCancelEvent(event: Event) {
    if (shouldCancelAgentMessagesRestoreForEvent(event)) {
      cancel()
    }
  }

  const scheduleNextFrame = () => {
    if (isCancelled || attempts >= maxAttempts) {
      cleanup()
      return
    }

    frameId = scheduler.requestAnimationFrame(() => {
      frameId = null

      if (isCancelled) {
        cleanup()
        return
      }

      attempts += 1
      scrollToBottom()

      const nextScrollTop = getScrollTop?.()
      if (typeof nextScrollTop === 'number') {
        if (lastScrollTop !== null && Math.abs(nextScrollTop - lastScrollTop) < 1) {
          stableFrameCount += 1
        } else {
          stableFrameCount = 0
          lastScrollTop = nextScrollTop
        }

        if (stableFrameCount >= stableFrames) {
          cleanup()
          return
        }
      }

      scheduleNextFrame()
    })
  }

  scrollRootElement?.addEventListener('beforeinput', handleCancelEvent, true)
  scrollRootElement?.addEventListener('keydown', handleCancelEvent, true)
  scrollRootElement?.addEventListener('mousedown', handleCancelEvent, true)
  scrollRootElement?.addEventListener('pointerdown', handleCancelEvent, true)
  scrollRootElement?.addEventListener('touchstart', handleCancelEvent, true)
  scrollRootElement?.addEventListener('wheel', handleCancelEvent, true)

  scrollToBottom()
  scheduleNextFrame()

  return { cancel }
}
