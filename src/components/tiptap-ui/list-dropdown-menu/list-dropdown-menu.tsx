import * as React from "react"
import { Button, Dropdown } from "@heroui/react"
import { type Editor } from "@tiptap/react"

import { useTiptapEditor } from "@/hooks/use-tiptap-editor"
import { ChevronDownIcon } from "@/components/tiptap-icons"
import { listIcons, listLabels, toggleList, type ListType } from "@/components/tiptap-ui/list-button"
import { useListDropdownMenu } from "./use-list-dropdown-menu"

type TriggerButtonProps = React.ComponentProps<typeof Button>

export interface ListDropdownMenuProps extends Omit<TriggerButtonProps, "type"> {
  editor?: Editor
  types?: ListType[]
  hideWhenUnavailable?: boolean
  onOpenChange?: (isOpen: boolean) => void
}

export function ListDropdownMenu({
  editor: providedEditor,
  types = ["bulletList", "orderedList", "taskList"],
  hideWhenUnavailable = false,
  onOpenChange,
  ...props
}: ListDropdownMenuProps) {
  const { editor } = useTiptapEditor(providedEditor)
  const { filteredLists, canToggle, isActive, isVisible, Icon } =
    useListDropdownMenu({
      editor,
      types,
      hideWhenUnavailable,
    })

  const handleAction = React.useCallback(
    (key: React.Key) => {
      if (!editor) {
        return
      }

      const listType = String(key) as ListType
      if (types.includes(listType)) {
        toggleList(editor, listType)
      }
    },
    [editor, types]
  )

  if (!isVisible || !editor || !editor.isEditable) {
    return null
  }

  return (
    <Dropdown.Root onOpenChange={onOpenChange}>
      <Dropdown.Trigger>
        <Button
          aria-label="List options"
          className="tiptap-button"
          data-active-state={isActive ? "on" : "off"}
          isDisabled={!canToggle}
          size="sm"
          variant="ghost"
          {...props}
        >
          <Icon className="tiptap-button-icon" />
          <ChevronDownIcon className="tiptap-button-dropdown-small" />
        </Button>
      </Dropdown.Trigger>

      <Dropdown.Popover placement="bottom start">
        <Dropdown.Menu aria-label="List styles" onAction={handleAction}>
          {filteredLists.map((option) => {
            const OptionIcon = listIcons[option.type]

            return (
              <Dropdown.Item
                key={option.type}
                id={option.type}
                textValue={listLabels[option.type]}
              >
                <div className="awa-editor-menu-item">
                  <OptionIcon className="tiptap-button-icon" />
                  <span>{listLabels[option.type]}</span>
                </div>
              </Dropdown.Item>
            )
          })}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown.Root>
  )
}

export default ListDropdownMenu
