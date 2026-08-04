"use client";

import * as React from "react";
import { Popover } from "@base-ui/react/popover";
import {
  CloseLine,
  DownLine,
  LeftLine,
  RightLine,
  SearchLine,
  ZoomInLine,
  ZoomOutLine,
} from "@mingcute/react";

import {
  AppMenu as Menu,
  AppMenuSelect as Select,
  type AppMenuCheckboxItemProps,
  type AppMenuItemProps,
  type AppMenuRadioItemProps,
  type AppMenuVisualTriggerProps,
} from "@/components/app-menu";
import {
  AppIconButton,
  type AppIconButtonProps,
} from "@/components/app-icon-button";
import { cn } from "@/components/ui/viewer-utils";

const VIEWER_POPOVER_SURFACE =
  "smooth-shadow-ring-sm z-50 rounded-lg bg-[var(--overlay)] p-4 text-[var(--overlay-foreground)] outline-none data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0";
const ZOOM_VALUE_EPSILON = 0.000001;

export function ViewerToolbarButton({
  className,
  label,
  ...props
}: Omit<AppIconButtonProps, "label" | "title" | "tooltip"> & {
  label: string;
}) {
  return (
    <AppIconButton
      {...props}
      aria-label={props["aria-label"] ?? label}
      className={className}
      tooltip={label}
    />
  );
}

export function ViewerToolbar({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("viewer-toolbar", className)} />;
}

export function ViewerToolbarGroup({
  align = "start",
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  align?: "start" | "end";
}) {
  return (
    <div
      {...props}
      className={cn("viewer-toolbar-control-group", className)}
      data-align={align}
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

export function ViewerPageNumberControl({
  activePage,
  className,
  controlsDisabled = false,
  currentPageEditLabel,
  onPageChange,
  pageCount,
  pageNumberLabel,
}: {
  activePage: number;
  className?: string;
  controlsDisabled?: boolean;
  currentPageEditLabel: string;
  onPageChange: (pageNumber: number) => void;
  pageCount: number;
  pageNumberLabel: string;
}) {
  const normalizedPageCount = Number.isFinite(pageCount)
    ? Math.max(0, Math.floor(pageCount))
    : 0;
  const normalizedActivePage = Number.isFinite(activePage) ? activePage : 1;
  const displayPage = normalizedPageCount
    ? clampPageNumber(normalizedActivePage, normalizedPageCount)
    : 1;
  const disabled = controlsDisabled || !normalizedPageCount;
  const pageNumberWidth = `${Math.max(2, String(Math.max(normalizedPageCount, displayPage)).length)}ch`;
  const [isEditing, setIsEditing] = React.useState(false);
  const [draftPage, setDraftPage] = React.useState(() => String(displayPage));
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!isEditing) {
      setDraftPage(String(displayPage));
    }
  }, [displayPage, isEditing]);

  React.useEffect(() => {
    if (!isEditing) return;

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditing]);

  React.useEffect(() => {
    if (disabled && isEditing) {
      setIsEditing(false);
    }
  }, [disabled, isEditing]);

  const applyPageDraft = React.useCallback(
    (value: string) => {
      if (!normalizedPageCount) return;

      const trimmedValue = value.trim();
      if (!/^\d+$/.test(trimmedValue)) return;

      const parsedPage = Number(trimmedValue);
      if (!Number.isInteger(parsedPage)) return;

      onPageChange(clampPageNumber(parsedPage, normalizedPageCount));
    },
    [normalizedPageCount, onPageChange],
  );

  const editLabel = `${currentPageEditLabel}：${displayPage}`;
  const totalLabel = normalizedPageCount ? String(normalizedPageCount) : "-";

  if (isEditing) {
    return (
      <form
        aria-label={pageNumberLabel}
        className={cn("viewer-toolbar-page-control", className)}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          applyPageDraft(draftPage);
          setIsEditing(false);
        }}
      >
        <input
          ref={inputRef}
          aria-label={pageNumberLabel}
          autoComplete="off"
          className="viewer-toolbar-page-input"
          disabled={disabled}
          inputMode="numeric"
          name="viewer-page-number"
          pattern="[0-9]*"
          style={{ width: pageNumberWidth }}
          value={draftPage}
          onBlur={() => setIsEditing(false)}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            const nextValue = event.target.value;

            setDraftPage(nextValue);
            applyPageDraft(nextValue);
          }}
          onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setDraftPage(String(displayPage));
              setIsEditing(false);
              return;
            }

            if (event.key === "Enter") {
              event.preventDefault();
              applyPageDraft(event.currentTarget.value);
              setIsEditing(false);
            }
          }}
        />
        <span aria-hidden="true" className="viewer-toolbar-page-divider">
          /
        </span>
        <span className="viewer-toolbar-page-total">{totalLabel}</span>
      </form>
    );
  }

  return (
    <button
      type="button"
      aria-label={editLabel}
      className={cn("viewer-toolbar-page-control", className)}
      disabled={disabled}
      onClick={() => {
        setDraftPage(String(displayPage));
        setIsEditing(true);
      }}
    >
      <span
        className="viewer-toolbar-page-current"
        style={{ width: pageNumberWidth }}
      >
        {displayPage}
      </span>
      <span aria-hidden="true" className="viewer-toolbar-page-divider">
        /
      </span>
      <span className="viewer-toolbar-page-total">{totalLabel}</span>
    </button>
  );
}

export function ViewerSearchPanel({
  canClear,
  clearLabel,
  detailLabel,
  hasResults,
  inputLabel,
  isSearching = false,
  nextResultLabel,
  onClear,
  onInputKeyDown,
  onNextResult,
  onPreviousResult,
  onValueChange,
  placeholder,
  previousResultLabel,
  resultLabel,
  value,
}: {
  canClear: boolean;
  clearLabel: string;
  detailLabel?: React.ReactNode;
  hasResults: boolean;
  inputLabel: string;
  isSearching?: boolean;
  nextResultLabel: string;
  onClear: () => void;
  onInputKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onNextResult: () => void;
  onPreviousResult: () => void;
  onValueChange: (value: string) => void;
  placeholder: string;
  previousResultLabel: string;
  resultLabel: React.ReactNode;
  value: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const navigationDisabled = isSearching || !hasResults;
  const showFooter =
    isSearching || hasResults || canClear || Boolean(detailLabel);
  const handleInputKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      onInputKeyDown?.(event);
      if (event.defaultPrevented || event.key !== "Enter" || !hasResults) {
        return;
      }

      event.preventDefault();
      if (event.shiftKey) {
        onPreviousResult();
      } else {
        onNextResult();
      }
    },
    [hasResults, onInputKeyDown, onNextResult, onPreviousResult],
  );
  const handleClear = React.useCallback(() => {
    onClear();
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [onClear]);

  return (
    <div className="viewer-search-panel" role="search">
      <div className="viewer-search-field">
        <SearchLine aria-hidden="true" className="viewer-search-field-icon" />
        <input
          ref={inputRef}
          autoFocus
          aria-label={inputLabel}
          autoComplete="off"
          className="viewer-search-input"
          enterKeyHint="search"
          inputMode="search"
          name="viewer-search"
          placeholder={placeholder}
          spellCheck={false}
          type="search"
          value={value}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          onKeyDown={handleInputKeyDown}
        />
        {hasResults || canClear ? (
          <div className="viewer-search-inline-actions">
            {hasResults ? (
              <>
                <AppIconButton
                  type="button"
                  label={previousResultLabel}
                  size="sm"
                  disabled={navigationDisabled}
                  onClick={onPreviousResult}
                >
                  <LeftLine aria-hidden="true" className="size-[var(--icon-size-md)]" />
                </AppIconButton>
                <AppIconButton
                  type="button"
                  label={nextResultLabel}
                  size="sm"
                  disabled={navigationDisabled}
                  onClick={onNextResult}
                >
                  <RightLine aria-hidden="true" className="size-[var(--icon-size-md)]" />
                </AppIconButton>
              </>
            ) : null}
            {canClear ? (
              <AppIconButton
                type="button"
                label={clearLabel}
                size="sm"
                onClick={handleClear}
              >
                <CloseLine aria-hidden="true" className="size-[var(--icon-size-md)]" />
              </AppIconButton>
            ) : null}
          </div>
        ) : null}
      </div>
      {showFooter ? (
        <div className="viewer-search-footer">
          <div className="viewer-search-result">
            <div className="viewer-search-result-label" aria-live="polite">
              {resultLabel}
            </div>
            {detailLabel ? (
              <div className="viewer-search-result-detail">{detailLabel}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
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
          "viewer-toolbar-select shrink-0 justify-between tabular-nums",
          className,
        )}
        size="md"
        variant="outline"
      >
        <Select.Value className="min-w-0 flex-1 text-center">
          {() => formatZoomOption(value)}
        </Select.Value>
        <Select.Icon className="flex shrink-0 items-center text-[var(--foreground-secondary)]">
          <DownLine aria-hidden="true" className="size-[var(--icon-size-md)]" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          alignItemWithTrigger
          positionMethod="fixed"
        >
          <Select.Popup size="sm">
            <Select.ScrollList>
              {items.map((item) => (
                <Select.Item
                  key={item.value}
                  className="tabular-nums"
                  label={item.label}
                  text={item.label}
                  value={item.value}
                />
              ))}
            </Select.ScrollList>
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
        <ZoomOutLine aria-hidden="true" className="size-[var(--icon-size-md)]" />
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
        <ZoomInLine aria-hidden="true" className="size-[var(--icon-size-md)]" />
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

function clampPageNumber(pageNumber: number, pageCount: number) {
  return Math.min(Math.max(pageNumber, 1), Math.max(pageCount, 1));
}

export const __documentViewerControlsTestHooks = {
  getAdjacentZoomValue,
};

function formatZoomOption(value: number) {
  return `${Math.round(value > 4 ? value : value * 100)}%`;
}

export const ViewerMenuRoot = Menu.Root;

export function ViewerMenuTrigger({
  "aria-label": ariaLabel,
  children,
  label,
  ...props
}: Omit<AppMenuVisualTriggerProps, "iconTooltip" | "render" | "variant"> & {
  label: string;
}) {
  return (
    <Menu.Trigger
      {...props}
      aria-label={ariaLabel ?? label}
      iconTooltip={label}
      variant="icon"
    >
      {children}
    </Menu.Trigger>
  );
}

export function ViewerMenuContent({
  align = "end",
  children,
  className,
  side = "bottom",
  sideOffset,
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
        side={side}
        sideOffset={sideOffset}
      >
        <Menu.Popup className={className} size="sm">
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
}: AppMenuItemProps) {
  return (
    <Menu.Item
      {...props}
      className={className}
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
}: AppMenuCheckboxItemProps) {
  return (
    <Menu.CheckboxItem
      {...props}
      checked={checked}
      className={className}
    >
      {children}
    </Menu.CheckboxItem>
  );
}

export const ViewerMenuRadioGroup = Menu.RadioGroup;

export function ViewerMenuRadioItem({
  children,
  className,
  ...props
}: AppMenuRadioItemProps) {
  return (
    <Menu.RadioItem
      {...props}
      className={className}
    >
      {children}
    </Menu.RadioItem>
  );
}

export function ViewerMenuSeparator() {
  return <Menu.Separator />;
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
