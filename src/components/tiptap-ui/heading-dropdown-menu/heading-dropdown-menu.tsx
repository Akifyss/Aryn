import * as React from "react"

import { useTiptapEditor } from "@/hooks/use-tiptap-editor"
import type { UseHeadingDropdownMenuConfig } from "@/components/tiptap-ui/heading-dropdown-menu"
import { headingIcons, toggleHeading } from "@/components/tiptap-ui/heading-button"
import { useHeadingDropdownMenu } from "@/components/tiptap-ui/heading-dropdown-menu"
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button"
import { EditorDropdown } from "@/components/tiptap-ui-primitive/editor-dropdown"

type TriggerButtonProps = ButtonProps

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

    const items = levels.map((level) => ({
      icon: headingIcons[level],
      id: String(level),
      label: `Heading ${level}`,
    }))

    return (
      <EditorDropdown
        ref={ref}
        disabled={!canToggle}
        isActive={isActive}
        items={items}
        menuAriaLabel="Heading styles"
        onAction={handleAction}
        onOpenChange={onOpenChange}
        triggerAriaLabel="Format text as heading"
        triggerIcon={Icon}
        {...buttonProps}
      />
    )
  }
)

HeadingDropdownMenu.displayName = "HeadingDropdownMenu"

export default HeadingDropdownMenu
