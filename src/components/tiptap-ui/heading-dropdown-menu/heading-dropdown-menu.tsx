import * as React from "react"

// --- Icons ---
import { ChevronDownIcon } from "@/components/tiptap-icons/chevron-down-icon"

// --- Hooks ---
import { useComposedRef } from "@/hooks/use-composed-ref"
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"

// --- Tiptap UI ---
import { HeadingButton } from "@/components/tiptap-ui/heading-button"
import type { UseHeadingDropdownMenuConfig } from "@/components/tiptap-ui/heading-dropdown-menu"
import { useHeadingDropdownMenu } from "@/components/tiptap-ui/heading-dropdown-menu"

// --- UI Primitives ---
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button"
import { Button, ButtonGroup } from "@/components/tiptap-ui-primitive/button"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/tiptap-ui-primitive/popover"
import { Card, CardBody } from "@/components/tiptap-ui-primitive/card"

export interface HeadingDropdownMenuProps
  extends Omit<ButtonProps, "type">,
    UseHeadingDropdownMenuConfig {
  /**
   * Whether to render the dropdown menu in a portal
   * @default false
   */
  portal?: boolean
  /**
   * Callback for when the dropdown opens or closes
   */
  onOpenChange?: (isOpen: boolean) => void
}

/**
 * Dropdown menu component for selecting heading levels in a Tiptap editor.
 *
 * For custom dropdown implementations, use the `useHeadingDropdownMenu` hook instead.
 */
export const HeadingDropdownMenu = React.forwardRef<
  HTMLButtonElement,
  HeadingDropdownMenuProps
>(
  (
    {
      editor: providedEditor,
      levels = [1, 2, 3, 4, 5, 6],
      hideWhenUnavailable = false,
      portal = false,
      onOpenChange,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const [isOpen, setIsOpen] = React.useState(false)
    const triggerRef = React.useRef<HTMLButtonElement | null>(null)
    const contentRef = React.useRef<HTMLDivElement | null>(null)
    const composedRef = useComposedRef(triggerRef, ref)
    const { isVisible, isActive, Icon } = useHeadingDropdownMenu({
      editor,
      levels,
      hideWhenUnavailable,
    })

    const handleOpenChange = React.useCallback(
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

        handleOpenChange(false)
      }

      document.addEventListener("pointerdown", handlePointerDown, true)

      return () => {
        document.removeEventListener("pointerdown", handlePointerDown, true)
      }
    }, [handleOpenChange, isOpen])

    if (!isVisible) {
      return null
    }

    return (
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            data-style="ghost"
            data-active-state={isActive ? "on" : "off"}
            role="button"
            tabIndex={-1}
            disabled={!editor?.isEditable}
            data-disabled={!editor?.isEditable}
            aria-label="Format text as heading"
            aria-pressed={isActive}
            tooltip="Heading"
            {...buttonProps}
            ref={composedRef}
          >
            <Icon className="tiptap-button-icon" />
            <ChevronDownIcon className="tiptap-button-dropdown-small" />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" ref={contentRef}>
          <Card>
            <CardBody>
              <ButtonGroup>
                {levels.map((level) => (
                  <HeadingButton
                    key={`heading-${level}`}
                    editor={editor}
                    level={level}
                    text={`Heading ${level}`}
                    showTooltip={false}
                    onToggled={() => handleOpenChange(false)}
                  />
                ))}
              </ButtonGroup>
            </CardBody>
          </Card>
        </PopoverContent>
      </Popover>
    )
  }
)

HeadingDropdownMenu.displayName = "HeadingDropdownMenu"

export default HeadingDropdownMenu
