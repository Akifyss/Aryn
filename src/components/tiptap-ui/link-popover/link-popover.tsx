"use client"

import * as React from "react"
import type { Editor } from "@tiptap/react"

import { useTiptapEditor } from "@/hooks/use-tiptap-editor"
import { CornerDownLeftIcon, ExternalLinkIcon, LinkIcon, TrashIcon } from "@/components/tiptap-icons"
import type { UseLinkPopoverConfig } from "@/components/tiptap-ui/link-popover"
import { useLinkPopover } from "@/components/tiptap-ui/link-popover"
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button"
import { Button } from "@/components/tiptap-ui-primitive/button"
import { Input } from "@/components/tiptap-ui-primitive/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/tiptap-ui-primitive/popover"

type TriggerButtonProps = ButtonProps

export interface LinkMainProps {
  url: string
  setUrl: React.Dispatch<React.SetStateAction<string | null>>
  setLink: () => void
  removeLink: () => void
  openLink: () => void
  isActive: boolean
}

export interface LinkPopoverProps
  extends Omit<TriggerButtonProps, "type">,
    UseLinkPopoverConfig {
  onOpenChange?: (isOpen: boolean) => void
  autoOpenOnLinkActive?: boolean
}

export const LinkButton = React.forwardRef<HTMLButtonElement, TriggerButtonProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        aria-label="Link"
        className={className}
        data-style="ghost"
        showTooltip={false}
        {...props}
      >
        {children || <LinkIcon className="tiptap-button-icon" />}
      </Button>
    )
  }
)

LinkButton.displayName = "LinkButton"

const LinkMain: React.FC<LinkMainProps> = ({
  url,
  setUrl,
  setLink,
  removeLink,
  openLink,
  isActive,
}) => {
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault()
      setLink()
    }
  }

  return (
    <div className="awa-link-popover">
      <Input
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        autoFocus
        placeholder="Paste a link..."
        type="url"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        onKeyDown={handleKeyDown}
      />

      <div className="awa-link-popover-actions">
        <Button
          aria-label="Apply link"
          data-style="ghost"
          disabled={!url && !isActive}
          showTooltip={false}
          onPress={setLink}
        >
          <CornerDownLeftIcon className="tiptap-button-icon" />
        </Button>
        <Button
          aria-label="Open link"
          data-style="ghost"
          disabled={!url && !isActive}
          showTooltip={false}
          onPress={openLink}
        >
          <ExternalLinkIcon className="tiptap-button-icon" />
        </Button>
        <Button
          aria-label="Remove link"
          data-style="ghost"
          disabled={!url && !isActive}
          showTooltip={false}
          onPress={removeLink}
        >
          <TrashIcon className="tiptap-button-icon" />
        </Button>
      </div>
    </div>
  )
}

export const LinkContent: React.FC<{
  editor?: Editor | null
}> = ({ editor }) => {
  const linkPopover = useLinkPopover({
    editor,
  })

  return <LinkMain {...linkPopover} />
}

export const LinkPopover = React.forwardRef<HTMLButtonElement, LinkPopoverProps>(
  (
    {
      editor: providedEditor,
      hideWhenUnavailable = false,
      onSetLink,
      onOpenChange,
      autoOpenOnLinkActive = true,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const [isOpen, setIsOpen] = React.useState(false)

    const {
      isVisible,
      canSet,
      isActive,
      url,
      setUrl,
      setLink,
      removeLink,
      openLink,
      label,
      Icon,
    } = useLinkPopover({
      editor,
      hideWhenUnavailable,
      onSetLink,
    })

    const handleOpenChange = React.useCallback(
      (nextIsOpen: boolean) => {
        setIsOpen(nextIsOpen)
        onOpenChange?.(nextIsOpen)
      },
      [onOpenChange]
    )

    const handleSetLink = React.useCallback(() => {
      setLink()
      setIsOpen(false)
    }, [setLink])

    const handleRemoveLink = React.useCallback(() => {
      removeLink()
      setIsOpen(false)
    }, [removeLink])

    const handleOpenLink = React.useCallback(() => {
      openLink()
      setIsOpen(false)
    }, [openLink])

    React.useEffect(() => {
      if (autoOpenOnLinkActive && isActive) {
        setIsOpen(true)
      }
    }, [autoOpenOnLinkActive, isActive])

    if (!isVisible) {
      return null
    }

    return (
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger>
          <LinkButton
            ref={ref}
            aria-label={label}
            aria-pressed={isActive}
            data-active-state={isActive ? "on" : "off"}
            disabled={!canSet}
            {...buttonProps}
          >
            {children ?? <Icon className="tiptap-button-icon" />}
          </LinkButton>
        </PopoverTrigger>

        <PopoverContent className="awa-link-popover-panel" placement="bottom start">
          <LinkMain
            url={url}
            setUrl={setUrl}
            setLink={handleSetLink}
            removeLink={handleRemoveLink}
            openLink={handleOpenLink}
            isActive={isActive}
          />
        </PopoverContent>
      </Popover>
    )
  }
)

LinkPopover.displayName = "LinkPopover"

export default LinkPopover
