import * as React from "react"
import { Popover as HeroPopover } from "@heroui/react"
import { cn } from "@/lib/tiptap-utils"
import "@/components/tiptap-ui-primitive/popover/popover.scss"

interface PopoverRootProps {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function Popover({ children, open, onOpenChange }: PopoverRootProps) {
  return (
    <HeroPopover.Root isOpen={open} onOpenChange={onOpenChange}>
      {children}
    </HeroPopover.Root>
  )
}

function PopoverTrigger(props: React.ComponentProps<typeof HeroPopover.Trigger>) {
  return <HeroPopover.Trigger {...props} />
}

function PopoverContent({
  className,
  ...props
}: React.ComponentProps<typeof HeroPopover.Content>) {
  const nextClassName =
    typeof className === "string" || className == null
      ? cn("tiptap-popover", className)
      : className

  return (
    <HeroPopover.Content className={nextClassName} {...props} />
  )
}

export { Popover, PopoverTrigger, PopoverContent }
