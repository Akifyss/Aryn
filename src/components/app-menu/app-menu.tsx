import {
  type CSSProperties,
  type ButtonHTMLAttributes,
  type ForwardedRef,
  type HTMLAttributes,
  type ReactNode,
  type RefAttributes,
  forwardRef,
  isValidElement,
} from 'react'
import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu'
import { Menu as BaseMenu } from '@base-ui/react/menu'
import type { MenuRootChangeEventDetails } from '@base-ui/react/menu'
import { Popover as BasePopover } from '@base-ui/react/popover'
import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area'
import { Select as BaseSelect } from '@base-ui/react/select'
import { CheckLine, RightLine } from '@mingcute/react'
import {
  AppButton,
  type AppButtonSize,
} from '@/components/app-button'
import {
  AppIconButton,
  type AppIconButtonProps,
  type AppIconButtonVariant,
} from '@/components/app-icon-button'
import {
  AppItem,
  AppItemIcon,
  type AppItemInfoVariant,
} from '@/components/app-item'

type StatefulClassName<State> = string | ((state: State) => string | undefined)

export type AppMenuItemTone = 'danger' | 'default'
export type AppMenuLayout = 'compound' | 'list'
export type AppMenuPopupSize = 'fit' | 'lg' | 'md' | 'sm'
export type AppMenuTriggerSize = AppButtonSize
export type AppMenuTriggerVariant = 'ghost' | 'icon' | 'outline'
export type AppMenuTriggerSurfaceVariant = Exclude<AppMenuTriggerVariant, 'icon'>

function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

function mergeStatefulClassName<State>(
  baseClassName: string,
  className?: StatefulClassName<State>,
): StatefulClassName<State> {
  if (typeof className === 'function') {
    return state => cx(baseClassName, className(state))
  }

  return cx(baseClassName, className)
}

function appMenuTriggerClassName(className?: string) {
  return cx('app-menu-trigger', className)
}

export type AppMenuTriggerSurfaceProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  className?: string
  size?: AppMenuTriggerSize
  variant?: AppMenuTriggerSurfaceVariant
}

/**
 * Shared visual trigger for Menu, Select, Popover, and custom overlays.
 * The owning Base UI primitive keeps interaction semantics and renders this button.
 */
export const AppMenuTriggerSurface = forwardRef<HTMLButtonElement, AppMenuTriggerSurfaceProps>(
  function AppMenuTriggerSurface(
    {
      className,
      size = 'md',
      type = 'button',
      variant = 'outline',
      ...props
    },
    ref,
  ) {
    const triggerClassName = appMenuTriggerClassName(className)

    return (
      <AppButton
        {...props}
        ref={ref as ForwardedRef<HTMLElement>}
        type={type}
        className={triggerClassName}
        size={size}
        variant={variant}
      />
    )
  },
)

export type AppMenuSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  layout?: AppMenuLayout
  size?: AppMenuPopupSize
}

export const AppMenuSurface = forwardRef<HTMLDivElement, AppMenuSurfaceProps>(function AppMenuSurface(
  {
    className,
    layout = 'compound',
    size = 'md',
    ...props
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cx(
        'app-menu-surface',
        layout === 'list' && 'app-menu-list',
        `app-menu-surface-${size}`,
        className,
      )}
      data-layout={layout}
      data-size={size}
      {...props}
    />
  )
})

export type AppMenuListProps = HTMLAttributes<HTMLDivElement>

export const AppMenuList = forwardRef<HTMLDivElement, AppMenuListProps>(function AppMenuList(
  {
    className,
    ...props
  },
  ref,
) {
  return <div {...props} ref={ref} className={cx('app-menu-list', className)} />
})

export type AppMenuScrollAreaProps = Omit<BaseScrollArea.Root.Props, 'className'> & {
  className?: string
}

export const AppMenuScrollArea = forwardRef<HTMLDivElement, AppMenuScrollAreaProps>(
  function AppMenuScrollArea(
    {
      children,
      className,
      ...props
    },
    ref,
  ) {
    return (
      <BaseScrollArea.Root
        {...props}
        ref={ref}
        className={cx('app-menu-scroll-area', 'app-scroll-area', className)}
      >
        {children}
        <BaseScrollArea.Scrollbar
          className='app-menu-scrollbar app-scroll-area-scrollbar'
          orientation='vertical'
        >
          <BaseScrollArea.Thumb className='app-scroll-area-thumb' />
        </BaseScrollArea.Scrollbar>
      </BaseScrollArea.Root>
    )
  },
)

export type AppMenuScrollViewportProps = Omit<BaseScrollArea.Viewport.Props, 'className'> & {
  className?: string
}

export const AppMenuScrollViewport = forwardRef<HTMLDivElement, AppMenuScrollViewportProps>(
  function AppMenuScrollViewport(
    {
      className,
      ...props
    },
    ref,
  ) {
    return (
      <BaseScrollArea.Viewport
        {...props}
        ref={ref}
        className={cx('app-menu-scroll-viewport', 'app-scroll-area-viewport', className)}
      />
    )
  },
)

export type AppMenuScrollContentProps = Omit<BaseScrollArea.Content.Props, 'className'> & {
  className?: string
}

export const AppMenuScrollContent = forwardRef<HTMLDivElement, AppMenuScrollContentProps>(
  function AppMenuScrollContent(
    {
      className,
      style,
      ...props
    },
    ref,
  ) {
    return (
      <BaseScrollArea.Content
        {...props}
        ref={ref}
        className={cx('app-menu-scroll-content', 'app-scroll-area-content', 'app-menu-list', className)}
        style={{ minWidth: '100%', ...style }}
      />
    )
  },
)

type AppMenuTriggerBaseProps<Payload> = Omit<
  BaseMenu.Trigger.Props<Payload>,
  'className' | 'render'
> & {
  className?: BaseMenu.Trigger.Props<Payload>['className']
}

/**
 * Menu owns the complete button visual. `variant` is therefore a real visual
 * choice and Menu renders the matching AppButton or AppIconButton.
 */
export type AppMenuVisualTriggerProps<Payload = unknown> = AppMenuTriggerBaseProps<Payload> & {
  iconTooltip?: AppIconButtonProps['tooltip']
  iconVariant?: AppIconButtonVariant
  render?: undefined
  size?: AppMenuTriggerSize
  variant?: AppMenuTriggerVariant
}

/**
 * The supplied element owns its complete visual contract. Menu only merges
 * trigger behavior and accessibility props into that element.
 */
export type AppMenuCustomTriggerProps<Payload = unknown> = AppMenuTriggerBaseProps<Payload> & {
  iconTooltip?: never
  iconVariant?: never
  render: Exclude<BaseMenu.Trigger.Props<Payload>['render'], undefined>
  size?: never
  variant?: never
}

export type AppMenuTriggerProps<Payload = unknown> =
  | AppMenuVisualTriggerProps<Payload>
  | AppMenuCustomTriggerProps<Payload>

function createAppMenuVisualTrigger({
  iconTooltip,
  iconVariant,
  size,
  variant,
}: {
  iconTooltip?: AppIconButtonProps['tooltip']
  iconVariant?: AppIconButtonVariant
  size: AppMenuTriggerSize
  variant: AppMenuTriggerVariant
}) {
  return variant === 'icon'
    ? (
      <AppIconButton
        size={size}
        tooltip={iconTooltip}
        variant={iconVariant}
      />
    )
    : (
      <AppButton
        className={appMenuTriggerClassName()}
        size={size}
        variant={variant}
      />
    )
}

function AppMenuTriggerImplementation<Payload = unknown>(
  {
    className,
    iconTooltip,
    iconVariant,
    render,
    size = 'md',
    variant,
    ...props
  }: AppMenuTriggerProps<Payload>,
  ref: ForwardedRef<HTMLButtonElement>,
) {
  if (render !== undefined) {
    return (
      <BaseMenu.Trigger
        {...props}
        ref={ref}
        render={render}
        className={className}
      />
    )
  }

  const resolvedVariant = variant ?? 'outline'
  const resolvedRender = createAppMenuVisualTrigger({
    iconTooltip,
    iconVariant,
    size,
    variant: resolvedVariant,
  })

  return (
    <BaseMenu.Trigger
      {...props}
      ref={ref}
      render={resolvedRender}
      className={className}
    />
  )
}

export const AppMenuTrigger = forwardRef(AppMenuTriggerImplementation) as <Payload = unknown>(
  props: AppMenuTriggerProps<Payload> & RefAttributes<HTMLButtonElement>,
) => React.JSX.Element

export type AppMenuPositionerProps = BaseMenu.Positioner.Props

export const AppMenuPositioner = forwardRef<HTMLDivElement, AppMenuPositionerProps>(function AppMenuPositioner(
  {
    className,
    collisionAvoidance = { side: 'flip', align: 'shift', fallbackAxisSide: 'none' },
    collisionPadding = 8,
    sideOffset = 4,
    ...props
  },
  ref,
) {
  return (
    <BaseMenu.Positioner
      ref={ref}
      className={mergeStatefulClassName('app-menu-positioner', className)}
      collisionAvoidance={collisionAvoidance}
      collisionPadding={collisionPadding}
      sideOffset={sideOffset}
      {...props}
    />
  )
})

export type AppMenuPopupProps = Omit<BaseMenu.Popup.Props, 'render'> & {
  layout?: AppMenuLayout
  render?: BaseMenu.Popup.Props['render']
  size?: AppMenuPopupSize
}

export const AppMenuPopup = forwardRef<HTMLDivElement, AppMenuPopupProps>(function AppMenuPopup(
  {
    className,
    layout = 'list',
    render,
    size = 'md',
    ...props
  },
  ref,
) {
  return (
    <BaseMenu.Popup
      ref={ref}
      render={render ?? (
        <AppMenuSurface
          layout={layout}
          size={size}
        />
      )}
      className={mergeStatefulClassName('app-menu-popup', className)}
      {...props}
    />
  )
})

export type AppMenuGroupProps = BaseMenu.Group.Props

export const AppMenuGroup = forwardRef<HTMLDivElement, AppMenuGroupProps>(function AppMenuGroup(
  {
    className,
    ...props
  },
  ref,
) {
  return (
    <BaseMenu.Group
      {...props}
      ref={ref}
      className={mergeStatefulClassName('app-menu-list', className)}
    />
  )
})

export type AppMenuRadioGroupProps = BaseMenu.RadioGroup.Props

export const AppMenuRadioGroup = forwardRef<HTMLDivElement, AppMenuRadioGroupProps>(function AppMenuRadioGroup(
  {
    className,
    ...props
  },
  ref,
) {
  return (
    <BaseMenu.RadioGroup
      {...props}
      ref={ref}
      className={mergeStatefulClassName('app-menu-list', className)}
    />
  )
})

export type AppMenuSelectTriggerProps = Omit<BaseSelect.Trigger.Props, 'render'> & {
  render?: BaseSelect.Trigger.Props['render']
  size?: AppMenuTriggerSize
  variant?: AppMenuTriggerSurfaceVariant
}

export const AppMenuSelectTrigger = forwardRef<HTMLButtonElement, AppMenuSelectTriggerProps>(
  function AppMenuSelectTrigger(
    {
      render,
      size = 'md',
      variant = 'outline',
      ...props
    },
    ref,
  ) {
    return (
      <BaseSelect.Trigger
        {...props}
        ref={ref}
        render={render ?? <AppMenuTriggerSurface size={size} variant={variant} />}
      />
    )
  },
)

export type AppMenuSelectPositionerProps = BaseSelect.Positioner.Props

export const AppMenuSelectPositioner = forwardRef<HTMLDivElement, AppMenuSelectPositionerProps>(
  function AppMenuSelectPositioner(
    {
      alignItemWithTrigger = true,
      className,
      collisionAvoidance = { side: 'flip', align: 'shift', fallbackAxisSide: 'none' },
      collisionPadding = 8,
      sideOffset = 4,
      ...props
    },
    ref,
  ) {
    return (
      <BaseSelect.Positioner
        {...props}
        ref={ref}
        alignItemWithTrigger={alignItemWithTrigger}
        className={mergeStatefulClassName('app-menu-positioner', className)}
        collisionAvoidance={collisionAvoidance}
        collisionPadding={collisionPadding}
        sideOffset={sideOffset}
      />
    )
  },
)

export type AppMenuSelectPopupProps = Omit<BaseSelect.Popup.Props, 'render'> & {
  layout?: AppMenuLayout
  render?: BaseSelect.Popup.Props['render']
  size?: AppMenuPopupSize
}

export const AppMenuSelectPopup = forwardRef<HTMLDivElement, AppMenuSelectPopupProps>(
  function AppMenuSelectPopup(
    {
      className,
      layout = 'list',
      render,
      size = 'md',
      ...props
    },
    ref,
  ) {
    return (
      <BaseSelect.Popup
        {...props}
        ref={ref}
        render={render ?? (
          <AppMenuSurface
            layout={layout}
            size={size}
          />
        )}
        className={mergeStatefulClassName('app-menu-select-popup', className)}
      />
    )
  },
)

export type AppMenuSelectListProps = BaseSelect.List.Props

export const AppMenuSelectList = forwardRef<HTMLDivElement, AppMenuSelectListProps>(
  function AppMenuSelectList(
    {
      className,
      ...props
    },
    ref,
  ) {
    return (
      <BaseSelect.List
        {...props}
        ref={ref}
        className={mergeStatefulClassName('app-menu-list', className)}
      />
    )
  },
)

export type AppMenuSelectGroupProps = BaseSelect.Group.Props

export const AppMenuSelectGroup = forwardRef<HTMLDivElement, AppMenuSelectGroupProps>(
  function AppMenuSelectGroup(
    {
      className,
      ...props
    },
    ref,
  ) {
    return (
      <BaseSelect.Group
        {...props}
        ref={ref}
        className={mergeStatefulClassName('app-menu-list', className)}
      />
    )
  },
)

export type AppMenuSelectGroupLabelProps = BaseSelect.GroupLabel.Props

export const AppMenuSelectGroupLabel = forwardRef<HTMLDivElement, AppMenuSelectGroupLabelProps>(
  function AppMenuSelectGroupLabel(
    {
      className,
      ...props
    },
    ref,
  ) {
    return (
      <BaseSelect.GroupLabel
        {...props}
        ref={ref}
        className={mergeStatefulClassName('app-menu-group-label', className)}
      />
    )
  },
)

export const AppMenuSelectItemIndicator = forwardRef<
  HTMLSpanElement,
  BaseSelect.ItemIndicator.Props
>(function AppMenuSelectItemIndicator(
  {
    className,
    ...props
  },
  ref,
) {
  return (
    <BaseSelect.ItemIndicator
      {...props}
      ref={ref}
      className={mergeStatefulClassName('app-menu-item-indicator', className)}
    />
  )
})

export type AppMenuSelectScrollListProps = Omit<BaseSelect.List.Props, 'render'> & {
  scrollAreaClassName?: string
  viewportClassName?: string
  viewportStyle?: CSSProperties
}

export const AppMenuSelectScrollList = forwardRef<HTMLDivElement, AppMenuSelectScrollListProps>(
  function AppMenuSelectScrollList(
    {
      children,
      className,
      scrollAreaClassName,
      viewportClassName,
      viewportStyle,
      ...props
    },
    ref,
  ) {
    return (
      <AppMenuScrollArea className={scrollAreaClassName}>
        <BaseSelect.List
          {...props}
          ref={ref}
          className={mergeStatefulClassName('app-menu-list', className)}
          render={(listProps) => {
            const {
              className: listClassName,
              children: listChildren,
              style,
              ...viewportProps
            } = listProps
            const resolvedViewportStyle = {
              ...style,
              ...viewportStyle,
            }

            delete resolvedViewportStyle.maxHeight
            delete resolvedViewportStyle.overflow
            delete resolvedViewportStyle.overflowX
            delete resolvedViewportStyle.overflowY

            return (
              <AppMenuScrollViewport
                {...viewportProps}
                className={cx(listClassName, viewportClassName)}
                style={resolvedViewportStyle}
              >
                {listChildren}
              </AppMenuScrollViewport>
            )
          }}
        >
          {children}
        </BaseSelect.List>
      </AppMenuScrollArea>
    )
  },
)

export type AppMenuPopoverPositionerProps = BasePopover.Positioner.Props

export const AppMenuPopoverPositioner = forwardRef<HTMLDivElement, AppMenuPopoverPositionerProps>(
  function AppMenuPopoverPositioner(
    {
      className,
      collisionAvoidance = { side: 'flip', align: 'shift', fallbackAxisSide: 'none' },
      collisionPadding = 8,
      sideOffset = 4,
      ...props
    },
    ref,
  ) {
    return (
      <BasePopover.Positioner
        {...props}
        ref={ref}
        className={mergeStatefulClassName('app-menu-positioner', className)}
        collisionAvoidance={collisionAvoidance}
        collisionPadding={collisionPadding}
        sideOffset={sideOffset}
      />
    )
  },
)

export type AppMenuPopoverPopupProps = Omit<BasePopover.Popup.Props, 'render'> & {
  layout?: AppMenuLayout
  render?: BasePopover.Popup.Props['render']
  size?: AppMenuPopupSize
}

export const AppMenuPopoverPopup = forwardRef<HTMLDivElement, AppMenuPopoverPopupProps>(
  function AppMenuPopoverPopup(
    {
      className,
      layout = 'compound',
      render,
      size = 'fit',
      ...props
    },
    ref,
  ) {
    return (
      <BasePopover.Popup
        {...props}
        ref={ref}
        render={render ?? (
          <AppMenuSurface
            layout={layout}
            size={size}
          />
        )}
        className={mergeStatefulClassName('app-menu-popover-popup', className)}
      />
    )
  },
)

type AppMenuPopoverTriggerBaseProps<Payload> = Omit<
  BasePopover.Trigger.Props<Payload>,
  'className' | 'render'
> & {
  className?: BasePopover.Trigger.Props<Payload>['className']
}

export type AppMenuPopoverVisualTriggerProps<Payload = unknown> =
  AppMenuPopoverTriggerBaseProps<Payload>
  & {
    iconTooltip?: AppIconButtonProps['tooltip']
    iconVariant?: AppIconButtonVariant
    render?: undefined
    size?: AppMenuTriggerSize
    variant?: AppMenuTriggerVariant
  }

export type AppMenuPopoverCustomTriggerProps<Payload = unknown> =
  AppMenuPopoverTriggerBaseProps<Payload>
  & {
    iconTooltip?: never
    iconVariant?: never
    render: Exclude<BasePopover.Trigger.Props<Payload>['render'], undefined>
    size?: never
    variant?: never
  }

export type AppMenuPopoverTriggerProps<Payload = unknown> =
  | AppMenuPopoverVisualTriggerProps<Payload>
  | AppMenuPopoverCustomTriggerProps<Payload>

function AppMenuPopoverTriggerImplementation<Payload = unknown>(
  {
    className,
    iconTooltip,
    iconVariant,
    render,
    size = 'md',
    variant,
    ...props
  }: AppMenuPopoverTriggerProps<Payload>,
  ref: ForwardedRef<HTMLButtonElement>,
) {
  if (render !== undefined) {
    return (
      <BasePopover.Trigger
        {...props}
        ref={ref}
        render={render}
        className={className}
      />
    )
  }

  const resolvedVariant = variant ?? 'outline'

  return (
    <BasePopover.Trigger
      {...props}
      ref={ref}
      render={createAppMenuVisualTrigger({
        iconTooltip,
        iconVariant,
        size,
        variant: resolvedVariant,
      })}
      className={className}
    />
  )
}

export const AppMenuPopoverTrigger = forwardRef(AppMenuPopoverTriggerImplementation) as <Payload = unknown>(
  props: AppMenuPopoverTriggerProps<Payload> & RefAttributes<HTMLButtonElement>,
) => React.JSX.Element

type AppMenuItemVisualProps = {
  description?: ReactNode
  icon?: ReactNode
  info?: ReactNode
  infoVariant?: AppItemInfoVariant
  selected?: boolean
  text?: ReactNode
  tone?: AppMenuItemTone
}

function resolveAppMenuItemIcon(icon: ReactNode) {
  if (icon === undefined || icon === null || icon === false) {
    return undefined
  }

  return isValidElement(icon) && icon.type === AppItemIcon
    ? icon
    : <AppItemIcon>{icon}</AppItemIcon>
}

function createAppMenuItemRender({
  children,
  description,
  icon,
  info,
  infoVariant,
  render,
  selected,
  text,
  tone = 'default',
}: AppMenuItemVisualProps & {
  children?: ReactNode
  render?: unknown
}) {
  if (render) {
    return render
  }

  const resolvedIcon = resolveAppMenuItemIcon(icon)
  return (
    <AppItem
      description={description}
      icon={resolvedIcon}
      info={info}
      infoVariant={infoVariant}
      isActive={selected}
      itemAs={null}
      label={text}
      mainKind='static'
      data-tone={tone}
    >
      {text === undefined ? children : undefined}
    </AppItem>
  )
}

function appMenuItemClassName<State>(
  tone: AppMenuItemTone,
  selected: boolean | undefined,
  className?: StatefulClassName<State>,
) {
  return mergeStatefulClassName(
    cx(
      'app-menu-item',
      `app-menu-item-${tone}`,
      selected && 'is-selected',
    ),
    className,
  )
}

export type AppMenuItemProps = Omit<BaseMenu.Item.Props, 'render'> & AppMenuItemVisualProps & {
  render?: BaseMenu.Item.Props['render']
}

export const AppMenuItem = forwardRef<HTMLElement, AppMenuItemProps>(function AppMenuItem(
  {
    children,
    className,
    description,
    icon,
    info,
    infoVariant,
    render,
    selected,
    text,
    tone = 'default',
    ...props
  },
  ref,
) {
  const resolvedRender = createAppMenuItemRender({
    children,
    description,
    icon,
    info,
    infoVariant,
    render,
    selected,
    text,
    tone,
  }) as BaseMenu.Item.Props['render']

  return (
    <BaseMenu.Item
      ref={ref}
      render={resolvedRender}
      className={appMenuItemClassName(tone, selected, className)}
      {...props}
    >
      {render ? children : undefined}
    </BaseMenu.Item>
  )
})

export type AppMenuLinkItemProps = Omit<BaseMenu.LinkItem.Props, 'render'> & AppMenuItemVisualProps & {
  render?: BaseMenu.LinkItem.Props['render']
}

export const AppMenuLinkItem = forwardRef<Element, AppMenuLinkItemProps>(function AppMenuLinkItem(
  {
    children,
    className,
    description,
    icon,
    info,
    infoVariant,
    render,
    selected,
    text,
    tone = 'default',
    ...props
  },
  ref,
) {
  if (render) {
    return (
      <BaseMenu.LinkItem
        ref={ref}
        render={render}
        className={appMenuItemClassName(tone, selected, className)}
        {...props}
      >
        {children}
      </BaseMenu.LinkItem>
    )
  }

  const itemVisual = createAppMenuItemRender({
    children,
    description,
    icon,
    info,
    infoVariant,
    selected,
    text,
    tone,
  }) as ReactNode

  return (
    <BaseMenu.LinkItem
      ref={ref}
      className={mergeStatefulClassName(
        cx(
          'app-menu-item',
          'app-menu-link-item',
          `app-menu-item-${tone}`,
          selected && 'is-selected',
        ),
        className,
      )}
      {...props}
    >
      {itemVisual}
    </BaseMenu.LinkItem>
  )
})

export type AppMenuRadioItemProps = Omit<BaseMenu.RadioItem.Props, 'render'> & AppMenuItemVisualProps & {
  indicator?: ReactNode
  render?: BaseMenu.RadioItem.Props['render']
}

export const AppMenuRadioItem = forwardRef<HTMLElement, AppMenuRadioItemProps>(function AppMenuRadioItem(
  {
    children,
    className,
    description,
    icon,
    indicator = <span className='app-menu-radio-indicator-dot' />,
    info,
    infoVariant = 'status',
    render,
    selected,
    text,
    tone = 'default',
    ...props
  },
  ref,
) {
  const resolvedInfo = info ?? (
    <AppMenuRadioItemIndicator>
      {indicator}
    </AppMenuRadioItemIndicator>
  )
  const resolvedRender = createAppMenuItemRender({
    children,
    description,
    icon,
    info: resolvedInfo,
    infoVariant,
    render,
    selected,
    text,
    tone,
  }) as BaseMenu.RadioItem.Props['render']

  return (
    <BaseMenu.RadioItem
      ref={ref}
      render={resolvedRender}
      className={appMenuItemClassName(tone, selected, className)}
      {...props}
    >
      {render ? children : undefined}
    </BaseMenu.RadioItem>
  )
})

export type AppMenuCheckboxItemProps = Omit<BaseMenu.CheckboxItem.Props, 'render'> & AppMenuItemVisualProps & {
  indicator?: ReactNode
  render?: BaseMenu.CheckboxItem.Props['render']
}

export const AppMenuCheckboxItem = forwardRef<HTMLElement, AppMenuCheckboxItemProps>(function AppMenuCheckboxItem(
  {
    children,
    className,
    description,
    icon,
    indicator = <CheckLine aria-hidden='true' />,
    info,
    infoVariant = 'status',
    render,
    selected,
    text,
    tone = 'default',
    ...props
  },
  ref,
) {
  const resolvedInfo = info ?? (
    <AppMenuCheckboxItemIndicator>
      {indicator}
    </AppMenuCheckboxItemIndicator>
  )
  const resolvedRender = createAppMenuItemRender({
    children,
    description,
    icon,
    info: resolvedInfo,
    infoVariant,
    render,
    selected,
    text,
    tone,
  }) as BaseMenu.CheckboxItem.Props['render']

  return (
    <BaseMenu.CheckboxItem
      ref={ref}
      render={resolvedRender}
      className={appMenuItemClassName(tone, selected, className)}
      {...props}
    >
      {render ? children : undefined}
    </BaseMenu.CheckboxItem>
  )
})

export type AppMenuOptionProps = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onToggle'> & AppMenuItemVisualProps & {
  children?: ReactNode
}

export const AppMenuOption = forwardRef<HTMLDivElement, AppMenuOptionProps>(function AppMenuOption(
  {
    children,
    className,
    description,
    icon,
    info,
    infoVariant,
    selected,
    tabIndex = -1,
    text,
    tone = 'default',
    ...props
  },
  ref,
) {
  const resolvedIcon = resolveAppMenuItemIcon(icon)
  return (
    <AppItem
      {...props}
      ref={ref}
      description={description}
      icon={resolvedIcon}
      info={info}
      infoVariant={infoVariant}
      isActive={selected}
      itemAs={null}
      label={text}
      mainKind='static'
      tabIndex={tabIndex}
      className={cx(
        'app-menu-option',
        'app-menu-item',
        `app-menu-item-${tone}`,
        selected && 'is-selected',
        className,
      )}
      data-tone={tone}
    >
      {text === undefined ? children : undefined}
    </AppItem>
  )
})

export type AppMenuSelectItemProps = Omit<BaseSelect.Item.Props, 'children' | 'render'> & {
  children?: ReactNode
  description?: ReactNode
  icon?: ReactNode
  indicator?: ReactNode
  info?: ReactNode
  infoVariant?: AppItemInfoVariant
  render?: BaseSelect.Item.Props['render']
  text?: ReactNode
  tone?: AppMenuItemTone
}

export const AppMenuSelectItem = forwardRef<HTMLElement, AppMenuSelectItemProps>(
  function AppMenuSelectItem(
    {
      children,
      className,
      description,
      icon,
      indicator = <CheckLine aria-hidden='true' />,
      info,
      infoVariant = 'status',
      label,
      render,
      text,
      tone = 'default',
      ...props
    },
    ref,
  ) {
    const itemText = text ?? children
    const resolvedInfo = info ?? (
      <AppMenuSelectItemIndicator>
        {indicator}
      </AppMenuSelectItemIndicator>
    )
    const resolvedRender = render ?? (
      <AppItem
        description={description}
        icon={resolveAppMenuItemIcon(icon)}
        info={resolvedInfo}
        infoVariant={infoVariant}
        itemAs={null}
        label={(
          <BaseSelect.ItemText render={<span />}>
            {itemText}
          </BaseSelect.ItemText>
        )}
        mainKind='static'
        data-tone={tone}
      />
    )

    return (
      <BaseSelect.Item
        {...props}
        ref={ref}
        label={label}
        render={resolvedRender}
        className={appMenuItemClassName(tone, undefined, className)}
      />
    )
  },
)

export type AppMenuSubmenuTriggerProps =
  Omit<BaseMenu.SubmenuTrigger.Props, 'render'>
  & Omit<AppMenuItemVisualProps, 'selected'>
  & {
    render?: BaseMenu.SubmenuTrigger.Props['render']
  }

export const AppMenuSubmenuTrigger = forwardRef<HTMLElement, AppMenuSubmenuTriggerProps>(function AppMenuSubmenuTrigger(
  {
    children,
    className,
    description,
    icon,
    info = <RightLine aria-hidden='true' />,
    infoVariant = 'status',
    render,
    text,
    tone = 'default',
    ...props
  },
  ref,
) {
  const resolvedRender = createAppMenuItemRender({
    children,
    description,
    icon,
    info,
    infoVariant,
    render,
    text,
    tone,
  }) as BaseMenu.SubmenuTrigger.Props['render']

  return (
    <BaseMenu.SubmenuTrigger
      ref={ref}
      render={resolvedRender}
      className={appMenuItemClassName(tone, undefined, className)}
      {...props}
    >
      {render ? children : undefined}
    </BaseMenu.SubmenuTrigger>
  )
})

export const AppMenuSeparator = forwardRef<HTMLDivElement, BaseMenu.Separator.Props>(function AppMenuSeparator(
  { className, ...props },
  ref,
) {
  return (
    <BaseMenu.Separator
      ref={ref}
      className={mergeStatefulClassName('app-menu-separator', className)}
      {...props}
    />
  )
})

export const AppMenuGroupLabel = forwardRef<HTMLDivElement, BaseMenu.GroupLabel.Props>(function AppMenuGroupLabel(
  { className, ...props },
  ref,
) {
  return <BaseMenu.GroupLabel ref={ref} className={mergeStatefulClassName('app-menu-group-label', className)} {...props} />
})

export const AppMenuBackdrop = forwardRef<HTMLDivElement, BaseMenu.Backdrop.Props>(function AppMenuBackdrop(
  { className, ...props },
  ref,
) {
  return <BaseMenu.Backdrop ref={ref} className={mergeStatefulClassName('app-menu-backdrop', className)} {...props} />
})

export const AppMenuRadioItemIndicator = forwardRef<HTMLSpanElement, BaseMenu.RadioItemIndicator.Props>(
  function AppMenuRadioItemIndicator(
    { className, ...props },
    ref,
  ) {
    return (
      <BaseMenu.RadioItemIndicator
        ref={ref}
        className={mergeStatefulClassName('app-menu-item-indicator', className)}
        {...props}
      />
    )
  },
)

export const AppMenuCheckboxItemIndicator = forwardRef<HTMLSpanElement, BaseMenu.CheckboxItemIndicator.Props>(
  function AppMenuCheckboxItemIndicator(
    { className, ...props },
    ref,
  ) {
    return (
      <BaseMenu.CheckboxItemIndicator
        ref={ref}
        className={mergeStatefulClassName('app-menu-item-indicator', className)}
        {...props}
      />
    )
  },
)

export function shouldCloseClickOpenedMenu(details: MenuRootChangeEventDetails) {
  return details.reason === 'outside-press'
    || details.reason === 'escape-key'
    || details.reason === 'item-press'
    || details.reason === 'close-press'
    || details.reason === 'imperative-action'
    || details.reason === 'trigger-press'
}

export const AppMenuContext = {
  Arrow: BaseMenu.Arrow,
  Backdrop: AppMenuBackdrop,
  CheckboxItem: AppMenuCheckboxItem,
  CheckboxItemIndicator: AppMenuCheckboxItemIndicator,
  Group: AppMenuGroup,
  GroupLabel: AppMenuGroupLabel,
  Item: AppMenuItem,
  LinkItem: AppMenuLinkItem,
  List: AppMenuList,
  Option: AppMenuOption,
  Popup: AppMenuPopup,
  Portal: BaseMenu.Portal,
  Positioner: AppMenuPositioner,
  RadioGroup: AppMenuRadioGroup,
  RadioItem: AppMenuRadioItem,
  RadioItemIndicator: AppMenuRadioItemIndicator,
  Root: BaseContextMenu.Root,
  ScrollArea: AppMenuScrollArea,
  ScrollContent: AppMenuScrollContent,
  ScrollViewport: AppMenuScrollViewport,
  Separator: AppMenuSeparator,
  SubmenuRoot: BaseMenu.SubmenuRoot,
  SubmenuTrigger: AppMenuSubmenuTrigger,
  Trigger: BaseContextMenu.Trigger,
}

export const AppMenu = {
  Arrow: BaseMenu.Arrow,
  Backdrop: AppMenuBackdrop,
  CheckboxItem: AppMenuCheckboxItem,
  CheckboxItemIndicator: AppMenuCheckboxItemIndicator,
  Context: AppMenuContext,
  Group: AppMenuGroup,
  GroupLabel: AppMenuGroupLabel,
  Item: AppMenuItem,
  LinkItem: AppMenuLinkItem,
  List: AppMenuList,
  Option: AppMenuOption,
  Popup: AppMenuPopup,
  Portal: BaseMenu.Portal,
  Positioner: AppMenuPositioner,
  RadioGroup: AppMenuRadioGroup,
  RadioItem: AppMenuRadioItem,
  RadioItemIndicator: AppMenuRadioItemIndicator,
  Root: BaseMenu.Root,
  ScrollArea: AppMenuScrollArea,
  ScrollContent: AppMenuScrollContent,
  ScrollViewport: AppMenuScrollViewport,
  Separator: AppMenuSeparator,
  SubmenuRoot: BaseMenu.SubmenuRoot,
  SubmenuTrigger: AppMenuSubmenuTrigger,
  Surface: AppMenuSurface,
  Trigger: AppMenuTrigger,
  TriggerSurface: AppMenuTriggerSurface,
  Viewport: BaseMenu.Viewport,
  createHandle: BaseMenu.createHandle,
}

export const AppMenuSelect = {
  Arrow: BaseSelect.Arrow,
  Backdrop: BaseSelect.Backdrop,
  Group: AppMenuSelectGroup,
  GroupLabel: AppMenuSelectGroupLabel,
  Icon: BaseSelect.Icon,
  Item: AppMenuSelectItem,
  ItemIndicator: AppMenuSelectItemIndicator,
  ItemText: BaseSelect.ItemText,
  Label: BaseSelect.Label,
  List: AppMenuSelectList,
  Popup: AppMenuSelectPopup,
  Portal: BaseSelect.Portal,
  Positioner: AppMenuSelectPositioner,
  Root: BaseSelect.Root,
  ScrollDownArrow: BaseSelect.ScrollDownArrow,
  ScrollList: AppMenuSelectScrollList,
  ScrollUpArrow: BaseSelect.ScrollUpArrow,
  Trigger: AppMenuSelectTrigger,
  Value: BaseSelect.Value,
}

export const AppMenuPopover = {
  Arrow: BasePopover.Arrow,
  Backdrop: BasePopover.Backdrop,
  Close: BasePopover.Close,
  Description: BasePopover.Description,
  Popup: AppMenuPopoverPopup,
  Portal: BasePopover.Portal,
  Positioner: AppMenuPopoverPositioner,
  Root: BasePopover.Root,
  Title: BasePopover.Title,
  Trigger: AppMenuPopoverTrigger,
  Viewport: BasePopover.Viewport,
}
