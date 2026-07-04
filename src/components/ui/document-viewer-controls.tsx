"use client";

import * as React from "react";
import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import { ScrollArea } from "@base-ui/react/scroll-area";
import { Select } from "@base-ui/react/select";
import { CheckLine, DownLine, ZoomInLine, ZoomOutLine } from "@mingcute/react";

import { AppTooltipButton } from "@/components/app-tooltip";
import { cn } from "@/components/ui/viewer-utils";

const VIEWER_MENU_SURFACE =
  "z-50 min-w-32 rounded-lg border border-[var(--border-primary)] bg-[var(--overlay)] p-1 text-[var(--overlay-foreground)] shadow-lg outline-none";
const VIEWER_MENU_ITEM_BASE =
  "relative flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[var(--foreground-primary)] outline-none transition-colors data-highlighted:bg-[var(--hover)] data-disabled:pointer-events-none data-disabled:opacity-50";
const VIEWER_MENU_ITEM = cn(VIEWER_MENU_ITEM_BASE, "text-sm");
const VIEWER_MENU_OPTION = cn(VIEWER_MENU_ITEM, "pl-8");
const VIEWER_ZOOM_MENU_OPTION = cn(VIEWER_MENU_ITEM_BASE, "pl-8 text-sm");
const VIEWER_POPOVER_SURFACE =
  "z-50 rounded-lg border border-[var(--border-primary)] bg-[var(--overlay)] p-4 text-[var(--overlay-foreground)] shadow-lg outline-none data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0";
const ZOOM_VALUE_EPSILON = 0.000001;

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

function ViewerZoomSelect({
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
  const selectedValue = String(value);
  const items = options.map((option) => ({
    label: formatZoomOption(option),
    value: String(option),
  }));
  const menuMaxHeight = Math.min(items.length * 32 + 8, 384);

  return (
    <Select.Root
      disabled={disabled}
      items={items}
      modal={false}
      value={selectedValue}
      onValueChange={(nextValue) => {
        if (nextValue !== null) onValueChange(Number(nextValue));
      }}
    >
      <Select.Trigger
        type="button"
        aria-label={ariaLabel}
        className={cn(
          "viewer-toolbar-select inline-flex min-w-0 shrink-0 items-center justify-between gap-1 shadow-xs tabular-nums disabled:pointer-events-none disabled:cursor-default disabled:opacity-50",
          className,
        )}
        style={{ minWidth: 84, width: 84 }}
      >
        <Select.Value className="min-w-0 flex-1 text-center">
          {() => formatZoomOption(value)}
        </Select.Value>
        <Select.Icon className="flex shrink-0 items-center text-[var(--foreground-secondary)]">
          <DownLine aria-hidden="true" className="size-4" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          alignItemWithTrigger
          className="z-[82]"
          collisionPadding={8}
          positionMethod="fixed"
        >
          <Select.Popup
            className={cn(VIEWER_MENU_SURFACE, "w-32 overflow-hidden p-0")}
            style={{ maxHeight: menuMaxHeight }}
          >
            <ScrollArea.Root
              className="app-scroll-area h-full w-full"
              style={{ height: "100%", maxHeight: menuMaxHeight }}
            >
              <Select.List
                className="app-scroll-area-viewport p-1"
                render={(listProps) => {
                  const { children, style, ...viewportProps } = listProps;
                  const viewportStyle = { ...style };
                  delete viewportStyle.maxHeight;
                  delete viewportStyle.overflow;
                  delete viewportStyle.overflowX;
                  delete viewportStyle.overflowY;

                  return (
                    <ScrollArea.Viewport
                      {...viewportProps}
                      style={viewportStyle}
                    >
                      {children}
                    </ScrollArea.Viewport>
                  );
                }}
              >
                {items.map((item) => (
                  <Select.Item
                    key={item.value}
                    className={cn(
                      VIEWER_ZOOM_MENU_OPTION,
                      "tabular-nums data-selected:bg-[var(--hover)]",
                    )}
                    value={item.value}
                  >
                    <span className="pointer-events-none absolute left-2 grid size-4 place-items-center">
                      <Select.ItemIndicator>
                        <CheckLine aria-hidden="true" className="size-4" />
                      </Select.ItemIndicator>
                    </span>
                    <Select.ItemText>{item.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.List>
              <ScrollArea.Scrollbar
                className="app-scroll-area-scrollbar"
                orientation="vertical"
              >
                <ScrollArea.Thumb className="app-scroll-area-thumb" />
              </ScrollArea.Scrollbar>
            </ScrollArea.Root>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

export function ViewerZoomControls({
  ariaLabel,
  className,
  disabled = false,
  onValueChange,
  options,
  value,
  zoomInLabel,
  zoomOutLabel,
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  onValueChange: (value: number) => void;
  options: readonly number[];
  value: number;
  zoomInLabel: string;
  zoomOutLabel: string;
}) {
  const sortedOptions = getSortedZoomOptions(options);
  const zoomOutValue = getAdjacentZoomValue(sortedOptions, value, -1);
  const zoomInValue = getAdjacentZoomValue(sortedOptions, value, 1);
  const canZoomOut = zoomOutValue !== null;
  const canZoomIn = zoomInValue !== null;

  return (
    <div className={cn("flex flex-none items-center gap-1", className)}>
      <ViewerToolbarButton
        type="button"
        label={zoomOutLabel}
        disabled={disabled || !canZoomOut}
        onClick={() => {
          if (zoomOutValue !== null) onValueChange(zoomOutValue);
        }}
      >
        <ZoomOutLine aria-hidden="true" className="size-4" />
      </ViewerToolbarButton>
      <ViewerZoomSelect
        ariaLabel={ariaLabel}
        disabled={disabled}
        onValueChange={onValueChange}
        options={sortedOptions}
        value={value}
      />
      <ViewerToolbarButton
        type="button"
        label={zoomInLabel}
        disabled={disabled || !canZoomIn}
        onClick={() => {
          if (zoomInValue !== null) onValueChange(zoomInValue);
        }}
      >
        <ZoomInLine aria-hidden="true" className="size-4" />
      </ViewerToolbarButton>
    </div>
  );
}

function getSortedZoomOptions(options: readonly number[]) {
  return Array.from(new Set(options)).sort((left, right) => left - right);
}

function getAdjacentZoomValue(
  options: readonly number[],
  value: number,
  direction: 1 | -1,
) {
  if (direction > 0) {
    return (
      options.find((option) => option > value + ZOOM_VALUE_EPSILON) ?? null
    );
  }

  for (let index = options.length - 1; index >= 0; index -= 1) {
    const option = options[index];
    if (option < value - ZOOM_VALUE_EPSILON) return option;
  }

  return null;
}

export const __documentViewerControlsTestHooks = {
  getAdjacentZoomValue,
};

function formatZoomOption(value: number) {
  return `${Math.round(value > 4 ? value : value * 100)}%`;
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
