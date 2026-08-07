import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  type Ref,
  type RefCallback,
} from 'react'
import { ScrollArea } from '@base-ui/react/scroll-area'

type AppScrollAreaSharedProps = {
  className?: string
  rootStyle?: CSSProperties
}

type ManagedAppScrollAreaProps = AppScrollAreaSharedProps & {
  children: ReactNode
  contentClassName?: string
  contentWrapper?: boolean
  getExternalInteractionRoot?: never
  getExternalViewport?: never
  overflowEdgeThreshold?: number
  viewportClassName?: string
  viewportProps?: Omit<
    ScrollArea.Viewport.Props,
    'children' | 'className' | 'ref'
  >
  viewportRef?: Ref<HTMLDivElement>
  withHorizontalScrollbar?: boolean
}

type ExternalAppScrollAreaProps = AppScrollAreaSharedProps & {
  children?: never
  contentClassName?: never
  contentWrapper?: never
  /** Owner used for hover/focus visibility; defaults to the viewport. */
  getExternalInteractionRoot?: () => HTMLElement | null
  /**
   * Adapts AppScrollArea's overlay scrollbar to an existing scroll owner.
   * The external viewport keeps responsibility for scroll position/lifecycle.
   */
  getExternalViewport: () => HTMLElement | null
  overflowEdgeThreshold?: never
  viewportClassName?: never
  viewportProps?: never
  viewportRef?: never
  withHorizontalScrollbar?: never
}

type AppScrollAreaProps = ManagedAppScrollAreaProps | ExternalAppScrollAreaProps

type InternalAppScrollAreaProps = ManagedAppScrollAreaProps & {
  forwardedRef: Ref<HTMLDivElement>
}

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

function mergeRefs<T>(
  ...refs: Array<Ref<T> | RefCallback<T> | undefined | null>
): RefCallback<T> {
  return (value: T | null) => {
    for (const ref of refs) {
      if (typeof ref === 'function') {
        ref(value)
      } else if (ref != null && typeof ref === 'object') {
        ;(ref as MutableRefObject<T | null>).current = value
      }
    }
  }
}

function ExternalAppScrollArea({
  className,
  forwardedRef,
  getExternalInteractionRoot,
  getExternalViewport,
  rootStyle,
}: ExternalAppScrollAreaProps & { forwardedRef: Ref<HTMLDivElement> }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const mergedRootRef = useCallback(
    mergeRefs(rootRef, forwardedRef),
    [forwardedRef],
  )

  useEffect(() => {
    const root = rootRef.current
    const track = trackRef.current
    const thumb = thumbRef.current
    const viewport = getExternalViewport()
    const interactionRoot = getExternalInteractionRoot?.() ?? viewport
    if (!root || !track || !thumb || !viewport || !interactionRoot) return

    let animationFrame = 0
    let dragOffset = 0
    let draggingPointerId: number | null = null
    let scrollingTimeout: number | null = null

    const updateThumb = () => {
      animationFrame = 0
      const trackHeight = track.clientHeight
      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      const hasOverflow = maxScrollTop > 1 && trackHeight > 0
      root.toggleAttribute('data-has-overflow-y', hasOverflow)
      if (!hasOverflow) {
        thumb.style.height = '0px'
        thumb.style.transform = 'translateY(0)'
        return
      }

      const thumbHeight = Math.max(
        18,
        Math.min(trackHeight, trackHeight * (viewport.clientHeight / viewport.scrollHeight)),
      )
      const maxThumbTop = Math.max(0, trackHeight - thumbHeight)
      const thumbTop = maxScrollTop > 0
        ? maxThumbTop * (viewport.scrollTop / maxScrollTop)
        : 0
      thumb.style.height = `${thumbHeight}px`
      thumb.style.transform = `translateY(${thumbTop}px)`
    }

    const scheduleThumbUpdate = () => {
      if (animationFrame) return
      animationFrame = window.requestAnimationFrame(updateThumb)
    }

    const markScrolling = () => {
      root.setAttribute('data-scrolling', '')
      if (scrollingTimeout !== null) window.clearTimeout(scrollingTimeout)
      scrollingTimeout = window.setTimeout(() => {
        scrollingTimeout = null
        root.removeAttribute('data-scrolling')
      }, 600)
      scheduleThumbUpdate()
    }

    const setScrollFromPointer = (clientY: number) => {
      const trackRect = track.getBoundingClientRect()
      const thumbHeight = thumb.getBoundingClientRect().height
      const availableTrack = Math.max(0, trackRect.height - thumbHeight)
      const thumbTop = Math.max(
        0,
        Math.min(availableTrack, clientY - trackRect.top - dragOffset),
      )
      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      viewport.scrollTop = availableTrack > 0
        ? maxScrollTop * (thumbTop / availableTrack)
        : 0
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !root.hasAttribute('data-has-overflow-y')) return

      // A native scrollbar is part of its scroll owner, so its pointerdown is
      // observed by owner-level intent tracking. This overlay is deliberately
      // outside the vendor viewport; forward only to that viewport (without
      // bubbling) so bottom anchoring treats the following scroll as user
      // initiated without duplicating the event on shared ancestors.
      viewport.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: false,
        button: event.button,
        buttons: event.buttons,
        cancelable: true,
        clientX: event.clientX,
        clientY: event.clientY,
        composed: true,
        isPrimary: event.isPrimary,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
      }))

      const thumbRect = thumb.getBoundingClientRect()
      dragOffset = event.target === thumb
        ? event.clientY - thumbRect.top
        : thumbRect.height / 2
      draggingPointerId = event.pointerId
      track.setPointerCapture(event.pointerId)
      track.setAttribute('data-scrolling', '')
      setScrollFromPointer(event.clientY)
      event.preventDefault()
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (draggingPointerId !== event.pointerId) return
      setScrollFromPointer(event.clientY)
      event.preventDefault()
    }

    const stopDragging = (event: PointerEvent) => {
      if (draggingPointerId !== event.pointerId) return
      if (track.hasPointerCapture(event.pointerId)) {
        track.releasePointerCapture(event.pointerId)
      }
      draggingPointerId = null
      track.removeAttribute('data-scrolling')
    }

    const handlePointerEnter = () => root.setAttribute('data-owner-hovering', '')
    const handlePointerLeave = () => root.removeAttribute('data-owner-hovering')
    const handleFocusIn = () => root.setAttribute('data-owner-focus', '')
    const handleFocusOut = (event: FocusEvent) => {
      if (
        event.relatedTarget instanceof Node
        && interactionRoot.contains(event.relatedTarget)
      ) {
        return
      }
      root.removeAttribute('data-owner-focus')
    }

    const resizeObserver = new ResizeObserver(scheduleThumbUpdate)
    resizeObserver.observe(viewport)
    const scrollContent = viewport.firstElementChild
    if (scrollContent instanceof HTMLElement) resizeObserver.observe(scrollContent)
    viewport.addEventListener('scroll', markScrolling, { passive: true })
    interactionRoot.addEventListener('pointerenter', handlePointerEnter)
    interactionRoot.addEventListener('pointerleave', handlePointerLeave)
    interactionRoot.addEventListener('focusin', handleFocusIn)
    interactionRoot.addEventListener('focusout', handleFocusOut)
    track.addEventListener('pointerdown', handlePointerDown)
    track.addEventListener('pointermove', handlePointerMove)
    track.addEventListener('pointerup', stopDragging)
    track.addEventListener('pointercancel', stopDragging)
    scheduleThumbUpdate()

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      if (scrollingTimeout !== null) window.clearTimeout(scrollingTimeout)
      resizeObserver.disconnect()
      viewport.removeEventListener('scroll', markScrolling)
      interactionRoot.removeEventListener('pointerenter', handlePointerEnter)
      interactionRoot.removeEventListener('pointerleave', handlePointerLeave)
      interactionRoot.removeEventListener('focusin', handleFocusIn)
      interactionRoot.removeEventListener('focusout', handleFocusOut)
      track.removeEventListener('pointerdown', handlePointerDown)
      track.removeEventListener('pointermove', handlePointerMove)
      track.removeEventListener('pointerup', stopDragging)
      track.removeEventListener('pointercancel', stopDragging)
    }
  }, [getExternalInteractionRoot, getExternalViewport])

  return (
    <div
      ref={mergedRootRef}
      className={joinClasses(
        'app-scroll-area',
        'app-scroll-area-external-overlay',
        className,
      )}
      style={rootStyle}
    >
      <div
        ref={trackRef}
        className='app-scroll-area-scrollbar'
        data-orientation='vertical'
      >
        <div ref={thumbRef} className='app-scroll-area-thumb' />
      </div>
    </div>
  )
}

function InternalAppScrollArea({
  children,
  className,
  contentClassName,
  contentWrapper = true,
  forwardedRef,
  overflowEdgeThreshold,
  rootStyle,
  viewportClassName,
  viewportProps,
  viewportRef,
  withHorizontalScrollbar = false,
}: InternalAppScrollAreaProps) {
  const resolvedRootStyle = {
    position: 'var(--app-scroll-area-position, relative)',
    ...rootStyle,
  } as CSSProperties

  // base-ui ScrollArea.Viewport merges its own ref internally and ignores
  // `elementProps.ref`, so callers that pass a ref via viewportProps feel
  // it silently break. Extract it here and merge manually.
  const { ref: viewportPropsRef, ...restViewportProps } =
    (viewportProps ?? {}) as Record<string, unknown>
  const mergedViewportRef = useCallback(
    mergeRefs<HTMLDivElement>(
      viewportRef as Ref<HTMLDivElement> | undefined,
      viewportPropsRef as Ref<HTMLDivElement> | undefined,
    ),
    [viewportRef, viewportPropsRef],
  )

  return (
    <ScrollArea.Root
      ref={forwardedRef}
      className={joinClasses('app-scroll-area', className)}
      overflowEdgeThreshold={overflowEdgeThreshold}
      style={resolvedRootStyle}
    >
      <ScrollArea.Viewport
        {...restViewportProps}
        ref={mergedViewportRef}
        className={joinClasses('app-scroll-area-viewport', viewportClassName)}
      >
        {contentWrapper ? (
          <ScrollArea.Content
            className={joinClasses(
              'app-scroll-area-content',
              contentClassName,
            )}
            style={{ minWidth: '100%' }}
          >
            {children}
          </ScrollArea.Content>
        ) : (
          children
        )}
      </ScrollArea.Viewport>

      <ScrollArea.Scrollbar
        className='app-scroll-area-scrollbar'
        orientation='vertical'
      >
        <ScrollArea.Thumb className='app-scroll-area-thumb' />
      </ScrollArea.Scrollbar>

      {withHorizontalScrollbar ? (
        <>
          <ScrollArea.Scrollbar
            className='app-scroll-area-scrollbar'
            orientation='horizontal'
          >
            <ScrollArea.Thumb className='app-scroll-area-thumb' />
          </ScrollArea.Scrollbar>
          <ScrollArea.Corner className='app-scroll-area-corner' />
        </>
      ) : null}
    </ScrollArea.Root>
  )
}

export const AppScrollArea = forwardRef<HTMLDivElement, AppScrollAreaProps>(
  function AppScrollArea(props, forwardedRef) {
    if (props.getExternalViewport) {
      return (
        <ExternalAppScrollArea
          {...props}
          forwardedRef={forwardedRef}
        />
      )
    }

    return <InternalAppScrollArea {...props} forwardedRef={forwardedRef} />
  },
)
