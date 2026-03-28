import * as React from "react"
import { Button, Dropdown } from "@heroui/react"

import { ChevronDownIcon } from "@/components/tiptap-icons"
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"
import type { UseHeadingDropdownMenuConfig } from "@/components/tiptap-ui/heading-dropdown-menu"
import { headingIcons, toggleHeading } from "@/components/tiptap-ui/heading-button"
import { useHeadingDropdownMenu } from "@/components/tiptap-ui/heading-dropdown-menu"

type TriggerButtonProps = React.ComponentProps<typeof Button>

export interface HeadingDropdownMenuProps
  extends Omit<TriggerButtonProps, "type">,
    UseHeadingDropdownMenuConfig {
  onOpenChange?: (isOpen: boolean) => void
}

export const HeadingDropdownMenu = React.forwardRef<
  HTMLButtonElement,
  HeadingDropdownMenuProps
>(
  (
    {
      editor: providedEditor,
      levels = [1, 2, 3, 4, 5, 6],
      hideWhenUnavailable = false,
      onOpenChange,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const { isVisible, isActive, canToggle, Icon } = useHeadingDropdownMenu({
      editor,
      levels,
      hideWhenUnavailable,
    })

    const handleAction = React.useCallback(
      (key: React.Key) => {
        if (!editor) {
          return
        }

        const level = Number(key)
        if (levels.includes(level as (typeof levels)[number])) {
          toggleHeading(editor, level as (typeof levels)[number])
        }
      },
      [editor, levels]
    )

    if (!isVisible) {
      return null
    }

    return (
      <Dropdown.Root onOpenChange={onOpenChange}>
        <Dropdown.Trigger>
          <Button
            ref={ref}
            aria-label="Format text as heading"
            aria-pressed={isActive}
            className="tiptap-button"
            data-active-state={isActive ? "on" : "off"}
            isDisabled={!canToggle}
            size="sm"
            variant="ghost"
            {...buttonProps}
          >
            <Icon className="tiptap-button-icon" />
            <ChevronDownIcon className="tiptap-button-dropdown-small" />
          </Button>
        </Dropdown.Trigger>

        <Dropdown.Popover placement="bottom start">
          <Dropdown.Menu aria-label="Heading styles" onAction={handleAction}>
            {levels.map((level) => {
              const LevelIcon = headingIcons[level]

              return (
                <Dropdown.Item
                  key={String(level)}
                  id={String(level)}
                  textValue={`Heading ${level}`}
                >
                  <div className="awa-editor-menu-item">
                    <LevelIcon className="tiptap-button-icon" />
                    <span>Heading {level}</span>
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

HeadingDropdownMenu.displayName = "HeadingDropdownMenu"

export default HeadingDropdownMenu
