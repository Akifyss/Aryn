"use client";

import * as React from "react";
import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import { CheckLine, DownLine } from "@mingcute/react";

import { AppTooltipButton } from "@/components/app-tooltip";
import { cn } from "@/components/ui/viewer-utils";

const VIEWER_MENU_SURFACE =
  "z-50 min-w-32 rounded-lg border border-[var(--border-primary)] bg-[var(--overlay)] p-1 text-[var(--overlay-foreground)] shadow-lg outline-none";
const VIEWER_MENU_ITEM =
  "relative flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm text-[var(--foreground-primary)] outline-none transition-colors data-highlighted:bg-[var(--hover)] data-disabled:pointer-events-none data-disabled:opacity-50";
const VIEWER_MENU_OPTION = cn(VIEWER_MENU_ITEM, "pl-8");
const VIEWER_POPOVER_SURFACE =
  "z-50 rounded-lg border border-[var(--border-primary)] bg-[var(--overlay)] p-4 text-[var(--overlay-foreground)] shadow-lg outline-none data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0";

type ViewerControlButtonProps =
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: "icon-sm" | "sm";
    variant?: "ghost" | "outline";
  };

export function ViewerControlButton({
  className,
  size = "sm",
  variant = "ghost",
  ...props
}: ViewerControlButtonProps) {
  const iconOnly = size === "icon-sm";

  return (
    <AppTooltipButton
      {...props}
      className={cn(
        iconOnly ? "viewer-toolbar-icon-button" : "viewer-toolbar-text-button",
        variant === "outline" &&
          "border border-[var(--border-primary)] bg-[var(--background-primary)]",
        className,
      )}
    />
  );
}

export function ViewerToolbarButton({
  className,
  label,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
  label: string;
}) {
  return (
    <AppTooltipButton
      {...props}
      aria-label={props["aria-label"] ?? label}
      className={cn("viewer-toolbar-icon-button", className)}
      tooltip={label}
    />
  );
}

export function ViewerToolbarSeparator({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("viewer-toolbar-separator shrink-0", className)}
    />
  );
}

export function ViewerZoomSelect({
  ariaLabel,
  className,
  disabled,
  onValueChange,
  options,
  value,
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  onValueChange: (value: number) => void;
  options: readonly number[];
  value: number;
}) {
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center", className)}
    >
      <select
        aria-label={ariaLabel}
        className="viewer-toolbar-select min-w-0 appearance-none pr-8 text-center tabular-nums disabled:pointer-events-none disabled:opacity-50"
        disabled={disabled}
        style={{ minWidth: 84, width: 84 }}
        value={String(value)}
        onChange={(event) => onValueChange(Number(event.currentTarget.value))}
      >
        {options.map((option) => (
          <option key={option} value={String(option)}>
            {Math.round(option > 4 ? option : option * 100)}%
          </option>
        ))}
      </select>
      <DownLine
        aria-hidden="true"
        className="pointer-events-none absolute right-2 size-4 text-[var(--foreground-secondary)]"
      />
    </span>
  );
}

export const ViewerMenuRoot = Menu.Root;

export function ViewerMenuTrigger({
  children,
}: {
  asChild?: boolean;
  children: React.ReactElement;
}) {
  return <Menu.Trigger render={children} />;
}

export function ViewerMenuContent({
  align = "end",
  children,
  className,
  side = "bottom",
  sideOffset = 4,
}: {
  align?: "center" | "end" | "start";
  children: React.ReactNode;
  className?: string;
  side?: "bottom" | "left" | "right" | "top";
  sideOffset?: number;
}) {
  return (
    <Menu.Portal>
      <Menu.Positioner
        align={align}
        collisionPadding={8}
        side={side}
        sideOffset={sideOffset}
      >
        <Menu.Popup className={cn(VIEWER_MENU_SURFACE, className)}>
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

export function ViewerMenuItem({
  children,
  className,
  ...props
}: Menu.Item.Props) {
  return (
    <Menu.Item
      {...props}
      className={cn(VIEWER_MENU_ITEM, className as string | undefined)}
      nativeButton
      render={<button type="button" />}
    >
      {children}
    </Menu.Item>
  );
}

export function ViewerMenuCheckboxItem({
  checked,
  children,
  className,
  ...props
}: Menu.CheckboxItem.Props) {
  return (
    <Menu.CheckboxItem
      {...props}
      checked={checked}
      className={cn(VIEWER_MENU_OPTION, className as string | undefined)}
      nativeButton
      render={<button type="button" />}
    >
      <span className="pointer-events-none absolute left-2 grid size-4 place-items-center">
        <Menu.CheckboxItemIndicator>
          <CheckLine className="size-4" />
        </Menu.CheckboxItemIndicator>
      </span>
      {children}
    </Menu.CheckboxItem>
  );
}

export const ViewerMenuRadioGroup = Menu.RadioGroup;

export function ViewerMenuRadioItem({
  children,
  className,
  ...props
}: Menu.RadioItem.Props) {
  return (
    <Menu.RadioItem
      {...props}
      className={cn(VIEWER_MENU_OPTION, className as string | undefined)}
      nativeButton
      render={<button type="button" />}
    >
      <span className="pointer-events-none absolute left-2 grid size-4 place-items-center">
        <Menu.RadioItemIndicator>
          <span className="size-2 rounded-full bg-current" />
        </Menu.RadioItemIndicator>
      </span>
      {children}
    </Menu.RadioItem>
  );
}

export function ViewerMenuSeparator() {
  return <Menu.Separator className="mx-2 my-1 h-px bg-[var(--separator)]" />;
}

export const ViewerPopoverRoot = Popover.Root;

export function ViewerPopoverTrigger({
  children,
}: {
  asChild?: boolean;
  children: React.ReactElement;
}) {
  return <Popover.Trigger render={children} />;
}

export function ViewerPopoverContent({
  align = "end",
  children,
  className,
  side = "bottom",
  sideOffset = 4,
}: {
  align?: "center" | "end" | "start";
  children: React.ReactNode;
  className?: string;
  side?: "bottom" | "left" | "right" | "top";
  sideOffset?: number;
}) {
  return (
    <Popover.Portal>
      <Popover.Positioner
        align={align}
        collisionPadding={8}
        side={side}
        sideOffset={sideOffset}
      >
        <Popover.Popup className={cn(VIEWER_POPOVER_SURFACE, className)}>
          {children}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );
}
