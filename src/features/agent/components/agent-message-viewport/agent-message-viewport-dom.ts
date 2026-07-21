export function getAgentMessageViewportContentElement(scrollElement: HTMLElement) {
  for (const childElement of Array.from(scrollElement.children)) {
    if (
      childElement instanceof HTMLElement
      && childElement.classList.contains('agent-messages-scroll-content')
    ) {
      return childElement
    }
  }

  const firstChildElement = scrollElement.firstElementChild
  return firstChildElement instanceof HTMLElement ? firstChildElement : null
}

export function scrollAgentMessageViewportToBottom(scrollElement: HTMLElement) {
  scrollElement.scrollTop = Number.MAX_SAFE_INTEGER
}

function getAgentMessageViewportEventTarget(event: Event) {
  const target = event.target
  if (target instanceof Element) {
    return target
  }

  return target instanceof Node ? target.parentElement : null
}

export function isAgentMessageViewportEvent(event: Event, scrollRootElement: Element) {
  return getAgentMessageViewportEventTarget(event)?.closest('.app-scroll-area') === scrollRootElement
}

export function isAgentMessageViewportScrollbarPointerEvent(
  event: PointerEvent,
  scrollElement: HTMLElement,
  scrollRootElement: Element,
) {
  const targetElement = getAgentMessageViewportEventTarget(event)
  const scrollbarElement = targetElement?.closest('.app-scroll-area-scrollbar, .app-scroll-area-thumb')

  if (scrollbarElement?.closest('.app-scroll-area') === scrollRootElement) {
    return true
  }

  if (targetElement !== scrollElement) {
    return false
  }

  const rect = scrollElement.getBoundingClientRect()
  const verticalScrollbarWidth = scrollElement.offsetWidth - scrollElement.clientWidth
  const horizontalScrollbarHeight = scrollElement.offsetHeight - scrollElement.clientHeight

  return (
    (verticalScrollbarWidth > 0 && event.clientX >= rect.right - verticalScrollbarWidth)
    || (horizontalScrollbarHeight > 0 && event.clientY >= rect.bottom - horizontalScrollbarHeight)
  )
}
