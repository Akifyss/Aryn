import * as React from "react"
import { type Editor } from "@tiptap/react"

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"

// --- Icons ---
import { ChevronDownIcon } from "@/components/tiptap-icons/chevron-down-icon"

// --- Tiptap UI ---
import { ListButton, type ListType } from "@/components/tiptap-ui/list-button"

import { useListDropdownMenu } from "./use-list-dropdown-menu"

// --- UI Primitives ---
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button"
import { Button, ButtonGroup } from "@/components/tiptap-ui-primitive/button"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/tiptap-ui-primitive/popover"
import { Card, CardBody } from "@/components/tiptap-ui-primitive/card"

export interface ListDropdownMenuProps extends Omit<ButtonProps, "type"> {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor
  /**
   * The list types to display in the dropdown.
   */
  types?: ListType[]
  /**
   * Whether the dropdown should be hidden when no list types are available
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Callback for when the dropdown opens or closes
   */
  onOpenChange?: (isOpen: boolean) => void
  /**
   * Whether to render the dropdown menu in a portal
   * @default false
   */
  portal?: boolean
}

export function ListDropdownMenu({
  editor: providedEditor,
  types = ["bulletList", "orderedList", "taskList"],
  hideWhenUnavailable = false,
  onOpenChange,
  portal = false,
  ...props
}: ListDropdownMenuProps) {
  const { editor } = useTiptapEditor(providedEditor)
  const [isOpen, setIsOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)

  const { filteredLists, isActive, isVisible, Icon } =
    useListDropdownMenu({
      editor,
      types,
      hideWhenUnavailable,
    })

  const handleOnOpenChange = React.useCallback(
    (open: boolean) => {
      setIsOpen(open)
      onOpenChange?.(open)
    },
    [onOpenChange]
  )

  React.useEffect(() => {
    if (!isOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null

      if (
        !target ||
        triggerRef.current?.contains(target) ||
        contentRef.current?.contains(target)
      ) {
        return
      }

      handleOnOpenChange(false)
    }

    document.addEventListener("pointerdown", handlePointerDown, true)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true)
    }
  }, [handleOnOpenChange, isOpen])

  if (!isVisible || !editor || !editor.isEditable) {
    return null
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOnOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          data-style="ghost"
          data-active-state={isActive ? "on" : "off"}
          role="button"
          tabIndex={-1}
          disabled={!editor?.isEditable}
          data-disabled={!editor?.isEditable}
          aria-label="List options"
          tooltip="List"
          {...props}
          ref={triggerRef}
        >
          <Icon className="tiptap-button-icon" />
          <ChevronDownIcon className="tiptap-button-dropdown-small" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" ref={contentRef}>
        <Card>
          <CardBody>
            <ButtonGroup>
              {filteredLists.map((option) => (
                <ListButton
                  key={option.type}
                  editor={editor}
                  type={option.type}
                  text={option.label}
                  showTooltip={false}
                  onToggled={() => handleOnOpenChange(false)}
                />
              ))}
            </ButtonGroup>
          </CardBody>
        </Card>
      </PopoverContent>
    </Popover>
  )
}

export default ListDropdownMenu
