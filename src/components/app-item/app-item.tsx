import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  forwardRef,
  useEffect,
  useRef,
  useState,
} from 'react'
import { DownLine, RightLine } from '@mingcute/react'
import { AppIconButton } from '@/components/app-icon-button'
import { AppTooltip, AppTooltipButton } from '@/components/app-tooltip'

export type AppItemState = {
  isActive?: boolean
  isDragSource?: boolean
  isDropTarget?: boolean
  isEditing?: boolean
  isMenuOpen?: boolean
}

type AppItemRowState = AppItemState & {
  hasActions?: boolean
  hasDescription?: boolean
  hasInfo?: boolean
  hasVisibleActions?: boolean
}

export type AppItemInfoVariant = 'count' | 'status' | 'summary' | 'text'
export type AppItemStatusTone = 'danger' | 'neutral' | 'success' | 'warning'
export type AppItemVariant = 'default' | 'header'

export type AppItemTextSlotProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'className'> & {
  className?: string
}

export type AppItemInfoSlotProps = AppItemTextSlotProps

type AppItemSlot = ReactNode | (() => ReactNode)

export type AppItemMainState = {
  hasDescription?: boolean
}

export type AppItemMainButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & AppItemMainState
export type AppItemActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tooltip?: ReactNode
}
export type AppItemMainRenderProps = AppItemMainState & {
  className?: string
}
export type AppItemMainRenderer = (content: ReactNode, mainProps: AppItemMainRenderProps) => ReactNode

export type AppItemProps = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className' | 'onToggle'> & AppItemState & {
  actions?: AppItemSlot
  actionsAlwaysVisible?: boolean
  actionsClassName?: string
  actionsProps?: HTMLAttributes<HTMLDivElement>
  after?: ReactNode
  children?: ReactNode
  className?: string
  description?: ReactNode
  descriptionClassName?: string
  descriptionProps?: AppItemTextSlotProps
  end?: ReactNode
  icon?: ReactNode
  info?: ReactNode
  infoClassName?: string
  infoProps?: AppItemInfoSlotProps
  infoVariant?: AppItemInfoVariant
  isExpanded?: boolean
  itemAs?: 'div' | 'li' | null
  itemClassName?: string
  label?: ReactNode
  labelClassName?: string
  labelProps?: AppItemTextSlotProps
  labelSuffix?: ReactNode
  main?: ReactNode
  mainButtonProps?: Omit<AppItemMainButtonProps, 'children' | 'className'> & { className?: string }
  mainClassName?: string
  mainKind?: 'button' | 'static'
  renderMain?: AppItemMainRenderer
  rowClassName?: string
  toggleAriaLabel?: string
  variant?: AppItemVariant
  onToggle?: () => void
}

type AppItemMainContentProps = {
  description?: ReactNode
  descriptionClassName?: string
  descriptionProps?: AppItemTextSlotProps
  icon?: ReactNode
  label?: ReactNode
  labelClassName?: string
  labelProps?: AppItemTextSlotProps
  labelSuffix?: ReactNode
}

function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

const appItemClassNames = {
  action: (className?: string) => cx('app-item-action', className),
  actions: (className?: string) => cx('app-item-actions', className),
  description: (className?: string) => cx('app-item-description', className),
  end: (className?: string) => cx('app-item-end', className),
  icon: (className?: string) => cx('app-item-icon', className),
  info: (variant: AppItemInfoVariant, className?: string) => cx('app-item-info', `app-item-info-${variant}`, className),
  label: (className?: string) => cx('app-item-label', className),
  main: (className?: string) => cx('app-item-main', className),
  row: (className?: string) => cx('app-item-row', className),
  statusDot: (tone: AppItemStatusTone, className?: string) => cx('app-item-status-dot', `app-item-status-dot-${tone}`, className),
}

function appItemRowStateClassName({
  hasActions,
  hasDescription,
  hasInfo,
  hasVisibleActions,
  isActive,
  isDragSource,
  isDropTarget,
  isEditing,
  isMenuOpen,
}: AppItemRowState) {
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

export const AppItem = forwardRef<HTMLDivElement, AppItemProps>(function AppItem(
  {
    actions,
    actionsAlwaysVisible,
    actionsClassName,
    actionsProps,
    after,
    children,
    className,
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
    mainKind,
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
      ? <DownLine className='app-item-chevron app-item-chevron-box' size={16} aria-hidden='true' />
      : <RightLine className='app-item-chevron app-item-chevron-box' size={16} aria-hidden='true' />
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
  const effectiveItemAs = itemAs === undefined ? (isHeader ? 'div' : 'li') : itemAs
  const effectiveMainKind = mainKind ?? (isHeader && !isHeaderToggleable ? 'static' : 'button')
  const resolvedMainButtonProps: AppItemMainButtonProps = {
    ...(isHeaderToggleable ? {
      'aria-expanded': isExpanded,
      'aria-label': toggleAriaLabel,
      onClick: onToggle,
    } : {}),
    ...mainButtonProps,
  }
  const hasConfiguredContent = children !== undefined
    || icon !== undefined
    || label !== undefined
    || description !== undefined
    || resolvedLabelSuffix !== undefined
  const hasDescription = description !== undefined && description !== null && description !== false
  const mainRenderProps: AppItemMainRenderProps = {
    hasDescription,
    className: cx(mainClassName, resolvedMainButtonProps.className),
  }
  const mainContent = children !== undefined ? children : hasConfiguredContent ? (
    <AppItemMainContent
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
  const defaultMain = main ?? (hasConfiguredContent ? (
    renderMain ? renderMain(mainContent, mainRenderProps) : effectiveMainKind === 'static' ? (
      <AppItemMain {...mainRenderProps}>
        {mainContent}
      </AppItemMain>
    ) : (
      <AppItemMainButton
        {...resolvedMainButtonProps}
        {...mainRenderProps}
      >
        {mainContent}
      </AppItemMainButton>
    )
  ) : null)
  const defaultEnd = end ?? (hasActions || hasInfo ? (
    <AppItemEnd>
      {hasActions ? (
        <AppItemActions
          {...actionsProps}
          className={cx(actionsClassName, actionsProps?.className)}
        >
          {renderedActions}
        </AppItemActions>
      ) : null}
      {hasInfo ? (
        <AppItemInfo
          {...infoProps}
          variant={effectiveInfoVariant}
          className={cx(infoClassName, infoProps?.className)}
        >
          {info}
        </AppItemInfo>
      ) : null}
    </AppItemEnd>
  ) : null)

  const row = (
    <div
      ref={ref}
      className={appItemClassNames.row(cx(
        appItemRowStateClassName({
          hasActions,
          hasDescription,
          hasInfo,
          hasVisibleActions: hasActions && actionsAlwaysVisible,
          isActive,
          isDragSource,
          isDropTarget,
          isEditing,
          isMenuOpen,
        }),
        rowClassName,
        className,
      ))}
      {...props}
    >
      {defaultMain}
      {defaultEnd}
    </div>
  )

  if (effectiveItemAs === null) {
    return row
  }

  const ItemElement = effectiveItemAs

  return (
    <ItemElement
      className={cx(
        'app-item-container',
        isHeader && 'app-item-header',
        itemClassName,
      )}
    >
      {row}
      {after}
    </ItemElement>
  )
})

export const AppItemMain = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & AppItemMainState>(function AppItemMain(
  { className, hasDescription, ...props },
  ref,
) {
  return <div ref={ref} className={appItemClassNames.main(cx(hasDescription && 'has-description', className))} {...props} />
})

const APP_ITEM_MAIN_TOOLTIP_DELAY = 500
const APP_ITEM_TEXT_OVERFLOW_EPSILON = 1

function getAppItemMainOverflowTooltip(element: HTMLElement) {
  const overflowedTexts = Array.from(
    element.querySelectorAll<HTMLElement>('.app-item-label, .app-item-description'),
  ).flatMap((textElement) => {
    const hasOverflow = textElement.scrollWidth > textElement.clientWidth + APP_ITEM_TEXT_OVERFLOW_EPSILON
    const text = textElement.textContent?.trim()

    return hasOverflow && text ? [text] : []
  })

  return overflowedTexts.length > 0 ? overflowedTexts.join(' · ') : null
}

export const AppItemMainButton = forwardRef<HTMLButtonElement, AppItemMainButtonProps>(function AppItemMainButton(
  {
    className,
    disabled,
    hasDescription,
    onBlur,
    onFocus,
    onPointerEnter,
    onPointerLeave,
    title,
    type = 'button',
    ...props
  },
  ref,
) {
  const openTimerRef = useRef<number | null>(null)
  const [overflowTooltip, setOverflowTooltip] = useState<string | null>(null)
  const [isOverflowTooltipOpen, setIsOverflowTooltipOpen] = useState(false)

  const clearOpenTimer = () => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
  }

  const closeOverflowTooltip = () => {
    clearOpenTimer()
    setIsOverflowTooltipOpen(false)
  }

  const scheduleOverflowTooltip = (element: HTMLElement) => {
    clearOpenTimer()

    if (disabled) {
      setIsOverflowTooltipOpen(false)
      return
    }

    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null
      const nextTooltip = getAppItemMainOverflowTooltip(element)

      setOverflowTooltip(nextTooltip)
      setIsOverflowTooltipOpen(Boolean(nextTooltip))
    }, APP_ITEM_MAIN_TOOLTIP_DELAY)
  }

  useEffect(() => () => {
    clearOpenTimer()
  }, [])

  const handlePointerEnter: AppItemMainButtonProps['onPointerEnter'] = (event) => {
    onPointerEnter?.(event)
    scheduleOverflowTooltip(event.currentTarget)
  }

  const handlePointerLeave: AppItemMainButtonProps['onPointerLeave'] = (event) => {
    onPointerLeave?.(event)
    closeOverflowTooltip()
  }

  const handleFocus: AppItemMainButtonProps['onFocus'] = (event) => {
    onFocus?.(event)
    scheduleOverflowTooltip(event.currentTarget)
  }

  const handleBlur: AppItemMainButtonProps['onBlur'] = (event) => {
    onBlur?.(event)
    closeOverflowTooltip()
  }

  return (
    <AppTooltipButton
      ref={ref}
      type={type}
      className={appItemClassNames.main(cx(hasDescription && 'has-description', className))}
      disabled={disabled}
      isTooltipOpen={isOverflowTooltipOpen}
      tooltip={overflowTooltip ?? title ?? ''}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      {...props}
    />
  )
})

function AppItemMainContent({
  description,
  descriptionClassName,
  descriptionProps,
  icon,
  label,
  labelClassName,
  labelProps,
  labelSuffix,
}: AppItemMainContentProps) {
  const hasDescription = description !== undefined && description !== null && description !== false
  const hasLabel = label !== undefined && label !== null && label !== false

  return (
    <>
      {icon}
      {hasLabel ? (
        <AppItemLabel
          {...labelProps}
          className={cx(labelClassName, labelProps?.className)}
        >
          {label}
        </AppItemLabel>
      ) : null}
      {labelSuffix}
      {hasDescription ? (
        <span
          {...descriptionProps}
          className={appItemClassNames.description(cx(descriptionClassName, descriptionProps?.className))}
        >
          {description}
        </span>
      ) : null}
    </>
  )
}

const AppItemEnd = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { children?: ReactNode }>(
  function AppItemEnd(
    { children, className, ...props },
    ref,
  ) {
    return (
      <div ref={ref} className={appItemClassNames.end(className)} {...props}>
        {children}
      </div>
    )
  },
)

const AppItemActions = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function AppItemActions(
    { className, ...props },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={appItemClassNames.actions(className)}
        {...props}
      />
    )
  },
)

export const AppItemActionButton = forwardRef<HTMLButtonElement, AppItemActionButtonProps>(function AppItemActionButton(
  {
    'aria-label': ariaLabel,
    className,
    disabled,
    title,
    tooltip,
    type = 'button',
    ...props
  },
  ref,
) {
  const resolvedTooltip = tooltip ?? title ?? ariaLabel
  const button = (
    <AppIconButton
      ref={ref}
      type={type}
      className={appItemClassNames.action(className)}
      aria-label={ariaLabel}
      disabled={disabled}
      tooltip={disabled ? null : resolvedTooltip}
      {...props}
    />
  )

  if (disabled && resolvedTooltip !== undefined && resolvedTooltip !== null && resolvedTooltip !== false) {
    return (
      <AppTooltip
        excludeFromTabOrder
        tooltip={resolvedTooltip}
        triggerClassName='app-item-action-tooltip-trigger'
        triggerMode='wrapper'
      >
        {button}
      </AppTooltip>
    )
  }

  return button
})

export const AppItemIcon = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(function AppItemIcon(
  { className, ...props },
  ref,
) {
  return <span ref={ref} className={appItemClassNames.icon(className)} aria-hidden='true' {...props} />
})

const AppItemLabel = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(function AppItemLabel(
  { className, ...props },
  ref,
) {
  return <span ref={ref} className={appItemClassNames.label(className)} {...props} />
})

const AppItemInfo = forwardRef<
  HTMLSpanElement,
  HTMLAttributes<HTMLSpanElement> & { variant?: AppItemInfoVariant }
>(function AppItemInfo(
  { className, title, variant = 'text', ...props },
  ref,
) {
  return (
    <AppTooltip excludeFromTabOrder tooltip={title} triggerMode='focusable'>
      <span ref={ref} className={appItemClassNames.info(variant, className)} {...props} />
    </AppTooltip>
  )
})

export const AppItemStatusDot = forwardRef<
  HTMLSpanElement,
  HTMLAttributes<HTMLSpanElement> & { tone?: AppItemStatusTone }
>(function AppItemStatusDot(
  {
    className,
    tone = 'neutral',
    'aria-hidden': ariaHidden,
    'aria-label': ariaLabel,
    title,
    ...props
  },
  ref,
) {
  const dot = (
    <span
      ref={ref}
      className={appItemClassNames.statusDot(tone, className)}
      role={ariaLabel ? 'img' : undefined}
      aria-hidden={ariaHidden ?? (ariaLabel ? undefined : true)}
      aria-label={ariaLabel}
      {...props}
    />
  )

  return <AppTooltip excludeFromTabOrder tooltip={title} triggerMode='focusable'>{dot}</AppTooltip>
})
