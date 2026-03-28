import * as React from "react"
import { Button as HeroButton, Tooltip as HeroTooltip } from "@heroui/react"

// --- Lib ---
import { cn, parseShortcutKeys } from "@/lib/tiptap-utils"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string
  showTooltip?: boolean
  tooltip?: React.ReactNode
  shortcutKeys?: string
}

export const ShortcutDisplay: React.FC<{ shortcuts: string[] }> = ({
  shortcuts,
}) => {
  if (shortcuts.length === 0) return null

  return (
    <div>
      {shortcuts.map((key, index) => (
        <React.Fragment key={index}>
          {index > 0 && <kbd>+</kbd>}
          <kbd>{key}</kbd>
        </React.Fragment>
      ))}
    </div>
  )
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      children,
      tooltip,
      showTooltip = true,
      shortcutKeys,
      "aria-label": ariaLabel,
      ...props
    },
    ref
  ) => {
    const styleVariant =
      (props as Record<string, unknown>)["data-style"] === "primary"
        ? "primary"
        : "ghost"
    const shortcuts = React.useMemo(
      () => parseShortcutKeys({ shortcutKeys }),
      [shortcutKeys]
    )

    if (!tooltip || !showTooltip) {
      return (
        <HeroButton
          className={cn("tiptap-button", className)}
          isDisabled={props.disabled}
          ref={ref}
          size="sm"
          variant={styleVariant}
          aria-label={ariaLabel}
          {...(props as React.ComponentProps<typeof HeroButton>)}
        >
          {children}
        </HeroButton>
      )
    }

    return (
      <HeroTooltip>
        <HeroTooltip.Trigger>
          <HeroButton
            className={cn("tiptap-button", className)}
            isDisabled={props.disabled}
            ref={ref}
            size="sm"
            variant={styleVariant}
            aria-label={ariaLabel}
            {...(props as React.ComponentProps<typeof HeroButton>)}
          >
            {children}
          </HeroButton>
        </HeroTooltip.Trigger>
        <HeroTooltip.Content>
          {tooltip}
          <ShortcutDisplay shortcuts={shortcuts} />
        </HeroTooltip.Content>
      </HeroTooltip>
    )
  }
)

Button.displayName = "Button"

export const ButtonGroup = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    orientation?: "horizontal" | "vertical"
  }
>(({ className, children, orientation = "vertical", ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn("tiptap-button-group", className)}
      data-orientation={orientation}
      role="group"
      {...props}
    >
      {children}
    </div>
  )
})
ButtonGroup.displayName = "ButtonGroup"

export default Button
