import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { ScrollArea } from '@base-ui/react/scroll-area'
import type { Terminal } from '@xterm/xterm'

/** Bridge xterm's virtual line viewport to the application's Base UI scrollbar.
 * Wheel/TUI mouse reporting remains owned by xterm; no private xterm APIs. */
export function TerminalScrollArea({ terminal, children }: { terminal: Terminal | null; children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null)
  const spacer = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!terminal || !viewport.current || !spacer.current) return
    const element = viewport.current, content = spacer.current
    let frame = 0, cellHeight = 1
    const sync = () => {
      frame = 0
      if (!element.clientHeight) return
      cellHeight = (terminal.element?.querySelector('.xterm-screen')?.getBoundingClientRect().height ?? 0) / terminal.rows || 17
      content.style.height = `${element.clientHeight + terminal.buffer.active.baseY * cellHeight}px`
      const top = terminal.buffer.active.viewportY * cellHeight
      if (Math.abs(element.scrollTop - top) > 1) element.scrollTop = top
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync) }
    const scroll = () => {
      const line = Math.round(element.scrollTop / cellHeight)
      if (line !== terminal.buffer.active.viewportY) terminal.scrollToLine(line)
    }
    const subscriptions = [terminal.onScroll(schedule), terminal.onWriteParsed(schedule), terminal.onResize(schedule)]
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    element.addEventListener('scroll', scroll)
    schedule()
    return () => { cancelAnimationFrame(frame); observer.disconnect(); subscriptions.forEach(item => item.dispose()); element.removeEventListener('scroll', scroll) }
  }, [terminal])
  return <ScrollArea.Root className='app-scroll-area terminal-scroll-area'>
    {children}
    <ScrollArea.Viewport ref={viewport} className='terminal-scroll-proxy' tabIndex={-1} aria-hidden='true'>
      <ScrollArea.Content ref={spacer} />
    </ScrollArea.Viewport>
    <ScrollArea.Scrollbar className='app-scroll-area-scrollbar' orientation='vertical'>
      <ScrollArea.Thumb className='app-scroll-area-thumb' />
    </ScrollArea.Scrollbar>
  </ScrollArea.Root>
}
