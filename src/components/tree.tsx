import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type LiHTMLAttributes,
  type ReactNode,
  type Ref,
  forwardRef,
} from 'react'
import {
  DownLine,
  RightLine,
} from '@mingcute/react'
import { AppScrollArea } from '@/components/app-scroll-area'

type TreeItemState = {
  isActive?: boolean
  isDragSource?: boolean
  isDropTarget?: boolean
  isEditing?: boolean
  isMenuOpen?: boolean
}

type TreeRowState = TreeItemState & {
  hasActions?: boolean
  hasDescription?: boolean
  hasInfo?: boolean
  hasVisibleActions?: boolean
}

export type TreeItemInfoVariant = 'count' | 'status' | 'summary' | 'text'
export type TreeItemStatusTone = 'danger' | 'neutral' | 'success' | 'warning'
export type TreeItemVariant = 'default' | 'header'
export type TreeStatusItemTone = 'danger' | 'default'

export type TreeItemTextSlotProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'className'> & {
  className?: string
}

export type TreeItemInfoSlotProps = TreeItemTextSlotProps

type TreeItemSlot = ReactNode | (() => ReactNode)

type TreeItemMainState = {
  hasDescription?: boolean
}

export type TreeItemMainButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & TreeItemMainState
export type TreeItemMainRenderProps = TreeItemMainState & {
  className?: string
}
export type TreeItemMainRenderer = (content: ReactNode, mainProps: TreeItemMainRenderProps) => ReactNode

type TreeItemMainContentProps = {
  description?: ReactNode
  descriptionClassName?: string
  descriptionProps?: TreeItemTextSlotProps
  icon?: ReactNode
  label?: ReactNode
  labelClassName?: string
  labelProps?: TreeItemTextSlotProps
  labelSuffix?: ReactNode
}

export type TreeItemProps = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className' | 'onToggle'> & TreeItemState & {
  actions?: TreeItemSlot
  actionsAlwaysVisible?: boolean
  actionsClassName?: string
  actionsProps?: HTMLAttributes<HTMLDivElement>
  after?: ReactNode
  description?: ReactNode
  descriptionClassName?: string
  descriptionProps?: TreeItemTextSlotProps
  end?: ReactNode
  icon?: ReactNode
  info?: ReactNode
  infoClassName?: string
  infoProps?: TreeItemInfoSlotProps
  infoVariant?: TreeItemInfoVariant
  isExpanded?: boolean
  itemAs?: 'div' | 'li'
  itemClassName?: string
  label?: ReactNode
  labelClassName?: string
  labelProps?: TreeItemTextSlotProps
  labelSuffix?: ReactNode
  main?: ReactNode
  mainButtonProps?: Omit<TreeItemMainButtonProps, 'children' | 'className'> & { className?: string }
  mainClassName?: string
  renderMain?: TreeItemMainRenderer
  rowClassName?: string
  toggleAriaLabel?: string
  variant?: TreeItemVariant
  onToggle?: () => void
}

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

const treeClassNames = {
  action: (className?: string) => cx('tree-item-action', className),
  actions: (className?: string) => cx('tree-item-actions', className),
  children: (className?: string) => cx('tree-item-children', className),
  description: (className?: string) => cx('tree-item-description', className),
  icon: (className?: string) => cx('tree-item-icon', className),
  info: (variant: TreeItemInfoVariant, className?: string) => cx('tree-item-info', `tree-item-info-${variant}`, className),
  label: (className?: string) => cx('tree-item-label', className),
  main: (className?: string) => cx('tree-item-main', className),
  end: (className?: string) => cx('tree-item-end', className),
  row: (className?: string) => cx('tree-item-row', className),
  statusDot: (tone: TreeItemStatusTone, className?: string) => cx('tree-item-status-dot', `tree-item-status-dot-${tone}`, className),
}

function treeRowStateClassName({
  hasActions,
  hasDescription,
  hasInfo,
  hasVisibleActions,
  isActive,
  isDragSource,
  isDropTarget,
  isEditing,
  isMenuOpen,
}: TreeRowState) {
  return cx(
    hasActions && 'has-actions',
    hasDescription && 'has-description',
    hasInfo && 'has-info',
    hasVisibleActions && 'has-visible-actions',
    isActive && 'is-active',
    isDragSource && 'is-drag-source',
    isDropTarget && 'is-drop-target',
    isEditing && 'is-editing',
    isMenuOpen && 'is-menu-open',
  )
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

const TreeItemRow = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & TreeRowState>(function TreeItemRow(
  {
    className,
    hasActions,
    hasDescription,
    hasInfo,
    hasVisibleActions,
    isActive,
    isDragSource,
    isDropTarget,
    isEditing,
    isMenuOpen,
    ...props
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={treeClassNames.row(cx(
        treeRowStateClassName({
          hasActions,
          hasDescription,
          hasInfo,
          hasVisibleActions,
          isActive,
          isDragSource,
          isDropTarget,
          isEditing,
          isMenuOpen,
        }),
        className,
      ))}
      {...props}
    />
  )
})

// A tree item owns the semantic list item while exposing the row as the interactive layout surface.
export const TreeItem = forwardRef<HTMLDivElement, TreeItemProps>(function TreeItem(
  {
    actions,
    actionsAlwaysVisible,
    actionsClassName,
    actionsProps,
    after,
    description,
    descriptionClassName,
    descriptionProps,
    end,
    icon,
    info,
    infoClassName,
    infoProps,
    infoVariant,
    isExpanded,
    itemAs,
    itemClassName,
    label,
    labelClassName,
    labelProps,
    labelSuffix,
    main,
    mainButtonProps,
    mainClassName,
    renderMain,
    rowClassName,
    toggleAriaLabel,
    variant = 'default',
    onToggle,
    isActive,
    isDragSource,
    isDropTarget,
    isEditing,
    isMenuOpen,
    ...props
  },
  ref,
) {
  const isHeader = variant === 'header'
  const isHeaderToggleable = isHeader && typeof isExpanded === 'boolean' && Boolean(onToggle)
  const renderedActions = typeof actions === 'function' ? actions() : actions
  const hasActions = renderedActions !== undefined && renderedActions !== null && renderedActions !== false
  const hasInfo = info !== undefined && info !== null && info !== false
  const renderedHeaderChevron = isHeaderToggleable
    ? isExpanded
      ? <DownLine className='tree-item-chevron tree-item-chevron-box' size={16} aria-hidden='true' />
      : <RightLine className='tree-item-chevron tree-item-chevron-box' size={16} aria-hidden='true' />
    : null
  const hasLabelSuffix = labelSuffix !== undefined && labelSuffix !== null && labelSuffix !== false
  const resolvedLabelSuffix = hasLabelSuffix || renderedHeaderChevron
    ? (
      <>
        {labelSuffix}
        {renderedHeaderChevron}
      </>
    )
    : undefined
  const effectiveInfoVariant = infoVariant ?? (isHeader ? 'count' : 'text')
  const effectiveItemAs = itemAs ?? (isHeader ? 'div' : 'li')
  const effectiveItemClassName = cx(isHeader && 'tree-header', itemClassName)
  const hasConfiguredContent = icon !== undefined || label !== undefined || description !== undefined || resolvedLabelSuffix !== undefined
  const hasDescription = description !== undefined && description !== null && description !== false
  const mainRenderProps: TreeItemMainRenderProps = {
    hasDescription,
    className: cx(mainClassName, mainButtonProps?.className),
  }
  const mainContent = hasConfiguredContent ? (
    <TreeItemMainContent
      description={description}
      descriptionClassName={descriptionClassName}
      descriptionProps={descriptionProps}
      icon={icon}
      label={label}
      labelClassName={labelClassName}
      labelProps={labelProps}
      labelSuffix={resolvedLabelSuffix}
    />
  ) : null
  const resolvedMainButtonProps: TreeItemMainButtonProps = {
    ...(isHeaderToggleable ? {
      'aria-expanded': isExpanded,
      'aria-label': toggleAriaLabel,
      onClick: onToggle,
    } : {}),
    ...mainButtonProps,
    ...mainRenderProps,
  }
  const defaultMain = main ?? (hasConfiguredContent ? (
    renderMain ? renderMain(mainContent, mainRenderProps) : isHeader && !isHeaderToggleable ? (
      <TreeItemMain {...mainRenderProps}>
        {mainContent}
      </TreeItemMain>
    ) : (
      <TreeItemMainButton {...resolvedMainButtonProps}>
        {mainContent}
      </TreeItemMainButton>
    )
  ) : null)
  const defaultEnd = end ?? (hasActions || hasInfo ? (
    <TreeItemEnd>
      {hasActions ? (
        <TreeItemActions
          {...actionsProps}
          className={cx(actionsClassName, actionsProps?.className)}
        >
          {renderedActions}
        </TreeItemActions>
      ) : null}
      {hasInfo ? (
        <TreeItemInfo
          {...infoProps}
          variant={effectiveInfoVariant}
          className={cx(infoClassName, infoProps?.className)}
        >
          {info}
        </TreeItemInfo>
      ) : null}
    </TreeItemEnd>
  ) : null)

  const ItemElement = effectiveItemAs

  return (
    <ItemElement className={cx('tree-item', effectiveItemClassName)}>
      <TreeItemRow
        ref={ref}
        className={rowClassName}
        hasActions={hasActions}
        hasDescription={hasDescription}
        hasInfo={hasInfo}
        hasVisibleActions={hasActions && actionsAlwaysVisible}
        isActive={isActive}
        isDragSource={isDragSource}
        isDropTarget={isDropTarget}
        isEditing={isEditing}
        isMenuOpen={isMenuOpen}
        {...props}
      >
        {defaultMain}
        {defaultEnd}
      </TreeItemRow>
      {after}
    </ItemElement>
  )
})

export const TreeItemMain = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & TreeItemMainState>(function TreeItemMain(
  { className, hasDescription, ...props },
  ref,
) {
  return <div ref={ref} className={treeClassNames.main(cx(hasDescription && 'has-description', className))} {...props} />
})

export const TreeItemMainButton = forwardRef<HTMLButtonElement, TreeItemMainButtonProps>(function TreeItemMainButton(
  { className, hasDescription, type = 'button', ...props },
  ref,
) {
  return <button ref={ref} type={type} className={treeClassNames.main(cx(hasDescription && 'has-description', className))} {...props} />
})

function TreeItemMainContent({
  description,
  descriptionClassName,
  descriptionProps,
  icon,
  label,
  labelClassName,
  labelProps,
  labelSuffix,
}: TreeItemMainContentProps) {
  const hasDescription = description !== undefined && description !== null && description !== false
  const hasLabel = label !== undefined && label !== null && label !== false

  return (
    <>
      {icon}
      {hasLabel ? (
        <TreeItemLabel
          {...labelProps}
          className={cx(labelClassName, labelProps?.className)}
        >
          {label}
        </TreeItemLabel>
      ) : null}
      {labelSuffix}
      {hasDescription ? (
        <span
          {...descriptionProps}
          className={treeClassNames.description(cx(descriptionClassName, descriptionProps?.className))}
        >
          {description}
        </span>
      ) : null}
    </>
  )
}

export const TreeItemChildren = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function TreeItemChildren(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={treeClassNames.children(className)} {...props} />
})

const TreeItemEnd = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { children?: ReactNode }>(
  function TreeItemEnd(
    { children, className, ...props },
    ref,
  ) {
    return (
      <div ref={ref} className={treeClassNames.end(className)} {...props}>
        {children}
      </div>
    )
  },
)

const TreeItemActions = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function TreeItemActions(
    { className, ...props },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={treeClassNames.actions(className)}
        {...props}
      />
    )
  },
)

export const TreeItemActionButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function TreeItemActionButton(
  { className, type = 'button', ...props },
  ref,
) {
  return <button ref={ref} type={type} className={treeClassNames.action(className)} {...props} />
})

export const TreeItemIcon = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(function TreeItemIcon(
  { className, ...props },
  ref,
) {
  return <span ref={ref} className={treeClassNames.icon(className)} aria-hidden='true' {...props} />
})

const TreeItemLabel = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(function TreeItemLabel(
  { className, ...props },
  ref,
) {
  return <span ref={ref} className={treeClassNames.label(className)} {...props} />
})

const TreeItemInfo = forwardRef<
  HTMLSpanElement,
  HTMLAttributes<HTMLSpanElement> & { variant?: TreeItemInfoVariant }
>(function TreeItemInfo(
  { className, variant = 'text', ...props },
  ref,
) {
  return <span ref={ref} className={treeClassNames.info(variant, className)} {...props} />
})

export const TreeItemStatusDot = forwardRef<
  HTMLSpanElement,
  HTMLAttributes<HTMLSpanElement> & { tone?: TreeItemStatusTone }
>(function TreeItemStatusDot(
  {
    className,
    tone = 'neutral',
    'aria-hidden': ariaHidden,
    'aria-label': ariaLabel,
    ...props
  },
  ref,
) {
  return (
    <span
      ref={ref}
      className={treeClassNames.statusDot(tone, className)}
      role={ariaLabel ? 'img' : undefined}
      aria-hidden={ariaHidden ?? (ariaLabel ? undefined : true)}
      aria-label={ariaLabel}
      {...props}
    />
  )
})
