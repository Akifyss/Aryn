import {
  forwardRef,
  useCallback,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  type Ref,
  type RefCallback,
} from 'react'
import { ScrollArea } from '@base-ui/react/scroll-area'

type AppScrollAreaProps = {
  children: ReactNode
  className?: string
  contentClassName?: string
  contentWrapper?: boolean
  overflowEdgeThreshold?: number
  rootStyle?: CSSProperties
  viewportClassName?: string
  viewportProps?: Omit<
    ScrollArea.Viewport.Props,
    'children' | 'className' | 'ref'
  >
  viewportRef?: Ref<HTMLDivElement>
  withHorizontalScrollbar?: boolean
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

export const AppScrollArea = forwardRef<HTMLDivElement, AppScrollAreaProps>(
  function AppScrollArea(
    {
      children,
      className,
      contentClassName,
      contentWrapper = true,
      overflowEdgeThreshold,
      rootStyle,
      viewportClassName,
      viewportProps,
      viewportRef,
      withHorizontalScrollbar = false,
    },
    forwardedRef,
  ) {
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
  },
)
