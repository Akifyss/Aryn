import * as React from "react"
import { type Editor } from "@tiptap/react"

import { useTiptapEditor } from "@/hooks/use-tiptap-editor"
import { listIcons, listLabels, toggleList, type ListType } from "@/components/tiptap-ui/list-button"
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button"
import { EditorDropdown } from "@/components/tiptap-ui-primitive/editor-dropdown"
import { useListDropdownMenu } from "./use-list-dropdown-menu"

type TriggerButtonProps = ButtonProps

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

  const items = filteredLists.map((option) => ({
    icon: listIcons[option.type],
    id: option.type,
    label: listLabels[option.type],
  }))

  return (
    <EditorDropdown
      disabled={!canToggle}
      isActive={isActive}
      items={items}
      menuAriaLabel="List styles"
      onAction={handleAction}
      onOpenChange={onOpenChange}
      triggerAriaLabel="List options"
      triggerIcon={Icon}
      {...props}
    />
  )
}

export default ListDropdownMenu
