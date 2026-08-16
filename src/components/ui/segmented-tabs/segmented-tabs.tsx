import type { ReactNode } from 'react'
import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { AppTooltip } from '@/components/app-tooltip'
import './styles.css'

type SegmentedTabOptionBase<Value extends string> = {
  value: Value
  disabled?: boolean
  tooltip?: ReactNode
}

type SegmentedIconOnlyTabOption<Value extends string> = SegmentedTabOptionBase<Value> & {
  ariaLabel: string
  icon: ReactNode
  label?: never
}

type SegmentedLabelTabOption<Value extends string> = SegmentedTabOptionBase<Value> & {
  label: ReactNode
  ariaLabel?: string
  icon?: ReactNode
}

export type SegmentedTabOption<Value extends string> =
  | SegmentedIconOnlyTabOption<Value>
  | SegmentedLabelTabOption<Value>

type SegmentedTabsProps<Value extends string> = {
  ariaLabel: string
  options: readonly SegmentedTabOption<Value>[]
  value: Value
  onValueChange: (value: Value) => void
  children?: ReactNode
  className?: string
  controlAdjacent?: ReactNode
  controlClassName?: string
  controlContainerClassName?: string
  fill?: boolean
}

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

function getOptionContentKind<Value extends string>(option: SegmentedTabOption<Value>) {
  if (option.icon && option.label !== undefined) return 'icon-label'
  return option.icon ? 'icon' : 'label'
}

export function SegmentedTabs<Value extends string>({
  ariaLabel,
  children,
  className,
  controlAdjacent,
  controlClassName,
  controlContainerClassName,
  fill = false,
  options,
  value,
  onValueChange,
}: SegmentedTabsProps<Value>) {
  const control = (
    <BaseTabs.List
      className={joinClasses('segmented-tabs-control', controlClassName)}
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const tab = (
          <BaseTabs.Tab
            key={option.value}
            value={option.value}
            aria-label={option.ariaLabel}
            className={joinClasses(
              'segmented-tabs-option',
              value === option.value && 'is-active',
            )}
            data-content={getOptionContentKind(option)}
            disabled={option.disabled}
          >
            {option.icon ? (
              <span className='segmented-tabs-icon' aria-hidden='true'>
                {option.icon}
              </span>
            ) : null}
            {option.label !== undefined ? (
              <span className='segmented-tabs-label'>{option.label}</span>
            ) : null}
          </BaseTabs.Tab>
        )

        return option.tooltip === undefined ? tab : (
          <AppTooltip
            key={option.value}
            tooltip={option.tooltip}
            triggerMode='focusable'
          >
            {tab}
          </AppTooltip>
        )
      })}
      <BaseTabs.Indicator className='segmented-tabs-indicator' />
    </BaseTabs.List>
  )
  const hasControlContainer = Boolean(controlAdjacent || controlContainerClassName)

  return (
    <BaseTabs.Root
      className={joinClasses('segmented-tabs-root', className)}
      data-fill={fill ? '' : undefined}
      orientation='horizontal'
      value={value}
      onValueChange={(nextValue) => {
        const nextOption = options.find((option) => option.value === nextValue)
        if (nextOption && !nextOption.disabled) onValueChange(nextOption.value)
      }}
    >
      {hasControlContainer ? (
        <div className={joinClasses('segmented-tabs-control-container', controlContainerClassName)}>
          {control}
          {controlAdjacent}
        </div>
      ) : control}
      {children}
    </BaseTabs.Root>
  )
}

export const SegmentedTabPanel = BaseTabs.Panel
