export const AGENT_MESSAGES_SCROLL_STICKY_THRESHOLD_PX = 24

type AgentMessagesScrollMetrics = Pick<HTMLElement, 'clientHeight' | 'scrollHeight' | 'scrollTop'>

const AGENT_MESSAGES_SCROLL_INTENT_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
  'Space',
  'Spacebar',
])

export function shouldStickAgentMessagesToBottom(
  scrollElement: AgentMessagesScrollMetrics,
  threshold = AGENT_MESSAGES_SCROLL_STICKY_THRESHOLD_PX,
) {
  const maxScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)

  if (maxScrollTop <= threshold) {
    return true
  }

  return maxScrollTop - scrollElement.scrollTop <= threshold
}

export function resolveAgentMessagesScrollStickiness(
  scrollElement: AgentMessagesScrollMetrics,
  {
    currentShouldStick,
    hasUserScrollIntent,
    threshold = AGENT_MESSAGES_SCROLL_STICKY_THRESHOLD_PX,
  }: {
    currentShouldStick: boolean
    hasUserScrollIntent: boolean
    threshold?: number
  },
) {
  if (currentShouldStick && !hasUserScrollIntent) {
    return true
  }

  if (shouldStickAgentMessagesToBottom(scrollElement, threshold)) {
    return true
  }

  if (hasUserScrollIntent) {
    return false
  }

  return currentShouldStick
}

export function isAgentMessagesScrollIntentKey(key: string, code?: string) {
  return AGENT_MESSAGES_SCROLL_INTENT_KEYS.has(key) || code === 'Space'
}
