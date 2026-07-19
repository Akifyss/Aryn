import type { TransitionEvent as ReactTransitionEvent } from 'react'
import { useCallback, useEffect, useRef } from 'react'

const SIDEBAR_LAYOUT_TRANSITION_FALLBACK_MS = 1000
const SIDEBAR_LAYOUT_TRANSITION_TARGET_SELECTOR = [
  '.titlebar-spacer',
  '.left-chrome-actions',
  '.panel-sidebar',
  '.panel-agent:not(.panel-agent-drawer)',
  '.panel-sidebar > .workspace-sidebar-surface',
  '.panel-agent:not(.panel-agent-drawer) > .agent-shell',
  '.panel-agent:not(.panel-agent-drawer) > .editor-frame',
  '.panel-resize-slot',
  '.file-tabs-shell',
  '.agent-threadbar',
].join(',')

export function useSidebarLayoutTransition(isResizing: boolean) {
  const appShellRef = useRef<HTMLDivElement | null>(null)
  const transitionTimerRef = useRef<number | null>(null)
  const transitionTargetsRef = useRef<HTMLElement[]>([])

  const finishSidebarLayoutTransition = useCallback(() => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current)
      transitionTimerRef.current = null
    }

    for (const target of transitionTargetsRef.current) {
      target.removeAttribute('data-sidebar-transition')
    }

    transitionTargetsRef.current = []
    appShellRef.current?.removeAttribute('data-sidebar-transition')
  }, [])

  const runSidebarLayoutTransition = useCallback((update: () => void) => {
    const shell = appShellRef.current
    if (!shell || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finishSidebarLayoutTransition()
      update()
      return
    }

    finishSidebarLayoutTransition()
    const transitionTargets = [
      shell,
      ...shell.querySelectorAll<HTMLElement>(SIDEBAR_LAYOUT_TRANSITION_TARGET_SELECTOR),
    ]
    transitionTargetsRef.current = transitionTargets
    for (const target of transitionTargets) {
      target.dataset.sidebarTransition = 'true'
    }

    update()
    transitionTimerRef.current = window.setTimeout(() => {
      finishSidebarLayoutTransition()
    }, SIDEBAR_LAYOUT_TRANSITION_FALLBACK_MS)
  }, [finishSidebarLayoutTransition])

  const handleSidebarLayoutTransitionEnd = useCallback((
    event: ReactTransitionEvent<HTMLDivElement>,
  ) => {
    if (event.target === event.currentTarget && event.propertyName === 'grid-template-columns') {
      finishSidebarLayoutTransition()
    }
  }, [finishSidebarLayoutTransition])

  useEffect(() => {
    return finishSidebarLayoutTransition
  }, [finishSidebarLayoutTransition])

  useEffect(() => {
    if (isResizing) {
      finishSidebarLayoutTransition()
    }
  }, [finishSidebarLayoutTransition, isResizing])

  return {
    appShellRef,
    finishSidebarLayoutTransition,
    handleSidebarLayoutTransitionEnd,
    runSidebarLayoutTransition,
  }
}
