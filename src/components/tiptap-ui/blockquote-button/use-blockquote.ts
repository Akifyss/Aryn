"use client"

import * as React from "react"
import type { Editor } from "@tiptap/react"
import { NodeSelection, TextSelection } from "@tiptap/pm/state"

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"

// --- Icons ---
import { BlockquoteIcon } from "@/components/tiptap-icons"

// --- UI Utils ---
import {
  findNodePosition,
  isNodeInSchema,
  isNodeTypeSelected,
  isValidPosition,
} from "@/lib/tiptap-utils"

export const BLOCKQUOTE_SHORTCUT_KEY = "mod+shift+b"

/**
 * Configuration for the blockquote functionality
 */
export interface UseBlockquoteConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null
  /**
   * Whether the button should hide when blockquote is not available.
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Callback function called after a successful toggle.
   */
  onToggled?: () => void
}

/**
 * Checks if blockquote can be toggled in the current editor state
 */
export function canToggleBlockquote(
  editor: Editor | null,
  turnInto: boolean = true
): boolean {
  if (!editor || !editor.isEditable) return false
  if (
    !isNodeInSchema("blockquote", editor) ||
    isNodeTypeSelected(editor, ["image"])
  )
    return false

  try {
    if (!turnInto) {
      return editor.can().chain().focus().toggleBlockquote().run()
    }

    return editor.can().chain().focus().toggleBlockquote().run()
  } catch {
    return false
  }
}

/**
 * Toggles blockquote formatting for a specific node or the current selection
 */
export function toggleBlockquote(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (!canToggleBlockquote(editor)) return false

  try {
    return editor.chain().focus().toggleBlockquote().run()
  } catch {
    return false
  }
}

/**
 * Determines if the blockquote button should be shown
 */
export function shouldShowButton(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, hideWhenUnavailable } = props

  if (!editor || !editor.isEditable) return false
  if (!isNodeInSchema("blockquote", editor)) return false

  if (hideWhenUnavailable && !editor.isActive("code")) {
    return canToggleBlockquote(editor)
  }

  return true
}

/**
 * Custom hook that provides blockquote functionality for Tiptap editor
 *
 * @example
 * ```tsx
 * // Simple usage - no params needed
 * function MySimpleBlockquoteButton() {
 *   const { isVisible, handleToggle, isActive } = useBlockquote()
 *
 *   if (!isVisible) return null
 *
 *   return <button onClick={handleToggle}>Blockquote</button>
 * }
 *
 * // Advanced usage with configuration
 * function MyAdvancedBlockquoteButton() {
 *   const { isVisible, handleToggle, label, isActive } = useBlockquote({
 *     editor: myEditor,
 *     hideWhenUnavailable: true,
 *     onToggled: () => console.log('Blockquote toggled!')
 *   })
 *
 *   if (!isVisible) return null
 *
 *   return (
 *     <MyButton
 *       onClick={handleToggle}
 *       aria-label={label}
 *       aria-pressed={isActive}
 *     >
 *       Toggle Blockquote
 *     </MyButton>
 *   )
 * }
 * ```
 */
export function useBlockquote(config?: UseBlockquoteConfig) {
  const {
    editor: providedEditor,
    hideWhenUnavailable = false,
    onToggled,
  } = config || {}

  const { editor } = useTiptapEditor(providedEditor)
  const [isVisible, setIsVisible] = React.useState<boolean>(true)
  const canToggle = canToggleBlockquote(editor)
  const isActive = editor?.isActive("blockquote") || false

  React.useEffect(() => {
    if (!editor) return

    const handleSelectionUpdate = () => {
      setIsVisible(shouldShowButton({ editor, hideWhenUnavailable }))
    }

    handleSelectionUpdate()

    editor.on("selectionUpdate", handleSelectionUpdate)

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate)
    }
  }, [editor, hideWhenUnavailable])

  const handleToggle = React.useCallback(() => {
    if (!editor) return false

    const success = toggleBlockquote(editor)
    if (success) {
      onToggled?.()
    }
    return success
  }, [editor, onToggled])

  return {
    isVisible,
    isActive,
    handleToggle,
    canToggle,
    label: "Blockquote",
    shortcutKeys: BLOCKQUOTE_SHORTCUT_KEY,
    Icon: BlockquoteIcon,
  }
}

