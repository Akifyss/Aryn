import { Icon } from '@iconify/react'
import {
  AppMenuSelect as Select,
} from '@/components/app-menu'
import './styles.css'

export type SettingsSelectOption = {
  label: string
  value: string
}

type SettingsSelectProps = {
  ariaLabel: string
  className?: string
  disabled?: boolean
  onValueChange: (value: string) => void
  options: SettingsSelectOption[]
  placeholder?: string
  value: string | null
}

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export function SettingsSelect({
  ariaLabel,
  className,
  disabled = false,
  onValueChange,
  options,
  placeholder,
  value,
}: SettingsSelectProps) {
  return (
    <Select.Root
      disabled={disabled}
      items={options}
      modal={false}
      value={value}
      onValueChange={(nextValue) => {
        if (typeof nextValue === 'string') {
          onValueChange(nextValue)
        }
      }}
    >
      <Select.Trigger
        type='button'
        aria-label={ariaLabel}
        className={joinClasses('settings-select-trigger', className)}
        variant='outline'
      >
        <Select.Value className='settings-select-value' placeholder={placeholder} />
        <Select.Icon className='settings-select-icon'>
          <Icon icon='mingcute:down-line' />
        </Select.Icon>
      </Select.Trigger>
      <Select.Positioner
        align='start'
        alignItemWithTrigger
        positionMethod='fixed'
        side='bottom'
      >
        <Select.Popup
          className='settings-select-popup'
          size='fit'
        >
          <Select.ScrollList scrollAreaClassName='settings-select-scroll'>
            {options.map((option) => (
              <Select.Item
                key={option.value}
                indicator={<Icon icon='mingcute:check-line' />}
                label={option.label}
                text={option.label}
                value={option.value}
              />
            ))}
          </Select.ScrollList>
        </Select.Popup>
      </Select.Positioner>
    </Select.Root>
  )
}
