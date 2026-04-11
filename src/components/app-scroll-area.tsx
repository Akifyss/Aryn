import { forwardRef, type ReactNode, type Ref } from 'react'
import { ScrollArea } from '@base-ui/react/scroll-area'
import './app-scroll-area.css'

type AppScrollAreaProps = {
  children: ReactNode
  className?: string
  contentClassName?: string
  overflowEdgeThreshold?: number
  viewportClassName?: string
  viewportRef?: Ref<HTMLDivElement>
  withHorizontalScrollbar?: boolean
}

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export const AppScrollArea = forwardRef<HTMLDivElement, AppScrollAreaProps>(function AppScrollArea(
  {
    children,
    className,
    contentClassName,
    overflowEdgeThreshold,
    viewportClassName,
    viewportRef,
    withHorizontalScrollbar = false,
  },
  forwardedRef,
) {
  return (
    <ScrollArea.Root
      ref={forwardedRef}
      className={joinClasses('app-scroll-area', className)}
      overflowEdgeThreshold={overflowEdgeThreshold}
    >
      <ScrollArea.Viewport
        ref={viewportRef}
        className={joinClasses('app-scroll-area-viewport', viewportClassName)}
      >
        <ScrollArea.Content
          className={joinClasses('app-scroll-area-content', contentClassName)}
          style={{
            minWidth: '100%',
          }}
        >
          {children}
        </ScrollArea.Content>
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
})
