import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isAgentMessagesScrollIntentKey, resolveAgentMessagesScrollStickiness } from '@/features/agent/lib/message-scroll-stickiness'
import {
  startAgentMessagesBottomRestore,
  type AgentMessagesBottomRestoreController,
} from '@/features/agent/lib/message-scroll-restore'
import { SIDEBAR_RESIZE_END_EVENT } from '@/features/layout/shell-layout'
import {
  getAgentMessageViewportContentElement,
  isAgentMessageViewportEvent,
  isAgentMessageViewportScrollbarPointerEvent,
  scrollAgentMessageViewportToBottom,
} from './agent-message-viewport-dom'

const AGENT_MESSAGES_TRANSIENT_SCROLL_INTENT_MS = 600

export type AgentMessageViewportContentRevisions = {
  assistantDraft: string
  codexNative: string
  fileChanges: string
  liveTools: readonly unknown[]
  openCodeNative: string
  piWebNative: string
  renderedMessageCount: number
  sessionStatus: string
  thinkingDraft: string
}

export function useAgentMessageViewportScroll({
  activeSessionPath,
  contentRevisions,
}: {
  activeSessionPath: string | null
  contentRevisions: AgentMessageViewportContentRevisions
}) {
  const [messagesScrollElement, setMessagesScrollElement] = useState<HTMLDivElement | null>(null)
  const hasObservedScrollElementRef = useRef(false)
  const previousSessionPathRef = useRef<string | null>(null)
  const previousScrollElementRef = useRef<HTMLDivElement | null>(null)
  const shouldStickMessagesToBottomRef = useRef(true)
  const messagesUserScrollIntentRef = useRef(false)
  const messagesUserScrollIntentTimeoutRef = useRef<number | null>(null)
  const messagesBottomRestoreRef = useRef<AgentMessagesBottomRestoreController | null>(null)
  const {
    assistantDraft,
    codexNative,
    fileChanges,
    liveTools,
    openCodeNative,
    piWebNative,
    renderedMessageCount,
    sessionStatus,
    thinkingDraft,
  } = contentRevisions
  const messagesScrollViewportRef = useCallback((element: HTMLDivElement | null) => {
    setMessagesScrollElement((currentElement) => (
      currentElement === element ? currentElement : element
    ))
  }, [])

  function clearMessagesUserScrollIntent() {
    messagesUserScrollIntentRef.current = false

    if (messagesUserScrollIntentTimeoutRef.current !== null) {
      window.clearTimeout(messagesUserScrollIntentTimeoutRef.current)
      messagesUserScrollIntentTimeoutRef.current = null
    }
  }

  function markMessagesUserScrollIntent(options: { transient: boolean }) {
    messagesUserScrollIntentRef.current = true

    if (messagesUserScrollIntentTimeoutRef.current !== null) {
      window.clearTimeout(messagesUserScrollIntentTimeoutRef.current)
      messagesUserScrollIntentTimeoutRef.current = null
    }

    if (!options.transient) {
      return
    }

    messagesUserScrollIntentTimeoutRef.current = window.setTimeout(() => {
      messagesUserScrollIntentRef.current = false
      messagesUserScrollIntentTimeoutRef.current = null
    }, AGENT_MESSAGES_TRANSIENT_SCROLL_INTENT_MS)
  }

  function updateMessagesScrollStickiness(scrollElement: HTMLElement, hasUserScrollIntent: boolean) {
    shouldStickMessagesToBottomRef.current = resolveAgentMessagesScrollStickiness(scrollElement, {
      currentShouldStick: shouldStickMessagesToBottomRef.current,
      hasUserScrollIntent,
    })
  }

  function cancelMessagesBottomRestore() {
    messagesBottomRestoreRef.current?.cancel()
    messagesBottomRestoreRef.current = null
  }

  function startMessagesBottomRestore(scrollElement: HTMLElement, scrollToBottom: () => void) {
    cancelMessagesBottomRestore()

    const scrollRootElement = scrollElement.closest('.agent-shell')
      ?? scrollElement.closest('.agent-messages-scroll')
      ?? scrollElement

    messagesBottomRestoreRef.current = startAgentMessagesBottomRestore({
      getScrollTop: () => scrollElement.scrollTop,
      scrollRootElement,
      scrollToBottom,
    })
  }

  useEffect(() => {
    const scrollElement = messagesScrollElement
    clearMessagesUserScrollIntent()

    if (!scrollElement) {
      shouldStickMessagesToBottomRef.current = true
      return
    }

    const scrollRootElement = scrollElement.closest('.agent-messages-scroll') ?? scrollElement
    let isScrollbarPointerIntentActive = false

    const stopScrollbarPointerIntent = () => {
      if (!isScrollbarPointerIntentActive) {
        return
      }

      isScrollbarPointerIntentActive = false
      clearMessagesUserScrollIntent()
      window.removeEventListener('pointerup', stopScrollbarPointerIntent)
      window.removeEventListener('pointercancel', stopScrollbarPointerIntent)
    }

    const userScrollIntentListenerOptions = { capture: true, passive: true }

    const handleUserScrollIntent = (event: Event) => {
      if (!isAgentMessageViewportEvent(event, scrollRootElement)) {
        return
      }

      markMessagesUserScrollIntent({ transient: true })
    }

    const handleKeyDown = (event: Event) => {
      if (!(event instanceof globalThis.KeyboardEvent)) {
        return
      }

      if (!isAgentMessageViewportEvent(event, scrollRootElement)) {
        return
      }

      if (event.altKey || event.ctrlKey || event.metaKey) {
        return
      }

      if (isAgentMessagesScrollIntentKey(event.key, event.code)) {
        markMessagesUserScrollIntent({ transient: true })
      }
    }

    const handlePointerDown = (event: Event) => {
      if (!(event instanceof PointerEvent)) {
        return
      }

      if (!isAgentMessageViewportScrollbarPointerEvent(event, scrollElement, scrollRootElement)) {
        return
      }

      if (isScrollbarPointerIntentActive) {
        stopScrollbarPointerIntent()
      }

      isScrollbarPointerIntentActive = true
      markMessagesUserScrollIntent({ transient: false })
      window.addEventListener('pointerup', stopScrollbarPointerIntent)
      window.addEventListener('pointercancel', stopScrollbarPointerIntent)
    }

    const handleScroll = () => {
      updateMessagesScrollStickiness(scrollElement, messagesUserScrollIntentRef.current)
    }

    handleScroll()
    scrollRootElement.addEventListener('wheel', handleUserScrollIntent, userScrollIntentListenerOptions)
    scrollRootElement.addEventListener('touchmove', handleUserScrollIntent, userScrollIntentListenerOptions)
    scrollRootElement.addEventListener('keydown', handleKeyDown)
    scrollElement.addEventListener('scroll', handleScroll, { passive: true })
    scrollRootElement.addEventListener('pointerdown', handlePointerDown, true)

    return () => {
      stopScrollbarPointerIntent()
      clearMessagesUserScrollIntent()
      scrollRootElement.removeEventListener('wheel', handleUserScrollIntent, userScrollIntentListenerOptions)
      scrollRootElement.removeEventListener('touchmove', handleUserScrollIntent, userScrollIntentListenerOptions)
      scrollRootElement.removeEventListener('keydown', handleKeyDown)
      scrollElement.removeEventListener('scroll', handleScroll)
      scrollRootElement.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [activeSessionPath, messagesScrollElement])

  useEffect(() => () => {
    cancelMessagesBottomRestore()
    clearMessagesUserScrollIntent()
  }, [])

  useEffect(() => {
    const scrollElement = messagesScrollElement
    if (!scrollElement || typeof ResizeObserver === 'undefined') {
      return
    }

    let frameId: number | null = null
    const appShellElement = scrollElement.closest<HTMLElement>('.app-shell')
      ?? document.querySelector<HTMLElement>('.app-shell')
    const scrollToBottomIfSticky = () => {
      if (!shouldStickMessagesToBottomRef.current) {
        return
      }

      scrollAgentMessageViewportToBottom(scrollElement)
      shouldStickMessagesToBottomRef.current = true
    }

    const syncPinnedScrollAfterResize = () => {
      if (appShellElement?.getAttribute('data-resizing') === 'true') {
        return
      }

      updateMessagesScrollStickiness(scrollElement, false)

      if (!shouldStickMessagesToBottomRef.current) {
        return
      }

      scrollToBottomIfSticky()

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null
        scrollToBottomIfSticky()
      })
    }

    const resizeObserver = new ResizeObserver(syncPinnedScrollAfterResize)
    resizeObserver.observe(scrollElement)
    window.addEventListener(SIDEBAR_RESIZE_END_EVENT, syncPinnedScrollAfterResize)

    const contentElement = getAgentMessageViewportContentElement(scrollElement)
    if (contentElement) {
      resizeObserver.observe(contentElement)
    }

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener(SIDEBAR_RESIZE_END_EVENT, syncPinnedScrollAfterResize)

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [activeSessionPath, messagesScrollElement])

  useLayoutEffect(() => {
    const scrollElement = messagesScrollElement
    const isSessionChanged = previousSessionPathRef.current !== activeSessionPath
    const isViewportChanged = hasObservedScrollElementRef.current
      && previousScrollElementRef.current !== scrollElement

    if (isSessionChanged || isViewportChanged) {
      cancelMessagesBottomRestore()
    }

    if (!scrollElement) {
      previousScrollElementRef.current = null
      return
    }

    hasObservedScrollElementRef.current = true
    previousSessionPathRef.current = activeSessionPath
    previousScrollElementRef.current = scrollElement

    const forceScrollToBottom = () => {
      scrollAgentMessageViewportToBottom(scrollElement)
      shouldStickMessagesToBottomRef.current = true
    }

    if (isSessionChanged || isViewportChanged) {
      clearMessagesUserScrollIntent()
      startMessagesBottomRestore(scrollElement, forceScrollToBottom)
      return
    }

    updateMessagesScrollStickiness(scrollElement, false)

    if (!shouldStickMessagesToBottomRef.current) {
      return
    }

    forceScrollToBottom()

    const frameId = window.requestAnimationFrame(() => {
      if (shouldStickMessagesToBottomRef.current) {
        forceScrollToBottom()
      }
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [
    activeSessionPath,
    assistantDraft,
    codexNative,
    fileChanges,
    liveTools,
    messagesScrollElement,
    openCodeNative,
    piWebNative,
    renderedMessageCount,
    sessionStatus,
    thinkingDraft,
  ])

  return {
    messagesScrollElement,
    messagesScrollViewportRef,
  }
}
