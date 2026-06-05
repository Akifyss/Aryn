export const AGENT_MESSAGES_SCROLL_STICKY_THRESHOLD_PX = 24

type AgentMessagesScrollMetrics = Pick<HTMLElement, 'clientHeight' | 'scrollHeight' | 'scrollTop'>

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
