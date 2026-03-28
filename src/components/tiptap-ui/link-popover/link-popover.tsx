"use client"

import * as React from "react"
import type { Editor } from "@tiptap/react"
import { Button, Input, Popover } from "@heroui/react"

import { useTiptapEditor } from "@/hooks/use-tiptap-editor"
import { CornerDownLeftIcon, ExternalLinkIcon, LinkIcon, TrashIcon } from "@/components/tiptap-icons"
import type { UseLinkPopoverConfig } from "@/components/tiptap-ui/link-popover"
import { useLinkPopover } from "@/components/tiptap-ui/link-popover"

type TriggerButtonProps = React.ComponentProps<typeof Button>

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
        className={["tiptap-button", className].filter(Boolean).join(" ")}
        size="sm"
        variant="ghost"
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
        variant="secondary"
        onChange={(event) => setUrl(event.target.value)}
        onKeyDown={handleKeyDown}
      />

      <div className="awa-link-popover-actions">
        <Button
          isIconOnly
          isDisabled={!url && !isActive}
          size="sm"
          variant="ghost"
          onPress={setLink}
        >
          <CornerDownLeftIcon className="tiptap-button-icon" />
        </Button>
        <Button
          isIconOnly
          isDisabled={!url && !isActive}
          size="sm"
          variant="ghost"
          onPress={openLink}
        >
          <ExternalLinkIcon className="tiptap-button-icon" />
        </Button>
        <Button
          isIconOnly
          isDisabled={!url && !isActive}
          size="sm"
          variant="ghost"
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

    React.useEffect(() => {
      if (autoOpenOnLinkActive && isActive) {
        setIsOpen(true)
      }
    }, [autoOpenOnLinkActive, isActive])

    if (!isVisible) {
      return null
    }

    return (
      <Popover.Root isOpen={isOpen} onOpenChange={handleOpenChange}>
        <Popover.Trigger>
          <div>
            <LinkButton
              ref={ref}
              aria-label={label}
              aria-pressed={isActive}
              data-active-state={isActive ? "on" : "off"}
              isDisabled={!canSet}
              {...buttonProps}
            >
              {children ?? <Icon className="tiptap-button-icon" />}
            </LinkButton>
          </div>
        </Popover.Trigger>

        <Popover.Content placement="bottom">
          <LinkMain
            url={url}
            setUrl={setUrl}
            setLink={handleSetLink}
            removeLink={removeLink}
            openLink={openLink}
            isActive={isActive}
          />
        </Popover.Content>
      </Popover.Root>
    )
  }
)

LinkPopover.displayName = "LinkPopover"

export default LinkPopover
