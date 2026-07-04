"use client";

import * as React from "react";
import {
  useXlsxViewer,
  useXlsxViewerController,
  useXlsxViewerThumbnails,
  useXlsxViewerZoom,
  XlsxViewer,
  XlsxViewerProvider,
  type XlsxCellAddress,
  type XlsxScrollerRenderProps,
  type XlsxSheetData,
  type XlsxTableHeaderMenuRenderProps,
  type XlsxViewerController,
  setWasmSource,
} from "@extend-ai/react-xlsx";
import xlsxWasmUrl from "@extend-ai/react-xlsx/duke_sheets_wasm_bg.wasm?url";
import {
  DownloadLine,
  MoonLine,
  More2Line,
  SearchLine,
  UploadLine,
} from "@mingcute/react";
import { Spinner } from "@heroui/react";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { createPortal } from "react-dom";

import { AppScrollArea } from "@/components/app-scroll-area";
import { AppTooltip } from "@/components/app-tooltip";
import { cn } from "@/components/ui/viewer-utils";
import {
  ViewerControlButton as Button,
  ViewerMenuCheckboxItem as DropdownMenuCheckboxItem,
  ViewerMenuContent as DropdownMenuContent,
  ViewerMenuItem as DropdownMenuItem,
  ViewerMenuRadioGroup as DropdownMenuRadioGroup,
  ViewerMenuRadioItem as DropdownMenuRadioItem,
  ViewerMenuRoot as DropdownMenu,
  ViewerMenuSeparator as DropdownMenuSeparator,
  ViewerMenuTrigger as DropdownMenuTrigger,
  ViewerPopoverContent as PopoverContent,
  ViewerPopoverRoot as Popover,
  ViewerPopoverTrigger as PopoverTrigger,
  ViewerSearchPanel,
  ViewerToolbarSeparator as Separator,
  ViewerZoomControls,
} from "@/components/ui/document-viewer-controls";
import { VIEWER_COPY } from "@/components/ui/viewer-copy";

const xlsxWasmState = globalThis as typeof globalThis & {
  __arynXlsxViewerWasmConfigured?: boolean;
};

if (!xlsxWasmState.__arynXlsxViewerWasmConfigured) {
  setWasmSource(xlsxWasmUrl);
  xlsxWasmState.__arynXlsxViewerWasmConfigured = true;
}

const XLSX_LOADING_INDICATOR_DELAY_MS = 300;
const XLSX_DROPDOWN_Z_INDEX_CLASS = "z-40";
const XLSX_SEARCH_BATCH_ROW_COUNT = 500;
const XLSX_SEARCH_DEBOUNCE_MS = 300;
const XLSX_GRID_HEADER_HEIGHT = 24;
const XLSX_GRID_ROW_HEADER_WIDTH = 40;
const XLSX_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const ZOOM_OPTIONS = [10, 25, 50, 75, 100, 125, 150, 175, 200, 400] as const;

// Stable reference so the thumbnails memo isn't invalidated on every render
// (e.g. by selection changes), which would recompute every sheet thumbnail.
const XLSX_SHEET_TAB_THUMBNAIL_OPTIONS = {
  resolution: {
    maxHeight: 360,
    maxWidth: 560,
  },
} as const;

type UploadedWorkbook = {
  buffer: ArrayBuffer;
  fileName: string;
  identity: string;
};

type XlsxSearchResult = {
  cell: XlsxCellAddress;
  displayValue: string;
  formula?: string;
  sheetIndex: number;
  sheetName: string;
  workbookSheetIndex: number;
};

type XlsxBatchCell = {
  col?: unknown;
  formula?: unknown;
  value?: unknown;
};

type XlsxBatchRow = {
  cells?: unknown;
  index?: unknown;
};

function formatWorkbookName(fileName: string | undefined, url: string) {
  if (fileName?.trim()) return fileName;

  const pathname = url.split("?")[0] ?? "";
  const rawName = pathname.split("/").pop() ?? "workbook.xlsx";

  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

function ensureWorkbookExtension(fileName: string) {
  const lowerFileName = fileName.toLowerCase();
  return lowerFileName.endsWith(".xlsx") || lowerFileName.endsWith(".xls")
    ? fileName
    : `${fileName}.xlsx`;
}

function downloadWorkbookBuffer(buffer: ArrayBuffer, fileName: string) {
  const resolvedFileName = ensureWorkbookExtension(fileName);
  const blob = new Blob([buffer], {
    type: resolvedFileName.toLowerCase().endsWith(".xls")
      ? "application/vnd.ms-excel"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = resolvedFileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function normalizeSearchText(value: unknown) {
  return typeof value === "string"
    ? value
    : value === null || value === undefined
      ? ""
      : String(value);
}

function cellValueToSearchText(value: unknown) {
  if (!value || typeof value !== "object") return normalizeSearchText(value);

  const record = value as {
    asBoolean?: () => boolean | null;
    asError?: () => string | null;
    asNumber?: () => number | null;
    asText?: () => string | null;
    is_boolean?: boolean;
    is_empty?: boolean;
    is_error?: boolean;
    is_number?: boolean;
    is_text?: boolean;
  };

  if (record.is_empty) return "";
  if (record.is_error) return record.asError?.() ?? "";
  if (record.is_text) return record.asText?.() ?? "";
  if (record.is_number) return normalizeSearchText(record.asNumber?.());
  if (record.is_boolean) return record.asBoolean?.() ? "TRUE" : "FALSE";

  return normalizeSearchText(value);
}

function getCellSearchText(
  controller: XlsxViewerController,
  sheet: XlsxSheetData,
  row: number,
  col: number,
) {
  const worksheet = controller.workbook?.getSheet(sheet.workbookSheetIndex);
  if (!worksheet) return { displayValue: "", formula: "" };

  const formula = worksheet.getFormulaAt(row, col) ?? "";
  const cachedFormulaValue = formula
    ? sheet.cachedFormulaValues[cellAddressToA1({ row, col })]
    : undefined;
  const formatted = worksheet.getFormattedValueAt(row, col);

  if (
    formatted &&
    !(formula && cachedFormulaValue !== undefined && formatted.startsWith("#"))
  ) {
    return { displayValue: formatted, formula };
  }

  const calculated = worksheet.getCalculatedValueAt(row, col);
  const displayValue =
    formula && cachedFormulaValue !== undefined && calculated.is_error
      ? cachedFormulaValue
      : cellValueToSearchText(calculated);

  return { displayValue, formula };
}

function getBatchRows(rows: unknown): XlsxBatchRow[] {
  return Array.isArray(rows) ? (rows as XlsxBatchRow[]) : [];
}

function getBatchCells(row: XlsxBatchRow): XlsxBatchCell[] {
  return Array.isArray(row.cells) ? (row.cells as XlsxBatchCell[]) : [];
}

function cellMatchesQuery(
  displayValue: string,
  formula: string,
  query: string,
) {
  return (
    displayValue.toLowerCase().includes(query) ||
    formula.toLowerCase().includes(query)
  );
}

function cellAddressToA1({ col, row }: XlsxCellAddress) {
  let columnNumber = col + 1;
  let columnName = "";

  while (columnNumber > 0) {
    const remainder = (columnNumber - 1) % 26;
    columnName = String.fromCharCode(65 + remainder) + columnName;
    columnNumber = Math.floor((columnNumber - 1) / 26);
  }

  return `${columnName}${row + 1}`;
}

async function findXlsxSearchResults(
  controller: XlsxViewerController,
  rawQuery: string,
) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];

  const results: XlsxSearchResult[] = [];

  for (const [sheetIndex, sheet] of controller.sheets.entries()) {
    const startRow = Math.max(0, sheet.minUsedRow);
    const endRow = Math.max(startRow, sheet.maxUsedRow);
    const visibleCols = sheet.visibleCols.filter(
      (col) => col >= sheet.minUsedCol && col <= sheet.maxUsedCol,
    );
    const visibleRowSet = new Set(sheet.visibleRows);
    const visibleColSet = new Set(visibleCols);

    if (!visibleCols.length || sheet.maxUsedRow < sheet.minUsedRow) continue;

    const worksheet = controller.workbook?.getSheet(sheet.workbookSheetIndex);
    const worksheetWithBatch = worksheet as
      | {
          getRowsBatch?: (
            startRow: number,
            rowCount: number,
            options?: Record<string, unknown>,
          ) => unknown;
        }
      | undefined;

    for (
      let batchStartRow = startRow;
      batchStartRow <= endRow;
      batchStartRow += XLSX_SEARCH_BATCH_ROW_COUNT
    ) {
      const rowCount = Math.min(
        XLSX_SEARCH_BATCH_ROW_COUNT,
        endRow - batchStartRow + 1,
      );
      const rows = controller.getRowsBatchAsync
        ? await controller.getRowsBatchAsync(
            sheet.workbookSheetIndex,
            batchStartRow,
            rowCount,
          )
        : worksheetWithBatch?.getRowsBatch?.(batchStartRow, rowCount, {
            includeFormulas: true,
            useFormattedValues: true,
          });

      if (rows) {
        for (const rowEntry of getBatchRows(rows)) {
          const row = Number(rowEntry.index);
          if (!Number.isInteger(row) || !visibleRowSet.has(row)) {
            continue;
          }

          for (const cellEntry of getBatchCells(rowEntry)) {
            const col = Number(cellEntry.col);
            if (!Number.isInteger(col) || !visibleColSet.has(col)) continue;

            const displayValue = normalizeSearchText(cellEntry.value);
            const formula = normalizeSearchText(cellEntry.formula);

            if (!cellMatchesQuery(displayValue, formula, query)) continue;

            results.push({
              cell: { row, col },
              displayValue,
              formula,
              sheetIndex,
              sheetName: sheet.name,
              workbookSheetIndex: sheet.workbookSheetIndex,
            });
          }
        }
        continue;
      }

      if (!worksheet) continue;

      const batchEndRow = batchStartRow + rowCount - 1;
      for (const row of sheet.visibleRows) {
        if (row < batchStartRow || row > batchEndRow) continue;

        for (const col of visibleCols) {
          const { displayValue, formula } = getCellSearchText(
            controller,
            sheet,
            row,
            col,
          );

          if (!cellMatchesQuery(displayValue, formula, query)) continue;

          results.push({
            cell: { row, col },
            displayValue,
            formula,
            sheetIndex,
            sheetName: sheet.name,
            workbookSheetIndex: sheet.workbookSheetIndex,
          });
        }
      }
    }
  }

  return results;
}

function sumAxisBefore(values: number[], endIndex: number, zoomFactor: number) {
  let total = 0;
  for (let index = 0; index < endIndex; index += 1) {
    total += (values[index] ?? 0) * zoomFactor;
  }
  return total;
}

function scrollXlsxCellIntoView({
  controller,
  result,
  viewport,
}: {
  controller: XlsxViewerController;
  result: XlsxSearchResult;
  viewport: HTMLDivElement | null;
}) {
  if (!viewport) return;

  const sheet = controller.sheets[result.sheetIndex];
  if (!sheet) return;

  const rowIndex = sheet.visibleRows.indexOf(result.cell.row);
  const colIndex = sheet.visibleCols.indexOf(result.cell.col);
  if (rowIndex < 0 || colIndex < 0) return;

  const zoomFactor = Math.max(0.1, controller.zoomScale / 100);
  const headerHeight = XLSX_GRID_HEADER_HEIGHT * zoomFactor;
  const rowHeaderWidth = XLSX_GRID_ROW_HEADER_WIDTH * zoomFactor;
  const rowStart =
    headerHeight + sumAxisBefore(sheet.rowHeights, rowIndex, zoomFactor);
  const colStart =
    rowHeaderWidth + sumAxisBefore(sheet.colWidths, colIndex, zoomFactor);
  const rowHeight =
    (sheet.rowHeights[rowIndex] ?? sheet.defaultRowHeightPx) * zoomFactor;
  const colWidth =
    (sheet.colWidths[colIndex] ?? sheet.defaultColWidthPx) * zoomFactor;
  const rowEnd = rowStart + rowHeight;
  const colEnd = colStart + colWidth;
  let nextTop = viewport.scrollTop;
  let nextLeft = viewport.scrollLeft;
  const visibleTop = viewport.scrollTop + headerHeight;
  const visibleLeft = viewport.scrollLeft + rowHeaderWidth;
  const visibleBottom = viewport.scrollTop + viewport.clientHeight;
  const visibleRight = viewport.scrollLeft + viewport.clientWidth;

  if (rowStart < visibleTop) {
    nextTop = rowStart - headerHeight;
  } else if (rowEnd > visibleBottom) {
    nextTop = rowEnd - viewport.clientHeight;
  }

  if (colStart < visibleLeft) {
    nextLeft = colStart - rowHeaderWidth;
  } else if (colEnd > visibleRight) {
    nextLeft = colEnd - viewport.clientWidth;
  }

  viewport.scrollTo({
    left: Math.max(0, nextLeft),
    top: Math.max(0, nextTop),
    behavior: "auto",
  });
}

function useDelayedLoadingIndicator(isLoading: boolean, delayMs: number) {
  const [showSpinner, setShowSpinner] = React.useState(false);

  React.useEffect(() => {
    if (!isLoading) {
      setShowSpinner(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShowSpinner(true);
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [delayMs, isLoading]);

  return showSpinner;
}

function ToolbarTooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <AppTooltip tooltip={label} placement="bottom">
      <span className="inline-flex">{children}</span>
    </AppTooltip>
  );
}

function ViewerLoadingSurface({
  showSpinner = true,
}: {
  showSpinner?: boolean;
}) {
  return (
    <div className="grid h-full min-h-52 w-full min-w-full place-items-center bg-transparent">
      {showSpinner ? <Spinner className="size-4" /> : null}
    </div>
  );
}

function WorkbookFileActionsMenu({
  isDark,
  onDownload,
  onIsDarkChange,
  onUploadClick,
  showDownloadButton,
  showNightRenderToggle = false,
  showUploadButton,
}: {
  isDark?: boolean;
  onDownload?: () => void;
  onIsDarkChange?: (checked: boolean) => void;
  onUploadClick: () => void;
  showDownloadButton: boolean;
  showNightRenderToggle?: boolean;
  showUploadButton: boolean;
}) {
  const showThemeControl = showNightRenderToggle && Boolean(onIsDarkChange);
  const showFileActions =
    (showDownloadButton && onDownload) || showUploadButton;
  if (!showThemeControl && !showFileActions) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={VIEWER_COPY.openWorkbookActions}
        >
          <More2Line className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={cn("w-52", XLSX_DROPDOWN_Z_INDEX_CLASS)}
      >
        {showThemeControl ? (
          <>
            <DropdownMenuCheckboxItem
              checked={Boolean(isDark)}
              onCheckedChange={(checked) => onIsDarkChange?.(checked === true)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <MoonLine className="size-4" />
                {VIEWER_COPY.darkMode}
              </span>
            </DropdownMenuCheckboxItem>
            {showFileActions ? <DropdownMenuSeparator /> : null}
          </>
        ) : null}
        {showDownloadButton && onDownload ? (
          <DropdownMenuItem onClick={onDownload}>
            <DownloadLine className="size-4" />
            {VIEWER_COPY.download}
          </DropdownMenuItem>
        ) : null}
        {showUploadButton ? (
          <DropdownMenuItem onClick={onUploadClick}>
            <UploadLine className="size-4" />
            {VIEWER_COPY.upload}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function renderXlsxScroller({
  children,
  viewportProps,
}: XlsxScrollerRenderProps) {
  return (
    <AppScrollArea
      className="h-full min-h-0 w-full min-w-0 flex-1"
      contentWrapper={false}
      viewportProps={viewportProps}
    >
      {children}
    </AppScrollArea>
  );
}

export function WorkbookTableHeaderMenu({
  direction,
  sortAscending,
  sortDescending,
  triggerIcon,
  triggerProps,
}: XlsxTableHeaderMenuRenderProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          {...triggerProps}
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn("size-6 rounded-sm", triggerProps.className)}
          aria-label="列菜单"
        >
          {triggerIcon ? triggerIcon : <More2Line className="size-3.5" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={cn("w-40", XLSX_DROPDOWN_Z_INDEX_CLASS)}
      >
        <DropdownMenuRadioGroup
          value={direction ?? ""}
          onValueChange={(value) => {
            if (value === "ascending") {
              sortAscending();
            } else {
              sortDescending();
            }
            setOpen(false);
          }}
        >
          <DropdownMenuRadioItem value="ascending">
            {VIEWER_COPY.sortAscending}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="descending">
            {VIEWER_COPY.sortDescending}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkbookSearchPopover({
  viewportRef,
  workbookIdentity,
}: {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  workbookIdentity: string;
}) {
  const controller = useXlsxViewer();
  const [searchDraft, setSearchDraft] = React.useState("");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<XlsxSearchResult[]>(
    [],
  );
  const [activeResultIndex, setActiveResultIndex] = React.useState(0);
  const [isSearching, setIsSearching] = React.useState(false);
  const controllerRef = React.useRef(controller);
  const searchRequestIdRef = React.useRef(0);
  const appliedResultKeyRef = React.useRef("");
  const activeResult = searchResults[activeResultIndex] ?? null;
  const activeResultKey = activeResult
    ? `${activeResult.workbookSheetIndex}:${activeResult.cell.row}:${activeResult.cell.col}`
    : "";
  const controlsDisabled =
    controller.isLoading ||
    Boolean(controller.error) ||
    !controller.sheets.length;
  const hasActiveQuery = Boolean(searchQuery.trim());
  const resultLabel = isSearching
    ? VIEWER_COPY.searching
    : !hasActiveQuery
      ? VIEWER_COPY.noSearch
      : searchResults.length
        ? `${activeResultIndex + 1} / ${searchResults.length}`
        : VIEWER_COPY.noResults;

  React.useEffect(() => {
    controllerRef.current = controller;
  }, [controller]);

  const runSearch = React.useCallback((rawQuery: string) => {
    const nextQuery = rawQuery.trim();
    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    appliedResultKeyRef.current = "";
    setSearchQuery(nextQuery);
    setActiveResultIndex(0);

    if (!nextQuery) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    void findXlsxSearchResults(controllerRef.current, nextQuery)
      .then((nextResults) => {
        if (searchRequestIdRef.current !== requestId) return;
        setSearchResults(nextResults);
      })
      .catch(() => {
        if (searchRequestIdRef.current !== requestId) return;
        setSearchResults([]);
      })
      .finally(() => {
        if (searchRequestIdRef.current !== requestId) return;
        setIsSearching(false);
      });
  }, []);

  React.useEffect(() => {
    const trimmedDraft = searchDraft.trim();

    if (!trimmedDraft) {
      runSearch("");
      return;
    }

    setIsSearching(true);
    const timeoutId = window.setTimeout(() => {
      runSearch(searchDraft);
    }, XLSX_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [runSearch, searchDraft]);

  const clearSearch = React.useCallback(() => {
    searchRequestIdRef.current += 1;
    setSearchDraft("");
    setSearchQuery("");
    setSearchResults([]);
    setActiveResultIndex(0);
    setIsSearching(false);
    appliedResultKeyRef.current = "";
    controller.clearSelection();
  }, [controller]);

  const goToRelativeResult = React.useCallback(
    (direction: 1 | -1) => {
      if (!searchResults.length) return;

      setActiveResultIndex((currentIndex) => {
        return (
          (currentIndex + direction + searchResults.length) %
          searchResults.length
        );
      });
    },
    [searchResults.length],
  );

  React.useEffect(() => {
    searchRequestIdRef.current += 1;
    setSearchDraft("");
    setSearchQuery("");
    setSearchResults([]);
    setActiveResultIndex(0);
    setIsSearching(false);
    appliedResultKeyRef.current = "";
  }, [workbookIdentity]);

  React.useEffect(() => {
    if (!activeResult) return;

    if (controller.activeSheetIndex !== activeResult.sheetIndex) {
      appliedResultKeyRef.current = "";
      controller.setActiveSheetIndex(activeResult.sheetIndex);
      return;
    }

    if (appliedResultKeyRef.current === activeResultKey) return;
    appliedResultKeyRef.current = activeResultKey;
    controller.selectCell(activeResult.cell);

    const frame = window.requestAnimationFrame(() => {
      scrollXlsxCellIntoView({
        controller,
        result: activeResult,
        viewport: viewportRef.current,
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    activeResult,
    activeResultKey,
    controller,
    controller.activeSheetIndex,
    viewportRef,
  ]);

  return (
    <Popover>
      <ToolbarTooltip label={VIEWER_COPY.searchWorkbook}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={VIEWER_COPY.searchWorkbook}
            disabled={controlsDisabled}
          >
            <SearchLine aria-hidden="true" className="size-4" />
          </Button>
        </PopoverTrigger>
      </ToolbarTooltip>
      <PopoverContent align="end" className="viewer-search-popover">
        <ViewerSearchPanel
          canClear={Boolean(searchDraft.trim() || searchQuery.trim())}
          clearLabel={VIEWER_COPY.clear}
          detailLabel={
            activeResult
              ? `${activeResult.sheetName}!${cellAddressToA1(activeResult.cell)}`
              : null
          }
          hasResults={searchResults.length > 0}
          inputLabel={VIEWER_COPY.searchWorkbook}
          isSearching={isSearching}
          nextResultLabel={VIEWER_COPY.nextResult}
          onClear={clearSearch}
          onInputKeyDown={(event) => {
            if (event.key !== "Enter") return;

            event.preventDefault();
            if (event.shiftKey && searchResults.length) {
              goToRelativeResult(-1);
            } else if (searchResults.length) {
              goToRelativeResult(1);
            } else if (searchDraft.trim()) {
              runSearch(searchDraft);
            }
          }}
          onNextResult={() => goToRelativeResult(1)}
          onPreviousResult={() => goToRelativeResult(-1)}
          onValueChange={setSearchDraft}
          placeholder={VIEWER_COPY.searchWorkbook}
          previousResultLabel={VIEWER_COPY.previousResult}
          resultLabel={
            searchResults.length ? (
              <>
                <span className="viewer-search-result-current">
                  {activeResultIndex + 1}
                </span>
                {` / ${searchResults.length}`}
              </>
            ) : (
              resultLabel
            )
          }
          value={searchDraft}
        />
      </PopoverContent>
    </Popover>
  );
}

function WorkbookToolbar({
  isDark,
  leadingToolbarActions,
  onDownload,
  onIsDarkChange,
  onUploadClick,
  showDownloadButton = true,
  showNightRenderToggle,
  showUploadButton = true,
  toolbarActions,
  viewportRef,
  workbookIdentity,
}: {
  isDark: boolean;
  leadingToolbarActions?: React.ReactNode;
  onDownload?: () => void;
  onIsDarkChange: (checked: boolean) => void;
  onUploadClick: () => void;
  showDownloadButton?: boolean;
  showNightRenderToggle: boolean;
  showUploadButton?: boolean;
  toolbarActions?: React.ReactNode;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  workbookIdentity: string;
}) {
  const { setZoomScale, zoomScale } = useXlsxViewerZoom();
  const currentZoom = Math.round(zoomScale);

  React.useEffect(() => {
    setZoomScale(100);
  }, [setZoomScale, workbookIdentity]);

  return (
    <div className="viewer-toolbar justify-between">
      {leadingToolbarActions ? (
        <div className="flex min-w-0 items-center gap-1">
          {leadingToolbarActions}
        </div>
      ) : null}
      <div className="ml-auto flex min-w-0 items-center justify-end gap-1">
        <ViewerZoomControls
          ariaLabel={VIEWER_COPY.zoomLevel}
          onValueChange={setZoomScale}
          options={ZOOM_OPTIONS}
          value={currentZoom}
          zoomInLabel={VIEWER_COPY.zoomIn}
          zoomOutLabel={VIEWER_COPY.zoomOut}
        />
        <Separator className="mx-1" />
        <WorkbookSearchPopover
          viewportRef={viewportRef}
          workbookIdentity={workbookIdentity}
        />
        {toolbarActions ? (
          <>
            <Separator className="mx-1" />
            {toolbarActions}
          </>
        ) : null}
        {(showDownloadButton && onDownload) ||
        showUploadButton ||
        showNightRenderToggle ? (
          <>
            <Separator className="mx-1" />
            <WorkbookFileActionsMenu
              isDark={isDark}
              onDownload={onDownload}
              onIsDarkChange={onIsDarkChange}
              onUploadClick={onUploadClick}
              showDownloadButton={showDownloadButton}
              showNightRenderToggle={showNightRenderToggle}
              showUploadButton={showUploadButton}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function WorkbookStandaloneToolbar({
  onUploadClick,
  showUploadButton = true,
  toolbarActions,
}: {
  onUploadClick: () => void;
  showUploadButton?: boolean;
  toolbarActions?: React.ReactNode;
}) {
  return (
    <div className="viewer-toolbar justify-end">
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
        {toolbarActions ? <>{toolbarActions}</> : null}
        {showUploadButton ? (
          <>
            {toolbarActions ? <Separator className="mx-1" /> : null}
            <WorkbookFileActionsMenu
              onUploadClick={onUploadClick}
              showDownloadButton={false}
              showUploadButton={showUploadButton}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

type WorkbookSheetTab = {
  name: string;
  workbookSheetIndex: number;
};

type WorkbookSheetTabsInnerProps = {
  activeSheetIndex: number;
  onActiveSheetIndexChange: (index: number) => void;
  sheets: WorkbookSheetTab[];
  workbookIdentity: string;
};

export function WorkbookSheetTabs({
  workbookIdentity,
}: {
  workbookIdentity: string;
}) {
  const { activeSheetIndex, setActiveSheetIndex, sheets } = useXlsxViewer();

  const handleActiveSheetIndexChange = React.useCallback(
    (index: number) => setActiveSheetIndex(index),
    [setActiveSheetIndex],
  );

  return (
    <WorkbookSheetTabsInner
      activeSheetIndex={activeSheetIndex}
      onActiveSheetIndexChange={handleActiveSheetIndexChange}
      sheets={sheets}
      workbookIdentity={workbookIdentity}
    />
  );
}

const WorkbookSheetTabsInner = React.memo(function WorkbookSheetTabsInner({
  activeSheetIndex,
  onActiveSheetIndexChange,
  sheets,
  workbookIdentity,
}: WorkbookSheetTabsInnerProps) {
  const [visiblePreviewIndex, setVisiblePreviewIndex] = React.useState<
    number | null
  >(null);
  const [previewPosition, setPreviewPosition] = React.useState({
    left: 0,
    top: 0,
  });
  const { thumbnails } = useXlsxViewerThumbnails(
    XLSX_SHEET_TAB_THUMBNAIL_OPTIONS,
  );
  const [thumbnailUrls, setThumbnailUrls] = React.useState<
    Record<number, string>
  >({});
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const itemRefs = React.useRef<Record<number, HTMLElement | null>>({});
  const openTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const closeTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const previewWidth = 220;
  const previewHeight = (previewWidth * 7) / 11;
  const previewGap = 12;
  const previewOpenDelayMs = 500;

  const clearOpenTimeout = React.useCallback(() => {
    if (openTimeoutRef.current) {
      clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
  }, []);

  const clearCloseTimeout = React.useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const getPreviewPosition = React.useCallback(
    (sheetIndex: number) => {
      const item = itemRefs.current[sheetIndex];
      if (!item || typeof window === "undefined") {
        return { left: 0, top: 0 };
      }

      const itemRect = item.getBoundingClientRect();
      const centeredLeft =
        itemRect.left + itemRect.width / 2 - previewWidth / 2;
      const minLeft = 8;
      const maxLeft = Math.max(minLeft, window.innerWidth - previewWidth - 8);
      const left = Math.max(minLeft, Math.min(centeredLeft, maxLeft));
      const top = Math.max(8, itemRect.top - previewHeight - previewGap);

      return { left, top };
    },
    [previewHeight],
  );

  const updatePreviewPosition = React.useCallback(
    (sheetIndex: number) => {
      setPreviewPosition(getPreviewPosition(sheetIndex));
    },
    [getPreviewPosition],
  );

  const handleItemEnter = React.useCallback(
    (sheetIndex: number) => {
      clearCloseTimeout();
      const nextPreviewPosition = getPreviewPosition(sheetIndex);

      if (visiblePreviewIndex !== null) {
        clearOpenTimeout();
        setPreviewPosition(nextPreviewPosition);
        setVisiblePreviewIndex(sheetIndex);
        return;
      }

      clearOpenTimeout();
      openTimeoutRef.current = setTimeout(() => {
        setPreviewPosition(nextPreviewPosition);
        setVisiblePreviewIndex(sheetIndex);
      }, previewOpenDelayMs);
    },
    [
      clearCloseTimeout,
      clearOpenTimeout,
      getPreviewPosition,
      visiblePreviewIndex,
    ],
  );

  const handleContainerLeave = React.useCallback(() => {
    clearOpenTimeout();
    clearCloseTimeout();
    closeTimeoutRef.current = setTimeout(() => {
      setVisiblePreviewIndex(null);
    }, 80);
  }, [clearCloseTimeout, clearOpenTimeout]);

  React.useEffect(() => {
    return () => {
      clearOpenTimeout();
      clearCloseTimeout();
    };
  }, [clearCloseTimeout, clearOpenTimeout]);

  React.useEffect(() => {
    clearOpenTimeout();
    clearCloseTimeout();
    setVisiblePreviewIndex(null);
    setPreviewPosition({ left: 0, top: 0 });
    setThumbnailUrls({});
  }, [clearCloseTimeout, clearOpenTimeout, workbookIdentity]);

  React.useEffect(() => {
    thumbnails.forEach((thumbnail) => {
      setThumbnailUrls((current) => {
        if (current[thumbnail.sheetIndex]) return current;

        const canvas = document.createElement("canvas");
        canvas.width = thumbnail.width;
        canvas.height = thumbnail.height;

        if (!thumbnail.paint(canvas)) return current;

        return {
          ...current,
          [thumbnail.sheetIndex]: canvas.toDataURL("image/png"),
        };
      });
    });
  }, [thumbnails]);

  React.useEffect(() => {
    if (visiblePreviewIndex === null) return;

    const handleReposition = () => updatePreviewPosition(visiblePreviewIndex);
    handleReposition();

    const scrollElement = scrollRef.current;
    window.addEventListener("resize", handleReposition);
    scrollElement?.addEventListener("scroll", handleReposition, {
      passive: true,
    });

    return () => {
      window.removeEventListener("resize", handleReposition);
      scrollElement?.removeEventListener("scroll", handleReposition);
    };
  }, [updatePreviewPosition, visiblePreviewIndex]);

  // The preview card portals to document.body, so it outlives the tab
  // strip's own visibility: when the viewer is hidden or reparented under
  // the cursor (keep-alive preview pools, a closing dialog) no mouseleave
  // fires and the card would hang on screen. While the preview is open,
  // poll the strip's effective visibility and dismiss as soon as it stops
  // being shown.
  React.useEffect(() => {
    if (visiblePreviewIndex === null) return;

    const dismissWhenHidden = () => {
      const element = scrollRef.current;
      const isVisible = Boolean(
        element?.isConnected &&
        (element.checkVisibility?.({ checkVisibilityCSS: true }) ?? true),
      );

      if (isVisible) return;
      clearOpenTimeout();
      clearCloseTimeout();
      setVisiblePreviewIndex(null);
    };
    const interval = setInterval(dismissWhenHidden, 200);

    return () => clearInterval(interval);
  }, [clearCloseTimeout, clearOpenTimeout, visiblePreviewIndex]);

  if (sheets.length <= 1) return null;

  const previewSheet =
    visiblePreviewIndex === null ? null : sheets[visiblePreviewIndex];
  const previewUrl =
    visiblePreviewIndex === null
      ? null
      : (thumbnailUrls[visiblePreviewIndex] ?? null);

  return (
    <div
      className="border-t bg-[color-mix(in_oklab,var(--background-secondary)_40%,transparent)] px-3 py-2"
      onMouseLeave={handleContainerLeave}
    >
      <BaseTabs.Root
        value={String(activeSheetIndex)}
        onValueChange={(value) => onActiveSheetIndexChange(Number(value))}
        className="flex flex-col gap-0"
      >
        <AppScrollArea
          withHorizontalScrollbar
          className="h-10 w-full has-[[data-slot=scroll-area-viewport][data-has-overflow-x]]:h-[50px]"
          viewportClassName="overflow-y-hidden"
          viewportRef={scrollRef}
        >
          <div className="flex h-full items-center">
            <BaseTabs.List className="relative z-0 flex w-fit shrink-0 items-center justify-center gap-x-0.5 rounded-lg bg-[var(--background-secondary)] p-0.5 text-sm text-[var(--foreground-secondary)]">
              {sheets.map((sheet, index) => (
                <BaseTabs.Tab
                  key={`${sheet.workbookSheetIndex}-${sheet.name}`}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  value={String(index)}
                  className="relative flex h-8 max-w-48 flex-none cursor-pointer items-center justify-center rounded-md border border-transparent px-2.5 font-medium whitespace-nowrap outline-none hover:text-[var(--foreground-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] data-active:text-[var(--foreground-primary)]"
                  onMouseEnter={() => handleItemEnter(index)}
                >
                  <span className="truncate">{sheet.name}</span>
                </BaseTabs.Tab>
              ))}
              <BaseTabs.Indicator className="absolute bottom-0 left-0 -z-1 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) -translate-y-(--active-tab-bottom) rounded-md bg-[var(--background-primary)] shadow-sm/5 transition-[width,translate] duration-200 ease-in-out" />
            </BaseTabs.List>
          </div>
        </AppScrollArea>
      </BaseTabs.Root>
      {typeof document !== "undefined" &&
      previewSheet &&
      visiblePreviewIndex !== null &&
      previewUrl
        ? createPortal(
            <div
              className="pointer-events-none fixed z-40 translate-y-0 overflow-hidden rounded-lg border bg-[color-mix(in_oklab,var(--background-primary)_95%,transparent)] opacity-100 shadow-xl backdrop-blur-md transition-[opacity,transform] duration-100"
              style={{
                left: previewPosition.left,
                top: previewPosition.top,
                width: previewWidth,
              }}
            >
              <div className="relative aspect-[11/7] w-full overflow-hidden bg-[color-mix(in_oklab,var(--background-secondary)_60%,transparent)]">
                {/* eslint-disable-next-line @next/next/no-img-element -- Workbook sheet previews are generated runtime image URLs. */}
                <img
                  key={`${workbookIdentity}-${visiblePreviewIndex}-${previewUrl}`}
                  src={previewUrl}
                  alt={`${previewSheet.name} 预览`}
                  className="absolute inset-0 h-full w-full object-cover object-left-top"
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});

export function XlsxWorkbookSurface({
  className,
  isDark,
  leadingToolbarActions,
  onDownload,
  onIsDarkChange,
  onUploadClick,
  renderTableHeaderMenu,
  showDownloadButton = true,
  showNightRenderToggle,
  showToolbar = true,
  showUploadButton = true,
  toolbarActions,
  workbookIdentity,
}: {
  className?: string;
  isDark: boolean;
  leadingToolbarActions?: React.ReactNode;
  onDownload?: () => void;
  onIsDarkChange: (checked: boolean) => void;
  onUploadClick: () => void;
  renderTableHeaderMenu: (
    props: XlsxTableHeaderMenuRenderProps,
  ) => React.ReactNode;
  showDownloadButton?: boolean;
  showNightRenderToggle: boolean;
  showToolbar?: boolean;
  showUploadButton?: boolean;
  toolbarActions?: React.ReactNode;
  workbookIdentity: string;
}) {
  const { error } = useXlsxViewer();
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const renderSearchableScroller = React.useCallback(
    ({ children, viewportProps }: XlsxScrollerRenderProps) => (
      <AppScrollArea
        className="h-full min-h-0 w-full min-w-0 flex-1"
        contentWrapper={false}
        viewportProps={viewportProps}
        viewportRef={viewportRef}
      >
        {children}
      </AppScrollArea>
    ),
    [],
  );

  return (
    <div
      className={cn(
        "flex h-[640px] min-h-0 flex-col overflow-hidden bg-[var(--background-primary)]",
        className,
      )}
    >
      {showToolbar ? (
        <WorkbookToolbar
          isDark={isDark}
          leadingToolbarActions={leadingToolbarActions}
          onDownload={onDownload}
          onIsDarkChange={onIsDarkChange}
          onUploadClick={onUploadClick}
          showDownloadButton={showDownloadButton}
          showNightRenderToggle={showNightRenderToggle}
          showUploadButton={showUploadButton}
          toolbarActions={toolbarActions}
          viewportRef={viewportRef}
          workbookIdentity={workbookIdentity}
        />
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 bg-[color-mix(in_oklab,var(--background-secondary)_20%,transparent)]">
          <XlsxViewer
            experimentalCanvas
            allowResizeInReadOnly
            className="h-full min-h-0 min-w-0"
            height="100%"
            isDark={isDark}
            readOnly
            rounded={false}
            showDefaultToolbar={false}
            showImages
            fileTooLargeState={
              <div className="grid h-full w-full min-w-full place-items-center p-6">
                <div className="max-w-sm rounded-lg border bg-[var(--background-primary)] p-4 text-sm">
                  <p className="font-medium">{VIEWER_COPY.fileTooLarge}</p>
                  <p className="mt-1 text-[var(--foreground-secondary)]">
                    {VIEWER_COPY.workbookTooLargeHelp}
                  </p>
                </div>
              </div>
            }
            loadingState={<ViewerLoadingSurface />}
            renderScroller={renderSearchableScroller}
            errorState={
              <div className="grid h-full w-full min-w-full place-items-center p-6 text-sm text-[var(--danger)]">
                {VIEWER_COPY.unableToDisplayWorkbook}
              </div>
            }
            renderTableHeaderMenu={renderTableHeaderMenu}
          />
        </div>
        <WorkbookSheetTabs workbookIdentity={workbookIdentity} />
      </div>
    </div>
  );
}

export function XlsxViewerPreview({
  className,
  fileName,
  isDark,
  leadingToolbarActions,
  onIsDarkChange,
  showDownload = true,
  showNightModeToggle = true,
  showToolbar = true,
  showUpload = true,
  src,
  toolbarActions,
}: {
  className?: string;
  fileName?: string;
  isDark: boolean;
  leadingToolbarActions?: React.ReactNode;
  onIsDarkChange: (isDark: boolean) => void;
  showDownload?: boolean;
  showNightModeToggle?: boolean;
  showToolbar?: boolean;
  showUpload?: boolean;
  src?: string;
  toolbarActions?: React.ReactNode;
}) {
  return (
    <XlsxViewerContent
      className={className}
      effectiveIsDark={isDark}
      fileName={fileName}
      leadingToolbarActions={leadingToolbarActions}
      setNightRenderEnabled={onIsDarkChange}
      shouldRenderNightMode={showNightModeToggle}
      showDownload={showDownload}
      showToolbar={showToolbar}
      showUpload={showUpload}
      toolbarActions={toolbarActions}
      url={src}
    />
  );
}

function XlsxViewerContent({
  className,
  effectiveIsDark,
  fileName,
  leadingToolbarActions,
  setNightRenderEnabled,
  shouldRenderNightMode,
  showDownload,
  showToolbar = true,
  showUpload,
  toolbarActions,
  url,
}: {
  className?: string;
  effectiveIsDark: boolean;
  fileName?: string;
  leadingToolbarActions?: React.ReactNode;
  setNightRenderEnabled: (checked: boolean) => void;
  shouldRenderNightMode: boolean;
  showDownload: boolean;
  showToolbar?: boolean;
  showUpload: boolean;
  toolbarActions?: React.ReactNode;
  url?: string;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploadedWorkbook, setUploadedWorkbook] =
    React.useState<UploadedWorkbook | null>(null);
  const sourceFileName = React.useMemo(
    () =>
      url ? formatWorkbookName(fileName, url) : (fileName ?? "workbook.xlsx"),
    [fileName, url],
  );
  const displayFileName = React.useMemo(
    () => uploadedWorkbook?.fileName ?? sourceFileName,
    [sourceFileName, uploadedWorkbook?.fileName],
  );
  const workbookIdentity = React.useMemo(
    () => uploadedWorkbook?.identity ?? `${url ?? "empty"}::${displayFileName}`,
    [displayFileName, uploadedWorkbook?.identity, url],
  );
  const [workbookBuffer, setWorkbookBuffer] =
    React.useState<ArrayBuffer | null>(null);
  const [loadError, setLoadError] = React.useState<string>();
  const shouldShowLoadingSpinner = useDelayedLoadingIndicator(
    !workbookBuffer && !loadError && !uploadedWorkbook,
    XLSX_LOADING_INDICATOR_DELAY_MS,
  );

  React.useEffect(() => {
    let isCurrent = true;
    if (url) {
      setUploadedWorkbook(null);
    }

    async function loadWorkbook(): Promise<void> {
      if (!url) {
        setWorkbookBuffer(null);
        setLoadError(undefined);
        return;
      }

      setWorkbookBuffer(null);
      setLoadError(undefined);

      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(
            `${VIEWER_COPY.workbookLoadFailed} (${response.status})`,
          );
        }

        const nextWorkbookBuffer = await response.arrayBuffer();
        if (!isCurrent) return;

        setWorkbookBuffer(nextWorkbookBuffer);
      } catch (error) {
        if (!isCurrent) return;

        setLoadError(
          error instanceof Error &&
            error.message.includes(VIEWER_COPY.workbookLoadFailed)
            ? error.message
            : VIEWER_COPY.workbookLoadFailed,
        );
      }
    }

    void loadWorkbook();

    return () => {
      isCurrent = false;
    };
  }, [url]);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    const buffer = await file.arrayBuffer();
    setLoadError(undefined);
    setUploadedWorkbook({
      buffer,
      fileName: file.name,
      identity: `${file.name}-${file.size}-${file.lastModified}`,
    });
  }

  const activeBuffer = uploadedWorkbook?.buffer ?? workbookBuffer;
  const activeFileName = uploadedWorkbook?.fileName ?? displayFileName;
  const activeIdentity = workbookIdentity;

  if (!url && !uploadedWorkbook) {
    return (
      <div
        data-slot="xlsx-editor-preview"
        className={cn(
          "flex h-[640px] min-h-0 flex-col overflow-hidden bg-[var(--background-primary)]",
          className,
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={handleUpload}
        />
        <WorkbookStandaloneToolbar
          onUploadClick={() => fileInputRef.current?.click()}
          showUploadButton={showUpload}
          toolbarActions={toolbarActions}
        />
        <div className="grid min-h-0 flex-1 place-items-center bg-[color-mix(in_oklab,var(--background-secondary)_30%,transparent)] p-4">
          <div className="max-w-md rounded-lg border bg-[var(--background-primary)] p-4 text-center text-sm shadow-xs">
            <p className="font-medium">{VIEWER_COPY.uploadWorkbookToPreview}</p>
            <p className="mt-1 text-[var(--foreground-secondary)]">
              {VIEWER_COPY.uploadWorkbookHelp}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadLine className="size-4" />
              {VIEWER_COPY.uploadXlsx}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (loadError && !activeBuffer) {
    return (
      <div
        data-slot="xlsx-editor-preview"
        className={cn(
          "flex h-[640px] min-h-0 flex-col overflow-hidden bg-[var(--background-primary)]",
          className,
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={handleUpload}
        />
        <WorkbookStandaloneToolbar
          onUploadClick={() => fileInputRef.current?.click()}
          showUploadButton={showUpload}
          toolbarActions={toolbarActions}
        />
        <div className="grid min-h-0 flex-1 place-items-center bg-[color-mix(in_oklab,var(--background-secondary)_30%,transparent)] p-4">
          <div className="max-w-md rounded-lg border bg-[var(--background-primary)] p-4 text-sm">
            <p className="font-medium">{VIEWER_COPY.unableToDisplayWorkbook}</p>
            <p className="mt-1 text-[var(--foreground-secondary)]">
              {loadError}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadLine className="size-4" />
              {VIEWER_COPY.uploadXlsx}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!activeBuffer) {
    return (
      <div
        data-slot="xlsx-editor-preview"
        className={cn(
          "flex h-[640px] min-h-0 flex-col overflow-hidden bg-[var(--background-primary)]",
          className,
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={handleUpload}
        />
        <WorkbookStandaloneToolbar
          onUploadClick={() => fileInputRef.current?.click()}
          showUploadButton={showUpload}
          toolbarActions={toolbarActions}
        />
        <ViewerLoadingSurface showSpinner={shouldShowLoadingSpinner} />
      </div>
    );
  }

  return (
    <div
      data-slot="xlsx-editor-preview"
      className={cn("overflow-hidden", className)}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="hidden"
        onChange={handleUpload}
      />
      <XlsxWorkbookLoadedViewer
        className={className}
        fileName={activeFileName}
        isDark={effectiveIsDark}
        leadingToolbarActions={leadingToolbarActions}
        onDownload={() => downloadWorkbookBuffer(activeBuffer, activeFileName)}
        onIsDarkChange={setNightRenderEnabled}
        onUploadClick={() => fileInputRef.current?.click()}
        renderTableHeaderMenu={(props) => (
          <WorkbookTableHeaderMenu {...props} />
        )}
        showDownloadButton={showDownload}
        showNightRenderToggle={shouldRenderNightMode}
        showToolbar={showToolbar}
        showUploadButton={showUpload}
        toolbarActions={toolbarActions}
        workbookBuffer={activeBuffer}
        workbookIdentity={activeIdentity}
      />
    </div>
  );
}

function XlsxWorkbookLoadedViewer({
  className,
  fileName,
  isDark,
  leadingToolbarActions,
  onDownload,
  onIsDarkChange,
  onUploadClick,
  renderTableHeaderMenu,
  showDownloadButton,
  showNightRenderToggle,
  showToolbar = true,
  showUploadButton,
  toolbarActions,
  workbookBuffer,
  workbookIdentity,
}: {
  className?: string;
  fileName: string;
  isDark: boolean;
  leadingToolbarActions?: React.ReactNode;
  onDownload: () => void;
  onIsDarkChange: (checked: boolean) => void;
  onUploadClick: () => void;
  renderTableHeaderMenu: (
    props: XlsxTableHeaderMenuRenderProps,
  ) => React.ReactNode;
  showDownloadButton: boolean;
  showNightRenderToggle: boolean;
  showToolbar?: boolean;
  showUploadButton: boolean;
  toolbarActions?: React.ReactNode;
  workbookBuffer: ArrayBuffer;
  workbookIdentity: string;
}) {
  const controller = useXlsxViewerController(
    React.useMemo(
      () => ({
        allowResizeInReadOnly: true,
        file: workbookBuffer,
        fileName,
        maxFileSizeBytes: XLSX_MAX_FILE_SIZE_BYTES,
        readOnly: true,
        useWorker: true,
      }),
      [fileName, workbookBuffer],
    ),
  );

  return (
    <XlsxViewerProvider controller={controller} isDark={isDark}>
      <XlsxWorkbookSurface
        className={className}
        isDark={isDark}
        leadingToolbarActions={leadingToolbarActions}
        onDownload={onDownload}
        onIsDarkChange={onIsDarkChange}
        onUploadClick={onUploadClick}
        renderTableHeaderMenu={renderTableHeaderMenu}
        showDownloadButton={showDownloadButton}
        showNightRenderToggle={showNightRenderToggle}
        showToolbar={showToolbar}
        showUploadButton={showUploadButton}
        toolbarActions={toolbarActions}
        workbookIdentity={workbookIdentity}
      />
    </XlsxViewerProvider>
  );
}

function resolveXlsxSheet(
  workbook: import("xlsx").WorkBook,
  requestedSheetIndex = 0,
) {
  const sheetCount = Math.max(workbook.SheetNames.length, 1);
  const sheetIndex = Math.max(
    0,
    Math.min(Math.trunc(requestedSheetIndex), sheetCount - 1),
  );
  const sheetName = workbook.SheetNames[sheetIndex];

  return {
    sheet: sheetName ? workbook.Sheets[sheetName] : undefined,
    sheetCount,
    sheetIndex,
    sheetName,
  };
}

export async function renderXlsxSheetToDataUrlWithSheetCount(
  url: string,
  {
    maxHeight = 260,
    maxWidth = 360,
    pixelRatio = 1,
    sheetIndex = 0,
  }: {
    cacheKey?: string;
    maxHeight?: number;
    maxWidth?: number;
    pixelRatio?: number;
    sheetIndex?: number;
  } = {},
) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${VIEWER_COPY.workbookLoadFailed} (${response.status})`);
  }

  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await response.arrayBuffer(), { type: "array" });
  const { sheet: worksheet, sheetCount } = resolveXlsxSheet(
    workbook,
    sheetIndex,
  );
  const range = worksheet?.["!ref"]
    ? XLSX.utils.decode_range(worksheet["!ref"])
    : null;
  const canvas = document.createElement("canvas");
  const ratio = Math.max(1, pixelRatio);
  const width = Math.max(1, Math.round(maxWidth * ratio));
  const height = Math.max(1, Math.round(maxHeight * ratio));
  const ctx = canvas.getContext("2d");

  canvas.width = width;
  canvas.height = height;

  if (!ctx) {
    return {
      pageCount: sheetCount,
      previewAspectRatio: maxWidth / maxHeight,
      url: null,
    };
  }

  const styles = getComputedStyle(document.documentElement);
  const background = styles.getPropertyValue("--background-primary").trim();
  const headerBackground = styles
    .getPropertyValue("--background-secondary")
    .trim();
  const border = styles.getPropertyValue("--border-primary").trim();
  const foreground = styles.getPropertyValue("--foreground-primary").trim();
  const secondary = styles.getPropertyValue("--foreground-secondary").trim();
  const rowHeaderWidth = 34;
  const headerHeight = 28;
  const rowHeight = 26;
  const visibleColumnCount = range ? Math.min(5, range.e.c - range.s.c + 1) : 0;
  const visibleRowCount = range ? Math.min(7, range.e.r - range.s.r + 1) : 0;
  const columnWidth =
    (maxWidth - rowHeaderWidth) / Math.max(visibleColumnCount, 1);

  ctx.scale(ratio, ratio);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, maxWidth, maxHeight);
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, maxWidth, maxHeight);
  ctx.fillStyle = headerBackground;
  ctx.fillRect(0, 0, maxWidth, headerHeight);
  ctx.fillRect(0, 0, rowHeaderWidth, maxHeight);

  ctx.font = "600 12px system-ui, sans-serif";
  ctx.fillStyle = foreground;
  for (let colOffset = 0; colOffset < visibleColumnCount; colOffset += 1) {
    const col = (range?.s.c ?? 0) + colOffset;
    const x = rowHeaderWidth + colOffset * columnWidth;
    ctx.fillText(XLSX.utils.encode_col(col), x + 8, 19, columnWidth - 16);
    ctx.strokeStyle = border;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, maxHeight);
    ctx.stroke();
  }

  ctx.font = "12px system-ui, sans-serif";
  for (let rowOffset = 0; rowOffset < visibleRowCount; rowOffset += 1) {
    const row = (range?.s.r ?? 0) + rowOffset;
    const y = headerHeight + rowOffset * rowHeight;
    ctx.fillStyle = foreground;
    ctx.fillText(String(row + 1), 8, y + 17, rowHeaderWidth - 14);
    ctx.strokeStyle = border;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(maxWidth, y);
    ctx.stroke();

    for (let colOffset = 0; colOffset < visibleColumnCount; colOffset += 1) {
      const col = (range?.s.c ?? 0) + colOffset;
      const cellAddress = XLSX.utils.encode_cell({ c: col, r: row });
      const cellValue =
        worksheet?.[cellAddress]?.w ?? worksheet?.[cellAddress]?.v ?? "";

      ctx.fillStyle = secondary;
      ctx.fillText(
        String(cellValue),
        rowHeaderWidth + colOffset * columnWidth + 8,
        y + 17,
        columnWidth - 16,
      );
    }
  }

  return {
    pageCount: sheetCount,
    previewAspectRatio: maxWidth / maxHeight,
    url: canvas.toDataURL("image/png"),
  };
}

export const __xlsxViewerTestHooks = {
  resolveXlsxSheet,
};
