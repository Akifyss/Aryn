import * as React from "react"
import { Dropdown } from "@heroui/react"

import { ChevronDownIcon } from "@/components/tiptap-icons"
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button"
import { Button } from "@/components/tiptap-ui-primitive/button"
import { cn } from "@/lib/tiptap-utils"

type IconComponent = React.ComponentType<{ className?: string }>

export interface EditorDropdownItem {
  icon: IconComponent
  id: string
  label: string
}

export interface EditorDropdownProps
  extends Omit<ButtonProps, "children" | "type"> {
  isActive?: boolean
  items: EditorDropdownItem[]
  menuAriaLabel: string
  onAction: (key: React.Key) => void
  onOpenChange?: (isOpen: boolean) => void
  triggerAriaLabel: string
  triggerIcon: IconComponent
}

export const EditorDropdown = React.forwardRef<
  HTMLButtonElement,
  EditorDropdownProps
>(
  (
    {
      className,
      disabled,
      isActive = false,
      items,
      menuAriaLabel,
      onAction,
      onOpenChange,
      triggerAriaLabel,
      triggerIcon: TriggerIcon,
      ...buttonProps
    },
    ref
  ) => {
    return (
      <Dropdown.Root onOpenChange={onOpenChange}>
        <Dropdown.Trigger>
          <Button
            ref={ref}
            aria-label={triggerAriaLabel}
            aria-pressed={isActive}
            className={cn(className)}
            data-active-state={isActive ? "on" : "off"}
            data-style="ghost"
            disabled={disabled}
            showTooltip={false}
            {...buttonProps}
          >
            <TriggerIcon className="tiptap-button-icon" />
            <ChevronDownIcon className="tiptap-button-dropdown-small" />
          </Button>
        </Dropdown.Trigger>

        <Dropdown.Popover
          className="editor-dropdown-popover"
          placement="bottom start"
        >
          <Dropdown.Menu
            aria-label={menuAriaLabel}
            className="editor-dropdown-menu"
            onAction={onAction}
          >
            {items.map((item) => {
              const ItemIcon = item.icon

              return (
                <Dropdown.Item
                  className="editor-dropdown-item"
                  id={item.id}
                  key={item.id}
                  textValue={item.label}
                >
                  <div className="editor-menu-item">
                    <ItemIcon className="tiptap-button-icon" />
                    <span className="editor-menu-label">{item.label}</span>
                  </div>
                </Dropdown.Item>
              )
            })}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown.Root>
    )
  }
)

EditorDropdown.displayName = "EditorDropdown"

export default EditorDropdown
