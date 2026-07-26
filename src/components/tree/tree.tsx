import {
  type CSSProperties,
  type HTMLAttributes,
  type LiHTMLAttributes,
  type ReactNode,
  type Ref,
  forwardRef,
} from 'react'
import { AppScrollArea } from '@/components/app-scroll-area'

export type TreeStatusItemTone = 'danger' | 'default'

export type TreeStatusItemProps = LiHTMLAttributes<HTMLLIElement> & {
  tone?: TreeStatusItemTone
}

export type TreeScrollAreaProps = {
  children: ReactNode
  className?: string
  contentClassName?: string
  overflowEdgeThreshold?: number
  rootStyle?: CSSProperties
  viewportClassName?: string
  viewportRef?: Ref<HTMLDivElement>
  withHorizontalScrollbar?: boolean
}

function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

export const TreeList = forwardRef<HTMLUListElement, HTMLAttributes<HTMLUListElement>>(function TreeList(
  { className, ...props },
  ref,
) {
  return <ul ref={ref} className={cx('tree-list', className)} {...props} />
})

export const TreeSection = forwardRef<HTMLLIElement, LiHTMLAttributes<HTMLLIElement>>(function TreeSection(
  { className, ...props },
  ref,
) {
  return <li ref={ref} className={cx('tree-section', className)} {...props} />
})

export const TreeStatusItem = forwardRef<HTMLLIElement, TreeStatusItemProps>(function TreeStatusItem(
  { className, tone = 'default', ...props },
  ref,
) {
  return <li ref={ref} className={cx('tree-status-item', `tree-status-item-${tone}`, className)} {...props} />
})

export const TreeScrollArea = forwardRef<HTMLDivElement, TreeScrollAreaProps>(function TreeScrollArea(
  {
    className,
    contentClassName,
    ...props
  },
  ref,
) {
  return (
    <AppScrollArea
      ref={ref}
      className={cx('tree-scroll-area', className)}
      contentClassName={cx('tree-scroll-area-content', contentClassName)}
      {...props}
    />
  )
})

export const TreeChildren = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function TreeChildren(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cx('tree-children', className)} {...props} />
})
