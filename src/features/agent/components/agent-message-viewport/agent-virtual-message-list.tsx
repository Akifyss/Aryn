import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AGENT_MESSAGE_VIRTUALIZATION_GAP_PX,
  resolveAgentMessageVirtualItemTop,
  resolveAgentMessageVirtualRange,
  shouldRestoreAgentMessageVirtualAnchor,
} from '@/features/agent/lib/message-virtualization'

const AGENT_MESSAGE_VIRTUALIZATION_INITIAL_VIEWPORT_HEIGHT = 900
const AGENT_MESSAGE_VIRTUALIZATION_BOTTOM_ANCHOR_THRESHOLD_PX = 24

export type AgentVirtualMessageListItem = {
  content: ReactNode
  key: string
}

type AgentVirtualMessageAnchor = {
  index: number
  key: string
  offset: number
}

function AgentMessageVirtualSpacer({ height }: { height: number }) {
  if (height <= 0) {
    return null
  }

  return (
    <div
      aria-hidden='true'
      className='agent-message-virtual-spacer'
      style={{ height }}
    />
  )
}

function AgentMessageVirtualRow({
  children,
  itemKey,
  itemIndex,
  isLast,
  onHeightChange,
}: {
  children: ReactNode
  itemKey: string
  itemIndex: number
  isLast: boolean
  onHeightChange: (index: number, key: string, height: number) => void
}) {
  const rowRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const rowElement = rowRef.current
    if (!rowElement || typeof ResizeObserver === 'undefined') {
      return
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height
      if (typeof height === 'number') {
        onHeightChange(itemIndex, itemKey, height)
      }
    })

    resizeObserver.observe(rowElement)

    return () => {
      resizeObserver.disconnect()
    }
  }, [itemIndex, itemKey, onHeightChange])

  return (
    <div
      ref={rowRef}
      className='agent-message-stack agent-message-virtual-row'
      data-agent-message-index={itemIndex}
      data-agent-message-key={itemKey}
      style={{
        marginBottom: isLast ? 0 : AGENT_MESSAGE_VIRTUALIZATION_GAP_PX,
      }}
    >
      {children}
    </div>
  )
}

export function AgentVirtualMessageList({
  activeSessionPath,
  items,
  messagesScrollElement,
}: {
  activeSessionPath: string | null
  items: AgentVirtualMessageListItem[]
  messagesScrollElement: HTMLDivElement | null
}) {
  const [viewportState, setViewportState] = useState(() => ({
    scrollTop: Number.MAX_SAFE_INTEGER,
    viewportHeight: AGENT_MESSAGE_VIRTUALIZATION_INITIAL_VIEWPORT_HEIGHT,
  }))
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({})
  const anchorRestorePendingRef = useRef(false)
  const virtualAnchorRef = useRef<AgentVirtualMessageAnchor | null>(null)
  const measuredHeightsRef = useRef<Record<string, number>>({})

  useEffect(() => {
    anchorRestorePendingRef.current = false
    measuredHeightsRef.current = {}
    virtualAnchorRef.current = null
    setMeasuredHeights({})
    setViewportState({
      scrollTop: Number.MAX_SAFE_INTEGER,
      viewportHeight: AGENT_MESSAGE_VIRTUALIZATION_INITIAL_VIEWPORT_HEIGHT,
    })
  }, [activeSessionPath])

  const isScrollElementNearBottom = useCallback((scrollElement: HTMLElement) => (
    scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight
      <= AGENT_MESSAGE_VIRTUALIZATION_BOTTOM_ANCHOR_THRESHOLD_PX
  ), [])

  const captureVisibleAnchor = useCallback((scrollElement: HTMLElement) => {
    if (isScrollElementNearBottom(scrollElement)) {
      virtualAnchorRef.current = null
      return false
    }

    const viewportRect = scrollElement.getBoundingClientRect()
    const rowElements = Array.from(scrollElement.querySelectorAll<HTMLElement>('.agent-message-virtual-row'))
    let firstVisibleRow: HTMLElement | null = null
    let firstVisibleRect: DOMRect | null = null
    let topCrossingRow: HTMLElement | null = null
    let topCrossingRect: DOMRect | null = null

    for (const rowElement of rowElements) {
      const rowRect = rowElement.getBoundingClientRect()
      if (rowRect.bottom <= viewportRect.top || rowRect.top >= viewportRect.bottom) {
        continue
      }

      if (!firstVisibleRow) {
        firstVisibleRow = rowElement
        firstVisibleRect = rowRect
      }

      if (rowRect.top <= viewportRect.top + 1 && rowRect.bottom > viewportRect.top + 1) {
        topCrossingRow = rowElement
        topCrossingRect = rowRect
        break
      }
    }

    const anchorRow = topCrossingRow ?? firstVisibleRow
    const anchorRect = topCrossingRect ?? firstVisibleRect
    const key = anchorRow?.dataset.agentMessageKey
    const index = Number(anchorRow?.dataset.agentMessageIndex)
    if (!anchorRow || !anchorRect || !key || !Number.isInteger(index) || index < 0) {
      virtualAnchorRef.current = null
      return false
    }

    virtualAnchorRef.current = {
      index,
      key,
      offset: topCrossingRow ? Math.max(0, viewportRect.top - anchorRect.top) : 0,
    }
    return true
  }, [isScrollElementNearBottom])

  const restoreVisibleAnchor = useCallback(() => {
    const scrollElement = messagesScrollElement
    const anchor = virtualAnchorRef.current
    if (!scrollElement || !anchor || isScrollElementNearBottom(scrollElement)) {
      return
    }

    const itemIndex = items.findIndex((item) => item.key === anchor.key)
    if (itemIndex < 0) {
      virtualAnchorRef.current = null
      return
    }

    const nextScrollTop = Math.max(0, resolveAgentMessageVirtualItemTop({
      count: items.length,
      index: itemIndex,
      measuredHeights: items.map((item) => measuredHeightsRef.current[item.key]),
    }) + anchor.offset)

    if (Math.abs(scrollElement.scrollTop - nextScrollTop) > 1) {
      scrollElement.scrollTop = nextScrollTop
      setViewportState({
        scrollTop: scrollElement.scrollTop,
        viewportHeight: scrollElement.clientHeight,
      })
    }
  }, [isScrollElementNearBottom, items, messagesScrollElement])

  useLayoutEffect(() => {
    if (!anchorRestorePendingRef.current) {
      return
    }

    anchorRestorePendingRef.current = false
    restoreVisibleAnchor()
  }, [measuredHeights, restoreVisibleAnchor])

  useLayoutEffect(() => {
    const scrollElement = messagesScrollElement
    if (!scrollElement) {
      return
    }

    let frameId: number | null = null
    const syncViewportState = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null
        setViewportState({
          scrollTop: scrollElement.scrollTop,
          viewportHeight: scrollElement.clientHeight,
        })
        captureVisibleAnchor(scrollElement)
      })
    }

    syncViewportState()
    scrollElement.addEventListener('scroll', syncViewportState, { passive: true })

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(syncViewportState)
    resizeObserver?.observe(scrollElement)

    return () => {
      scrollElement.removeEventListener('scroll', syncViewportState)
      resizeObserver?.disconnect()

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [captureVisibleAnchor, items.length, messagesScrollElement])

  const handleHeightChange = useCallback((index: number, key: string, height: number) => {
    const currentHeights = measuredHeightsRef.current
    if (Math.abs((currentHeights[key] ?? 0) - height) < 1) {
      return
    }

    const itemIndex = items[index]?.key === key
      ? index
      : items.findIndex((item) => item.key === key)
    if (itemIndex < 0) {
      return
    }

    const scrollElement = messagesScrollElement
    if (scrollElement && captureVisibleAnchor(scrollElement)) {
      const anchor = virtualAnchorRef.current
      if (anchor && shouldRestoreAgentMessageVirtualAnchor({
        anchorIndex: anchor.index,
        changedIndex: itemIndex,
      })) {
        anchorRestorePendingRef.current = true
      }
    }

    const nextHeights = {
      ...currentHeights,
      [key]: height,
    }
    measuredHeightsRef.current = nextHeights
    setMeasuredHeights(nextHeights)
  }, [captureVisibleAnchor, items, messagesScrollElement])

  const virtualRange = useMemo(() => resolveAgentMessageVirtualRange({
    count: items.length,
    measuredHeights: items.map((item) => measuredHeights[item.key]),
    scrollTop: viewportState.scrollTop,
    viewportHeight: viewportState.viewportHeight,
  }), [items, measuredHeights, viewportState.scrollTop, viewportState.viewportHeight])
  const visibleItems = items.slice(virtualRange.startIndex, virtualRange.endIndex)

  return (
    <>
      <AgentMessageVirtualSpacer height={virtualRange.beforeHeight} />
      {visibleItems.map((item, visibleIndex) => {
        const itemIndex = virtualRange.startIndex + visibleIndex
        const isLast = itemIndex === items.length - 1

        return (
          <AgentMessageVirtualRow
            key={item.key}
            itemKey={item.key}
            itemIndex={itemIndex}
            isLast={isLast}
            onHeightChange={handleHeightChange}
          >
            {item.content}
          </AgentMessageVirtualRow>
        )
      })}
      <AgentMessageVirtualSpacer height={virtualRange.afterHeight} />
    </>
  )
}
