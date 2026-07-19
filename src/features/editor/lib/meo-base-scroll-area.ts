import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ScrollArea } from '@base-ui/react/scroll-area'
import '@/components/app-scroll-area/styles.css'

type MeoBaseScrollAreaOptions = {
  className?: string
  hostParent: HTMLElement
  viewport: HTMLElement
  withHorizontalScrollbar?: boolean
}

type MeoBaseScrollAreaController = {
  destroy: () => void
  refresh: () => void
}

type DeferredUnmountRoot = Pick<Root, 'unmount'>

type ExternalViewportBridgeProps = React.HTMLAttributes<HTMLDivElement> & {
  viewport: HTMLElement
}

function assignRef<T>(ref: React.ForwardedRef<T>, value: T | null) {
  if (typeof ref === 'function') {
    ref(value)
    return
  }

  if (ref) {
    ref.current = value
  }
}

function splitClassNames(className?: string) {
  return className?.split(/\s+/).filter(Boolean) ?? []
}

function addEventListener<K extends keyof HTMLElementEventMap>(
  element: HTMLElement,
  type: K,
  listener: unknown,
  options?: AddEventListenerOptions,
) {
  if (typeof listener !== 'function') {
    return () => undefined
  }

  const wrapped = (event: HTMLElementEventMap[K]) => {
    listener(event)
  }
  element.addEventListener(type, wrapped, options)
  return () => element.removeEventListener(type, wrapped, options)
}

function scheduleDeferredRootUnmount(root: DeferredUnmountRoot) {
  let didUnmount = false
  const unmount = () => {
    if (didUnmount) {
      return
    }

    didUnmount = true
    root.unmount()
  }

  // This root can be destroyed from a parent React tree cleanup; defer to avoid unmounting
  // a secondary root while React is still committing the parent tree.
  globalThis.setTimeout(unmount, 0)
  return unmount
}

const ExternalViewportBridge = React.forwardRef<HTMLDivElement, ExternalViewportBridgeProps>(
  function ExternalViewportBridge(
    {
      className,
      onKeyDown,
      onPointerEnter,
      onPointerMove,
      onScroll,
      onTouchMove,
      onWheel,
      style,
      viewport,
      ...attributes
    },
    forwardedRef,
  ) {
    React.useLayoutEffect(() => {
      assignRef(forwardedRef, viewport as HTMLDivElement)
      return () => assignRef(forwardedRef, null)
    }, [forwardedRef, viewport])

    React.useLayoutEffect(() => {
      const classNames = [
        ...splitClassNames(className),
        'meo-base-scroll-area-viewport',
      ]
      for (const nextClassName of classNames) {
        viewport.classList.add(nextClassName)
      }

      const previousAttributes = new Map<string, string | null>()
      const setAttribute = (name: string, value: unknown) => {
        previousAttributes.set(name, viewport.getAttribute(name))
        if (value === false || value === null || value === undefined) {
          viewport.removeAttribute(name)
          return
        }
        viewport.setAttribute(name, value === true ? '' : String(value))
      }

      setAttribute('role', attributes.role)
      setAttribute('tabindex', attributes.tabIndex)
      for (const [name, value] of Object.entries(attributes)) {
        if (name.startsWith('data-') || name.startsWith('aria-')) {
          setAttribute(name, value)
        }
      }

      const previousStyleValues = new Map<string, string>()
      if (style) {
        for (const [property, value] of Object.entries(style)) {
          const cssProperty = property.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
          previousStyleValues.set(cssProperty, viewport.style.getPropertyValue(cssProperty))
          viewport.style.setProperty(cssProperty, value == null ? '' : String(value))
        }
      }

      const removeListeners = [
        addEventListener(viewport, 'keydown', onKeyDown),
        addEventListener(viewport, 'pointerenter', onPointerEnter),
        addEventListener(viewport, 'pointermove', onPointerMove),
        addEventListener(viewport, 'scroll', onScroll, { passive: true }),
        addEventListener(viewport, 'touchmove', onTouchMove, { passive: true }),
        addEventListener(viewport, 'wheel', onWheel, { passive: true }),
      ]

      return () => {
        removeListeners.forEach((removeListener) => removeListener())
        for (const nextClassName of classNames) {
          viewport.classList.remove(nextClassName)
        }
        for (const [name, previousValue] of previousAttributes) {
          if (previousValue === null) {
            viewport.removeAttribute(name)
          } else {
            viewport.setAttribute(name, previousValue)
          }
        }
        for (const [property, previousValue] of previousStyleValues) {
          viewport.style.setProperty(property, previousValue)
        }
      }
    }, [
      attributes,
      className,
      onKeyDown,
      onPointerEnter,
      onPointerMove,
      onScroll,
      onTouchMove,
      onWheel,
      style,
      viewport,
    ])

    return null
  },
)

function createMeoBaseScrollAreaElement({
  className,
  viewport,
  withHorizontalScrollbar,
}: {
  className?: string
  viewport: HTMLElement
  withHorizontalScrollbar: boolean
}) {
  const verticalScrollbar = React.createElement(
    ScrollArea.Scrollbar,
    {
      className: 'app-scroll-area-scrollbar meo-base-scroll-area-scrollbar',
      orientation: 'vertical',
    },
    React.createElement(ScrollArea.Thumb, { className: 'app-scroll-area-thumb' }),
  )

  const horizontalParts = withHorizontalScrollbar
    ? [
        React.createElement(
          ScrollArea.Scrollbar,
          {
            className: 'app-scroll-area-scrollbar meo-base-scroll-area-scrollbar',
            key: 'horizontal',
            orientation: 'horizontal',
          },
          React.createElement(ScrollArea.Thumb, { className: 'app-scroll-area-thumb' }),
        ),
        React.createElement(ScrollArea.Corner, {
          className: 'app-scroll-area-corner',
          key: 'corner',
        }),
      ]
    : []

  return React.createElement(
    ScrollArea.Root,
    {
      className: ['app-scroll-area', 'meo-base-scroll-area', className].filter(Boolean).join(' '),
      overflowEdgeThreshold: 0,
    },
    React.createElement(ScrollArea.Viewport, {
      render: React.createElement(ExternalViewportBridge, { viewport }),
    }),
    verticalScrollbar,
    ...horizontalParts,
  )
}

export function mountMeoBaseScrollArea({
  className,
  hostParent,
  viewport,
  withHorizontalScrollbar = true,
}: MeoBaseScrollAreaOptions): MeoBaseScrollAreaController {
  const host = document.createElement('div')
  host.className = 'meo-base-scroll-area-host'
  hostParent.appendChild(host)

  const root: Root = createRoot(host)
  let destroyed = false
  const render = () => {
    if (destroyed) {
      return
    }

    root.render(createMeoBaseScrollAreaElement({
      className,
      viewport,
      withHorizontalScrollbar,
    }))
  }

  const setHovering = (nextValue: boolean) => {
    host.classList.toggle('is-hovering', nextValue)
  }
  const isPointerInsideScrollArea = (target: EventTarget | null) => (
    target instanceof Node && (viewport.contains(target) || host.contains(target))
  )
  const handlePointerEnter = () => setHovering(true)
  const handlePointerLeave = (event: PointerEvent) => {
    if (!isPointerInsideScrollArea(event.relatedTarget)) {
      setHovering(false)
    }
  }
  const handleDocumentPointerMove = (event: PointerEvent) => {
    setHovering(isPointerInsideScrollArea(event.target))
  }
  const handleWindowBlur = () => setHovering(false)

  viewport.addEventListener('pointerenter', handlePointerEnter)
  viewport.addEventListener('pointerleave', handlePointerLeave)
  document.addEventListener('pointermove', handleDocumentPointerMove, { passive: true })
  window.addEventListener('blur', handleWindowBlur)
  render()

  return {
    destroy() {
      if (destroyed) {
        return
      }

      destroyed = true
      viewport.removeEventListener('pointerenter', handlePointerEnter)
      viewport.removeEventListener('pointerleave', handlePointerLeave)
      document.removeEventListener('pointermove', handleDocumentPointerMove)
      window.removeEventListener('blur', handleWindowBlur)
      host.remove()
      scheduleDeferredRootUnmount(root)
    },
    refresh() {
      render()
    },
  }
}

export const __meoBaseScrollAreaTestHooks = {
  scheduleDeferredRootUnmount,
}
