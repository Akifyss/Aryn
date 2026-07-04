"use client";

import * as React from "react";
import type * as GlideDataGrid from "@glideapps/glide-data-grid";
import type {
  DataEditorRef,
  DrawCellCallback,
  DrawHeaderCallback,
  GridCell,
  GridCellKind,
  GridColumn,
  GridSelection,
  Item,
  Theme,
} from "@glideapps/glide-data-grid";
import {
  CompactSelection,
  emptyGridSelection,
} from "@glideapps/glide-data-grid";

import "@glideapps/glide-data-grid/dist/index.css";

import {
  DownloadLine,
  LeftLine,
  More2Line,
  RightLine,
  SearchLine,
  UploadLine,
  ZoomInLine,
  ZoomOutLine,
} from "@mingcute/react";
import { Input, Spinner } from "@heroui/react";
import Papa from "papaparse";

import { AppTooltip } from "@/components/app-tooltip";
import { cn } from "@/components/ui/viewer-utils";
import {
  ViewerControlButton as Button,
  ViewerMenuContent as DropdownMenuContent,
  ViewerMenuItem as DropdownMenuItem,
  ViewerMenuRoot as DropdownMenu,
  ViewerMenuTrigger as DropdownMenuTrigger,
  ViewerPopoverContent as PopoverContent,
  ViewerPopoverRoot as Popover,
  ViewerPopoverTrigger as PopoverTrigger,
  ViewerToolbarSeparator as Separator,
  ViewerZoomSelect,
} from "@/components/ui/document-viewer-controls";
import { VIEWER_COPY } from "@/components/ui/viewer-copy";

const ZOOM_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;
const CSV_SEARCH_BATCH_ROW_COUNT = 500;
const CSV_SEARCH_DEBOUNCE_MS = 300;
type GlideDataGridModule = typeof GlideDataGrid;

function getCsvRowMarkerWidth(rowCount: number) {
  // Match Glide's default number row marker sizing. The width is explicit
  // because the custom separator needs the same sticky boundary coordinate.
  return rowCount > 10_000
    ? 48
    : rowCount > 1000
      ? 44
      : rowCount > 100
        ? 36
        : 32;
}

function shouldDrawGlideCsvVerticalBorder(columnIndex: number) {
  // DataEditor maps the row marker trailing edge to column 0 for vertical
  // borders. We redraw that separator once below, outside Glide's sticky
  // boundary overdraw path, so it stays visible without darkening on scroll.
  return columnIndex !== 0;
}

function drawCsvRowMarkerSeparator(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  rowMarkerWidth: number,
  color: string,
) {
  if (rect.x > rowMarkerWidth || rect.x + rect.width <= rowMarkerWidth) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(rowMarkerWidth + 0.5, rect.y);
  ctx.lineTo(rowMarkerWidth + 0.5, rect.y + rect.height);
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

type CsvViewerProps = {
  className?: string;
  data?: string;
  leadingToolbarActions?: React.ReactNode;
  search?: boolean;
  showDownload?: boolean;
  showToolbar?: boolean;
  showUpload?: boolean;
  toolbarActions?: React.ReactNode;
};

type CsvSearchResult = {
  col: number;
  row: number;
  displayValue: string;
  columnTitle: string;
};

function toDisplayString(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function normalizeHeaderTitle(header: string, index: number): string {
  const trimmed = header.trim();
  return trimmed.length > 0 ? trimmed : `第 ${index + 1} 列`;
}

function columnIndexToA1(col: number) {
  let columnNumber = col + 1;
  let columnName = "";

  while (columnNumber > 0) {
    const remainder = (columnNumber - 1) % 26;
    columnName = String.fromCharCode(65 + remainder) + columnName;
    columnNumber = Math.floor((columnNumber - 1) / 26);
  }

  return columnName;
}

function cellAddressToA1(col: number, row: number) {
  return `${columnIndexToA1(col)}${row + 1}`;
}

function cellMatchesQuery(displayValue: string, query: string) {
  return displayValue.toLowerCase().includes(query);
}

function createSingleCellSelection(cell: Item): GridSelection {
  const [col, row] = cell;

  return {
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
    current: {
      cell,
      range: { x: col, y: row, width: 1, height: 1 },
      rangeStack: [],
    },
  };
}

async function findCsvSearchResults(
  headers: string[],
  rows: string[][],
  rawQuery: string,
) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];

  const results: CsvSearchResult[] = [];
  const columnCount = Math.max(
    headers.length,
    rows.reduce((maxCount, row) => Math.max(maxCount, row.length), 0),
  );

  for (
    let batchStartRow = 0;
    batchStartRow < rows.length;
    batchStartRow += CSV_SEARCH_BATCH_ROW_COUNT
  ) {
    const batchEndRow = Math.min(
      batchStartRow + CSV_SEARCH_BATCH_ROW_COUNT,
      rows.length,
    );

    for (let row = batchStartRow; row < batchEndRow; row += 1) {
      const rowValues = rows[row] ?? [];

      for (let col = 0; col < columnCount; col += 1) {
        const displayValue = rowValues[col] ?? "";
        if (!cellMatchesQuery(displayValue, query)) continue;

        results.push({
          col,
          row,
          displayValue,
          columnTitle: headers[col] ?? `第 ${col + 1} 列`,
        });
      }
    }

    if (batchEndRow < rows.length) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0);
      });
    }
  }

  return results;
}

function parseDelimitedText(text: string): {
  headers: string[];
  rows: string[][];
  error: string | null;
} {
  const results = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: "greedy",
  });

  const objectRows = Array.isArray(results.data)
    ? results.data.filter(
        (row): row is Record<string, unknown> =>
          !!row && typeof row === "object" && !Array.isArray(row),
      )
    : [];
  const metaFields = Array.isArray(results.meta.fields)
    ? results.meta.fields.map((field) => String(field))
    : [];
  const fieldKeys =
    metaFields.length > 0
      ? metaFields
      : Object.keys(objectRows[0] ?? {}).filter(
          (key) => key !== "__parsed_extra",
        );
  const extraColumnCount = objectRows.reduce((maxCount, row) => {
    const extras = row.__parsed_extra;
    return Array.isArray(extras) ? Math.max(maxCount, extras.length) : maxCount;
  }, 0);
  const headers = [
    ...fieldKeys.map((field, index) => normalizeHeaderTitle(field, index)),
    ...Array.from(
      { length: extraColumnCount },
      (_, index) => `Extra ${index + 1}`,
    ),
  ];

  const rows = objectRows.map((row) => {
    const baseValues = fieldKeys.map((fieldKey) =>
      toDisplayString(row[fieldKey]),
    );
    const extras = Array.isArray(row.__parsed_extra)
      ? row.__parsed_extra.map((value) => toDisplayString(value))
      : [];
    const paddedExtras =
      extras.length >= extraColumnCount
        ? extras.slice(0, extraColumnCount)
        : [
            ...extras,
            ...Array.from(
              { length: extraColumnCount - extras.length },
              () => "",
            ),
          ];

    return [...baseValues, ...paddedExtras];
  });

  const firstError =
    Array.isArray(results.errors) && results.errors.length > 0
      ? results.errors[0]
      : null;

  return {
    headers,
    rows,
    error: rows.length === 0 && firstError ? VIEWER_COPY.unableToParseCsv : null,
  };
}

function ensureCsvExtension(fileName: string) {
  const lowerFileName = fileName.toLowerCase();
  return lowerFileName.endsWith(".csv") || lowerFileName.endsWith(".tsv")
    ? fileName
    : `${fileName}.csv`;
}

function downloadTextFile(text: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function CsvFileActionsMenu({
  downloadDisabled,
  isPending,
  onDownload,
  onUploadClick,
  showDownload,
  showUpload,
}: {
  downloadDisabled: boolean;
  isPending: boolean;
  onDownload: () => void;
  onUploadClick: () => void;
  showDownload: boolean;
  showUpload: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={VIEWER_COPY.openCsvActions}
          disabled={isPending}
        >
          <More2Line className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {showDownload ? (
          <DropdownMenuItem disabled={downloadDisabled} onClick={onDownload}>
            <DownloadLine className="size-4" />
            {VIEWER_COPY.download}
          </DropdownMenuItem>
        ) : null}
        {showUpload ? (
          <DropdownMenuItem disabled={isPending} onClick={onUploadClick}>
            {isPending ? (
              <Spinner className="size-4" />
            ) : (
              <UploadLine className="size-4" />
            )}
            {VIEWER_COPY.upload}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
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

function CsvSearchPopover({
  headers,
  rows,
  gridRef,
  dataIdentity,
  controlsDisabled,
  onGridSelectionChange,
}: {
  headers: string[];
  rows: string[][];
  gridRef: React.RefObject<DataEditorRef | null>;
  dataIdentity: string;
  controlsDisabled: boolean;
  onGridSelectionChange: (selection: GridSelection) => void;
}) {
  const [searchDraft, setSearchDraft] = React.useState("");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<CsvSearchResult[]>(
    [],
  );
  const [activeResultIndex, setActiveResultIndex] = React.useState(0);
  const [isSearching, setIsSearching] = React.useState(false);
  const searchRequestIdRef = React.useRef(0);
  const appliedResultKeyRef = React.useRef("");
  const activeResult = searchResults[activeResultIndex] ?? null;
  const activeResultKey = activeResult
    ? `${activeResult.row}:${activeResult.col}`
    : "";
  const hasActiveQuery = Boolean(searchQuery.trim());
  const resultLabel = isSearching
    ? VIEWER_COPY.searching
    : !hasActiveQuery
      ? VIEWER_COPY.noSearch
      : searchResults.length
        ? `${activeResultIndex + 1} / ${searchResults.length}`
        : VIEWER_COPY.noResults;

  const runSearch = React.useCallback(
    (rawQuery: string) => {
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
      void findCsvSearchResults(headers, rows, nextQuery)
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
    },
    [headers, rows],
  );

  React.useEffect(() => {
    const trimmedDraft = searchDraft.trim();

    if (!trimmedDraft) {
      runSearch("");
      return;
    }

    setIsSearching(true);
    const timeoutId = window.setTimeout(() => {
      runSearch(searchDraft);
    }, CSV_SEARCH_DEBOUNCE_MS);

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
    onGridSelectionChange(emptyGridSelection);
  }, [onGridSelectionChange]);

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
    onGridSelectionChange(emptyGridSelection);
  }, [dataIdentity, onGridSelectionChange]);

  React.useEffect(() => {
    if (!activeResult) return;

    if (appliedResultKeyRef.current === activeResultKey) return;
    appliedResultKeyRef.current = activeResultKey;

    const cell: Item = [activeResult.col, activeResult.row];
    onGridSelectionChange(createSingleCellSelection(cell));

    const frame = window.requestAnimationFrame(() => {
      gridRef.current?.scrollTo(
        activeResult.col,
        activeResult.row,
        "both",
        48,
        48,
        {
          vAlign: "center",
          hAlign: "center",
        },
      );
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeResult, activeResultKey, gridRef, onGridSelectionChange]);

  return (
    <Popover>
      <ToolbarTooltip label={VIEWER_COPY.searchCsv}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={VIEWER_COPY.searchCsv}
            disabled={controlsDisabled}
          >
            <SearchLine className="size-4" />
          </Button>
        </PopoverTrigger>
      </ToolbarTooltip>
      <PopoverContent align="end" className="w-72">
        <div className="space-y-3">
          <Input
            placeholder={VIEWER_COPY.searchCsv}
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
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
          />
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 text-xs text-[var(--foreground-secondary)]">
              <div className="truncate">
                {searchResults.length ? (
                  <>
                    <span className="text-[var(--accent)]">
                      {activeResultIndex + 1}
                    </span>
                    {` / ${searchResults.length}`}
                  </>
                ) : (
                  resultLabel
                )}
              </div>
              {activeResult ? (
                <div className="mt-0.5 truncate">
                  {activeResult.columnTitle}!
                  {cellAddressToA1(activeResult.col, activeResult.row)}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={VIEWER_COPY.previousResult}
                disabled={isSearching || searchResults.length === 0}
                onClick={() => goToRelativeResult(-1)}
              >
                <LeftLine className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={VIEWER_COPY.nextResult}
                disabled={isSearching || searchResults.length === 0}
                onClick={() => goToRelativeResult(1)}
              >
                <RightLine className="size-4" />
              </Button>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearSearch}
            >
              {VIEWER_COPY.clear}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function readIsDarkTheme() {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
  );
}

function useIsDarkTheme() {
  const [isDark, setIsDark] = React.useState(readIsDarkTheme);

  React.useEffect(() => {
    if (typeof document === "undefined") return;

    const updateTheme = () => setIsDark(readIsDarkTheme());

    updateTheme();

    if (typeof MutationObserver === "undefined") return;

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  return isDark;
}

function resolveCssColorToken(token: string) {
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.color = `var(${token})`;
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  document.documentElement.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

export function CsvViewer({
  className,
  data,
  leadingToolbarActions,
  search = false,
  showDownload = true,
  showToolbar = true,
  showUpload = true,
  toolbarActions,
}: CsvViewerProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const gridRef = React.useRef<DataEditorRef | null>(null);
  const isDark = useIsDarkTheme();
  const [glide, setGlide] = React.useState<GlideDataGridModule | null>(null);
  const [zoom, setZoom] = React.useState<(typeof ZOOM_OPTIONS)[number]>(1);
  const [gridSelection, setGridSelection] =
    React.useState<GridSelection>(emptyGridSelection);
  const [parsed, setParsed] = React.useState(() =>
    data ? parseDelimitedText(data) : { headers: [], rows: [], error: null },
  );
  const [uploadedFileName, setUploadedFileName] = React.useState<string | null>(
    null,
  );
  const [isPending, setIsPending] = React.useState(false);
  const [dataRevision, setDataRevision] = React.useState(0);

  const dataIdentity = React.useMemo(
    () =>
      `${dataRevision}:${parsed.headers.join("\u0001")}:${parsed.rows.length}:${parsed.error ?? ""}`,
    [dataRevision, parsed.error, parsed.headers, parsed.rows.length],
  );

  const handleGridSelectionChange = React.useCallback(
    (selection: GridSelection) => {
      setGridSelection(selection);
    },
    [],
  );

  React.useEffect(() => {
    if (data) {
      setParsed(parseDelimitedText(data));
      setUploadedFileName(null);
      setDataRevision((revision) => revision + 1);
    }
  }, [data]);

  React.useEffect(() => {
    if (!search) {
      setGridSelection(emptyGridSelection);
    }
  }, [search]);

  React.useEffect(() => {
    let mounted = true;

    void import("@glideapps/glide-data-grid").then((module) => {
      if (mounted) {
        setGlide(module);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  const columnCount = Math.max(1, parsed.headers.length);
  const scale = React.useCallback(
    (value: number) => Math.round(value * zoom),
    [zoom],
  );
  const searchDisabled =
    Boolean(parsed.error) || parsed.rows.length === 0 || isPending;

  const theme = React.useMemo<Partial<Theme>>(() => {
    const foregroundPrimary = resolveCssColorToken("--foreground-primary");
    const foregroundSecondary = resolveCssColorToken("--foreground-secondary");

    return {
      accentColor: resolveCssColorToken("--accent"),
      accentLight: resolveCssColorToken("--accent-soft"),
      accentFg: resolveCssColorToken("--foreground-on-accent"),
      textDark: foregroundPrimary,
      textMedium: foregroundSecondary,
      textLight: resolveCssColorToken("--foreground-tertiary"),
      textBubble: foregroundPrimary,
      textHeader: foregroundPrimary,
      textGroupHeader: foregroundSecondary,
      bgCell: resolveCssColorToken("--background-primary"),
      bgCellMedium: resolveCssColorToken("--background-secondary"),
      bgHeader: resolveCssColorToken("--background-secondary"),
      bgHeaderHasFocus: resolveCssColorToken("--active"),
      bgHeaderHovered: resolveCssColorToken("--hover"),
      borderColor: resolveCssColorToken("--border-secondary"),
      horizontalBorderColor: resolveCssColorToken("--border-secondary"),
      cellHorizontalPadding: scale(8),
      cellVerticalPadding: Math.max(2, scale(3)),
      headerIconSize: scale(18),
      baseFontStyle: `${scale(13)}px`,
      headerFontStyle: `600 ${scale(13)}px`,
      markerFontStyle: `${scale(11)}px`,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      editorFontSize: `${scale(13)}px`,
    };
  }, [isDark, scale]);

  const columns = React.useMemo<GridColumn[]>(
    () =>
      Array.from({ length: columnCount }, (_, index) => ({
        id: `column-${index}`,
        title: parsed.headers[index] ?? `第 ${index + 1} 列`,
        width: scale(index === 0 ? 180 : 160),
      })),
    [columnCount, parsed.headers, scale],
  );
  const rowMarkerWidth = getCsvRowMarkerWidth(parsed.rows.length);
  const rowMarkers = React.useMemo(
    () => ({ kind: "number" as const, width: rowMarkerWidth }),
    [rowMarkerWidth],
  );
  const drawHeader = React.useCallback<DrawHeaderCallback>(
    (args, drawContent) => {
      drawContent();
      drawCsvRowMarkerSeparator(
        args.ctx,
        args.rect,
        rowMarkerWidth,
        args.theme.borderColor,
      );
    },
    [rowMarkerWidth],
  );
  const drawCell = React.useCallback<DrawCellCallback>(
    (args, drawContent) => {
      drawContent();
      drawCsvRowMarkerSeparator(
        args.ctx,
        args.rect,
        rowMarkerWidth,
        args.theme.borderColor,
      );
    },
    [rowMarkerWidth],
  );

  const getCellContent = React.useCallback(
    ([col, row]: Item): GridCell => {
      const value = parsed.rows[row]?.[col] ?? "";
      const textKind = glide?.GridCellKind.Text as GridCellKind.Text;

      return {
        kind: textKind,
        data: value,
        displayData: value,
        allowOverlay: true,
        readonly: true,
      };
    },
    [glide, parsed.rows],
  );

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsPending(true);
    try {
      const text = await file.text();
      setParsed(parseDelimitedText(text));
      setUploadedFileName(file.name);
      setDataRevision((revision) => revision + 1);
    } catch (error) {
      setParsed({
        headers: [],
        rows: [],
        error: VIEWER_COPY.unableToParseCsv,
      });
      setDataRevision((revision) => revision + 1);
    } finally {
      event.target.value = "";
      setIsPending(false);
    }
  }

  function stepZoom(direction: -1 | 1) {
    const index = ZOOM_OPTIONS.indexOf(zoom);
    const nextIndex = Math.min(
      ZOOM_OPTIONS.length - 1,
      Math.max(0, index + direction),
    );
    setZoom(ZOOM_OPTIONS[nextIndex]);
  }

  function handleDownload() {
    const text = Papa.unparse({
      fields: parsed.headers,
      data: parsed.rows,
    });

    downloadTextFile(
      text,
      ensureCsvExtension(uploadedFileName ?? "data.csv"),
      "text/csv;charset=utf-8",
    );
  }

  return (
    <div
      data-slot="csv-viewer"
      className={cn(
        "flex h-[560px] w-full flex-col overflow-hidden bg-[var(--background-primary)]",
        className,
      )}
    >
      {showToolbar ? (
        <div className="viewer-toolbar justify-between">
          {leadingToolbarActions ? (
            <div className="flex min-w-0 items-center gap-1">
              {leadingToolbarActions}
            </div>
          ) : null}
          <div className="ml-auto flex min-w-0 items-center justify-end gap-1">
            <div className="flex flex-none items-center gap-1">
              <ToolbarTooltip label={VIEWER_COPY.zoomOut}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={VIEWER_COPY.zoomOut}
                  disabled={zoom <= ZOOM_OPTIONS[0]}
                  onClick={() => stepZoom(-1)}
                >
                  <ZoomOutLine className="size-4" />
                </Button>
              </ToolbarTooltip>
              <ViewerZoomSelect
                ariaLabel={VIEWER_COPY.zoomLevel}
                value={zoom}
                onValueChange={(value) =>
                  setZoom(value as (typeof ZOOM_OPTIONS)[number])
                }
                options={ZOOM_OPTIONS}
              />
              <ToolbarTooltip label={VIEWER_COPY.zoomIn}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={VIEWER_COPY.zoomIn}
                  disabled={zoom >= ZOOM_OPTIONS[ZOOM_OPTIONS.length - 1]}
                  onClick={() => stepZoom(1)}
                >
                  <ZoomInLine className="size-4" />
                </Button>
              </ToolbarTooltip>
            </div>
            {search ? (
              <>
                <Separator className="mx-1" />
                <CsvSearchPopover
                  headers={parsed.headers}
                  rows={parsed.rows}
                  gridRef={gridRef}
                  dataIdentity={dataIdentity}
                  controlsDisabled={searchDisabled}
                  onGridSelectionChange={handleGridSelectionChange}
                />
              </>
            ) : null}
            {toolbarActions ? (
              <>
                <Separator className="mx-1" />
                {toolbarActions}
              </>
            ) : null}
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.tsv,text/csv,text/tab-separated-values"
              className="hidden"
              onChange={handleUpload}
            />
            {showDownload || showUpload ? (
              <CsvFileActionsMenu
                showDownload={showDownload}
                showUpload={showUpload}
                downloadDisabled={
                  Boolean(parsed.error) ||
                  isPending ||
                  (parsed.headers.length === 0 && parsed.rows.length === 0)
                }
                isPending={isPending}
                onDownload={handleDownload}
                onUploadClick={() => inputRef.current?.click()}
              />
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        {parsed.error ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-[var(--danger)]">
            {parsed.error}
          </div>
        ) : parsed.rows.length === 0 ? (
          <div className="grid h-full place-items-center bg-[color-mix(in_oklab,var(--background-secondary)_30%,transparent)] p-4">
            <div className="max-w-md rounded-lg border bg-[var(--background-primary)] p-4 text-center text-sm shadow-xs">
              <p className="font-medium">{VIEWER_COPY.uploadCsvToPreview}</p>
              <p className="mt-1 text-[var(--foreground-secondary)]">
                {VIEWER_COPY.uploadCsvHelp}
              </p>
              {showUpload ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  disabled={isPending}
                  onClick={() => inputRef.current?.click()}
                >
                  {isPending ? (
                    <Spinner className="size-4" />
                  ) : (
                    <UploadLine className="size-4" />
                  )}
                  {VIEWER_COPY.uploadCsv}
                </Button>
              ) : null}
            </div>
          </div>
        ) : !glide ? (
          <div className="grid h-full place-items-center bg-[var(--background-primary)]">
            <Spinner className="size-4" />
          </div>
        ) : (
          <glide.DataEditor
            ref={search ? gridRef : undefined}
            key={zoom}
            columns={columns}
            rows={parsed.rows.length}
            getCellContent={getCellContent}
            rowMarkers={rowMarkers}
            rowSelectionMode="multi"
            gridSelection={search ? gridSelection : undefined}
            onGridSelectionChange={
              search ? handleGridSelectionChange : undefined
            }
            scrollToActiveCell={search}
            keybindings={{ search: true }}
            smoothScrollX
            smoothScrollY
            getCellsForSelection
            width="100%"
            height="100%"
            theme={theme}
            drawHeader={drawHeader}
            drawCell={drawCell}
            verticalBorder={shouldDrawGlideCsvVerticalBorder}
            rowHeight={scale(34)}
            headerHeight={scale(36)}
          />
        )}
      </div>
    </div>
  );
}

export async function renderCsvToDataUrlWithRowCount(
  text: string,
  {
    maxHeight = 260,
    maxWidth = 360,
    pixelRatio = typeof window === "undefined"
      ? 1
      : window.devicePixelRatio || 1,
  }: {
    maxHeight?: number;
    maxWidth?: number;
    pixelRatio?: number;
  } = {},
) {
  const parsed = parseDelimitedText(text);
  const rowCount = parsed.rows.length;
  const headers = parsed.headers.length ? parsed.headers : ["第 1 列"];
  const visibleRows = parsed.rows.slice(0, 12);
  const columnCount = Math.max(
    headers.length,
    visibleRows.reduce((count, row) => Math.max(count, row.length), 0),
    1,
  );
  const columnWidth = 128;
  const rowHeaderWidth = 44;
  const headerHeight = 32;
  const rowHeight = 28;
  const naturalWidth = rowHeaderWidth + columnCount * columnWidth;
  const naturalHeight =
    headerHeight + Math.max(1, visibleRows.length) * rowHeight;
  const width = Math.max(1, Math.min(maxWidth, naturalWidth));
  const height = Math.max(1, Math.min(maxHeight, naturalHeight));
  const ratio = Math.max(1, pixelRatio);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = Math.ceil(width * ratio);
  canvas.height = Math.ceil(height * ratio);

  if (!context) {
    return {
      pageCount: Math.max(1, rowCount),
      previewAspectRatio: width / height,
      url: null,
    };
  }

  context.scale(ratio, ratio);

  const styles = getComputedStyle(document.documentElement);
  const background = styles.getPropertyValue("--background-primary").trim();
  const headerBackground = styles
    .getPropertyValue("--background-secondary")
    .trim();
  const border = styles.getPropertyValue("--border-secondary").trim();
  const textColor = styles.getPropertyValue("--foreground-primary").trim();
  const mutedTextColor = styles
    .getPropertyValue("--foreground-secondary")
    .trim();

  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.fillStyle = headerBackground;
  context.fillRect(0, 0, width, headerHeight);
  context.fillRect(0, headerHeight, rowHeaderWidth, height - headerHeight);
  context.strokeStyle = border;
  context.lineWidth = 1;

  for (let col = 0; col <= columnCount; col += 1) {
    const x = rowHeaderWidth + col * columnWidth + 0.5;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }

  for (let row = 0; row <= visibleRows.length + 1; row += 1) {
    const y = headerHeight + row * rowHeight + 0.5;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  context.font = "600 12px ui-sans-serif, system-ui, sans-serif";
  context.fillStyle = mutedTextColor;
  context.textBaseline = "middle";

  for (let col = 0; col < columnCount; col += 1) {
    const label = headers[col] ?? `第 ${col + 1} 列`;
    context.fillText(
      label,
      rowHeaderWidth + col * columnWidth + 10,
      headerHeight / 2,
    );
  }

  context.font = "12px ui-sans-serif, system-ui, sans-serif";

  visibleRows.forEach((row, rowIndex) => {
    const y = headerHeight + rowIndex * rowHeight + rowHeight / 2;
    context.fillStyle = mutedTextColor;
    context.fillText(String(rowIndex + 1), 12, y);
    context.fillStyle = textColor;

    for (let col = 0; col < columnCount; col += 1) {
      const value = row[col] ?? "";
      const x = rowHeaderWidth + col * columnWidth + 10;
      const clipped = value.length > 24 ? `${value.slice(0, 23)}...` : value;
      context.fillText(clipped, x, y);
    }
  });

  return {
    pageCount: Math.max(1, rowCount),
    previewAspectRatio: width / height,
    url: canvas.toDataURL("image/png"),
  };
}

export const __csvViewerTestHooks = {
  parseDelimitedText: (text: string) => {
    const parsed = parseDelimitedText(text);
    return [parsed.headers, ...parsed.rows];
  },
};
