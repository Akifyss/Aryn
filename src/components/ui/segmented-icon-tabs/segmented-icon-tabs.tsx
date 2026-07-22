import type { ReactNode } from 'react'
import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { AppTooltip } from '@/components/app-tooltip'
import './styles.css'

export type SegmentedIconTabOption<Value extends string> = {
  ariaLabel: string
  icon: ReactNode
  tooltip: ReactNode
  value: Value
  disabled?: boolean
}

type SegmentedIconTabsProps<Value extends string> = {
  ariaLabel: string
  options: readonly SegmentedIconTabOption<Value>[]
  value: Value
  onValueChange: (value: Value) => void
  className?: string
  controlClassName?: string
}

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export function SegmentedIconTabs<Value extends string>({
  ariaLabel,
  options,
  value,
  onValueChange,
  className,
  controlClassName,
}: SegmentedIconTabsProps<Value>) {
  return (
    <BaseTabs.Root
      className={joinClasses('segmented-icon-tabs-root', className)}
      orientation='horizontal'
      value={value}
      onValueChange={(nextValue) => {
        const nextOption = options.find((option) => option.value === nextValue)
        if (nextOption && !nextOption.disabled) {
          onValueChange(nextOption.value)
        }
      }}
    >
      <BaseTabs.List
        className={joinClasses('segmented-icon-tabs-control', controlClassName)}
        aria-label={ariaLabel}
      >
        {options.map((option) => (
          <AppTooltip
            key={option.value}
            tooltip={option.tooltip}
            triggerMode='focusable'
          >
            <BaseTabs.Tab
              value={option.value}
              className={joinClasses(
                'segmented-icon-tabs-option',
                value === option.value && 'is-active',
              )}
              disabled={option.disabled}
              aria-label={option.ariaLabel}
            >
              {option.icon}
            </BaseTabs.Tab>
          </AppTooltip>
        ))}
        <BaseTabs.Indicator className='segmented-icon-tabs-indicator' />
      </BaseTabs.List>
    </BaseTabs.Root>
  )
}
