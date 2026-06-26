export const AGENT_MESSAGE_VIRTUALIZATION_ESTIMATED_HEIGHT_PX = 180
export const AGENT_MESSAGE_VIRTUALIZATION_GAP_PX = 12
export const AGENT_MESSAGE_VIRTUALIZATION_OVERSCAN_PX = 900

export type AgentMessageVirtualRange = {
  afterHeight: number
  beforeHeight: number
  endIndex: number
  startIndex: number
  totalHeight: number
}

export type AgentMessageVirtualRangeInput = {
  count: number
  estimatedHeight?: number
  gap?: number
  measuredHeights?: ReadonlyArray<number | null | undefined>
  overscan?: number
  scrollTop: number
  viewportHeight: number
}

export type AgentMessageVirtualItemTopInput = {
  count: number
  estimatedHeight?: number
  gap?: number
  index: number
  measuredHeights?: ReadonlyArray<number | null | undefined>
}

export type AgentMessageVirtualAnchorRestoreInput = {
  anchorIndex: number
  changedIndex: number
}

function getVirtualItemHeight(
  measuredHeights: ReadonlyArray<number | null | undefined>,
  index: number,
  estimatedHeight: number,
) {
  const measuredHeight = measuredHeights[index]
  return typeof measuredHeight === 'number' && Number.isFinite(measuredHeight) && measuredHeight > 0
    ? measuredHeight
    : estimatedHeight
}

export function resolveAgentMessageVirtualRange({
  count,
  estimatedHeight = AGENT_MESSAGE_VIRTUALIZATION_ESTIMATED_HEIGHT_PX,
  gap = AGENT_MESSAGE_VIRTUALIZATION_GAP_PX,
  measuredHeights = [],
  overscan = AGENT_MESSAGE_VIRTUALIZATION_OVERSCAN_PX,
  scrollTop,
  viewportHeight,
}: AgentMessageVirtualRangeInput): AgentMessageVirtualRange {
  if (count <= 0) {
    return {
      afterHeight: 0,
      beforeHeight: 0,
      endIndex: 0,
      startIndex: 0,
      totalHeight: 0,
    }
  }

  const itemOuterHeights = Array.from({ length: count }, (_, index) => (
    getVirtualItemHeight(measuredHeights, index, estimatedHeight)
    + (index < count - 1 ? gap : 0)
  ))
  const totalHeight = itemOuterHeights.reduce((total, height) => total + height, 0)
  const effectiveViewportHeight = Math.max(0, viewportHeight)
  const effectiveScrollTop = Math.min(
    Math.max(0, scrollTop),
    Math.max(0, totalHeight - effectiveViewportHeight),
  )
  const viewStart = Math.max(0, effectiveScrollTop - overscan)
  const viewEnd = Math.min(totalHeight, effectiveScrollTop + effectiveViewportHeight + overscan)

  let startIndex = 0
  let beforeHeight = 0

  while (
    startIndex < count - 1
    && beforeHeight + itemOuterHeights[startIndex] < viewStart
  ) {
    beforeHeight += itemOuterHeights[startIndex]
    startIndex += 1
  }

  let endIndex = startIndex
  let coveredHeight = beforeHeight

  while (endIndex < count && coveredHeight < viewEnd) {
    coveredHeight += itemOuterHeights[endIndex]
    endIndex += 1
  }

  if (endIndex === startIndex) {
    endIndex = Math.min(count, startIndex + 1)
    coveredHeight += itemOuterHeights[startIndex] ?? 0
  }

  return {
    afterHeight: Math.max(0, totalHeight - coveredHeight),
    beforeHeight,
    endIndex,
    startIndex,
    totalHeight,
  }
}

export function resolveAgentMessageVirtualItemTop({
  count,
  estimatedHeight = AGENT_MESSAGE_VIRTUALIZATION_ESTIMATED_HEIGHT_PX,
  gap = AGENT_MESSAGE_VIRTUALIZATION_GAP_PX,
  index,
  measuredHeights = [],
}: AgentMessageVirtualItemTopInput) {
  if (index <= 0 || count <= 0) {
    return 0
  }

  const targetIndex = Math.min(index, count - 1)
  let itemTop = 0
  for (let itemIndex = 0; itemIndex < targetIndex; itemIndex += 1) {
    itemTop += getVirtualItemHeight(measuredHeights, itemIndex, estimatedHeight)
    if (itemIndex < count - 1) {
      itemTop += gap
    }
  }

  return itemTop
}

export function shouldRestoreAgentMessageVirtualAnchor({
  anchorIndex,
  changedIndex,
}: AgentMessageVirtualAnchorRestoreInput) {
  return changedIndex >= 0 && anchorIndex >= 0 && changedIndex < anchorIndex
}
