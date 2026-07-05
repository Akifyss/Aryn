"use client";

import * as React from "react";
import {
  DocxEditorViewer,
  useDocxComments,
  useDocxEditor,
  useDocxPageLayout,
  useDocxTrackChanges,
  useDocxViewerThumbnails,
  type DocxDocumentTheme,
  type DocxEditorController,
  type DocxPageThumbnailItem,
  setWasmSource,
} from "@extend-ai/react-docx";
import docxWasmUrl from "@extend-ai/react-docx/docx_wasm_bg.wasm?url";
import {
  CommentLine,
  DownloadLine,
  GitCompareLine,
  LayoutLeftLine,
  MoonLine,
  More2Line,
  UploadLine,
} from "@mingcute/react";
import { Spinner } from "@heroui/react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { AppScrollArea } from "@/components/app-scroll-area";
import { AppTooltip } from "@/components/app-tooltip";
import { cn } from "@/components/ui/viewer-utils";
import {
  ViewerControlButton as Button,
  ViewerMenuCheckboxItem as DropdownMenuCheckboxItem,
  ViewerMenuContent as DropdownMenuContent,
  ViewerMenuItem as DropdownMenuItem,
  ViewerMenuRoot as DropdownMenu,
  ViewerMenuSeparator as DropdownMenuSeparator,
  ViewerMenuTrigger as DropdownMenuTrigger,
  ViewerPageNumberControl,
  ViewerToolbar,
  ViewerToolbarGroup,
  ViewerToolbarSeparator as Separator,
  ViewerZoomControls,
} from "@/components/ui/document-viewer-controls";
import {
  DocumentViewerThumbnailSidebar,
  useElementWidth,
  useInlineThumbnailSidebar,
} from "@/components/ui/document-viewer-sidebar";
import {
  createDocxCommentCardRenderer,
  createDocxTrackedChangeCardRenderer,
} from "@/components/ui/docx-annotation-card";
import { FileThumbnail } from "@/components/ui/file-thumbnail";
import { VIEWER_COPY } from "@/components/ui/viewer-copy";

const docxWasmState = globalThis as typeof globalThis & {
  __arynDocxViewerWasmConfigured?: boolean;
  __arynDocxViewerWasmPromise?: Promise<void>;
};

function ensureDocxWasmConfigured() {
  if (docxWasmState.__arynDocxViewerWasmConfigured) {
    return Promise.resolve();
  }

  if (!docxWasmState.__arynDocxViewerWasmPromise) {
    setWasmSource(docxWasmUrl);
    docxWasmState.__arynDocxViewerWasmConfigured = true;
    docxWasmState.__arynDocxViewerWasmPromise = Promise.resolve();
  }

  return docxWasmState.__arynDocxViewerWasmPromise;
}

const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCX_LOADING_INDICATOR_DELAY_MS = 300;
const DOCX_THUMBNAIL_WIDTH = 92;
const DOCX_THUMBNAIL_LIST_PADDING = 16;
const DOCX_THUMBNAIL_ROW_ESTIMATE = 172;
const DEFAULT_ZOOM = 100;
const ZOOM_OPTIONS = [10, 25, 50, 75, 100, 125, 150, 175, 200, 400] as const;
const DOCX_PADDING_WARNING_TEXT = "a style property during rerender";
const DOCX_THUMBNAIL_FOCUS_RING_CLASS =
  "group-focus-visible/docx-thumbnail-sidebar:ring-2 group-focus-visible/docx-thumbnail-sidebar:ring-[var(--focus)] group-focus-visible/docx-thumbnail-sidebar:ring-offset-1 group-focus-visible/docx-thumbnail-sidebar:ring-offset-[var(--background-primary)]";
const DOCX_THUMBNAIL_PREFETCH_ROWS = 4;

type UploadedDocxFile = {
  file: File;
  identity: string;
  sourceUrl: string | undefined;
};

type DocxActivePageStore = {
  getSnapshot: () => number;
  setActivePage: React.Dispatch<React.SetStateAction<number>>;
  subscribe: (listener: () => void) => () => void;
};

type DocxThumbnailRenderWindowState = {
  visiblePageIndexes: number[];
  prefetchPageIndexes: number[];
};

function createDocxActivePageStore(): DocxActivePageStore {
  let activePage = 1;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => activePage,
    setActivePage: (nextPage) => {
      const value =
        typeof nextPage === "function" ? nextPage(activePage) : nextPage;
      const normalizedValue = Math.max(1, Math.round(value || 1));

      if (normalizedValue === activePage) return;

      activePage = normalizedValue;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function useDocxActivePage(activePageStore: DocxActivePageStore) {
  return React.useSyncExternalStore(
    activePageStore.subscribe,
    activePageStore.getSnapshot,
    activePageStore.getSnapshot,
  );
}

function areNumberArraysEqual(left: number[], right: number[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

async function loadDocxFile(
  url: string,
  displayFileName: string,
): Promise<File> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${VIEWER_COPY.docxFetchFailed} (${response.status})`);
  }

  const blob = await response.blob();
  return new File([blob], displayFileName, {
    type: blob.type || DOCX_MIME_TYPE,
  });
}

function formatDocumentName(fileName: string | undefined, url: string) {
  if (fileName?.trim()) return fileName;

  const pathname = url.split("?")[0] ?? "";
  const rawName = pathname.split("/").pop() ?? "document.docx";

  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

function ensureDocxExtension(fileName: string) {
  return fileName.toLowerCase().endsWith(".docx")
    ? fileName
    : `${fileName}.docx`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function downloadDocxFile({
  file,
  fileName,
  url,
}: {
  file?: File;
  fileName: string;
  url?: string;
}) {
  if (file) {
    downloadBlob(file, ensureDocxExtension(fileName));
    return;
  }

  if (!url) return;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${VIEWER_COPY.docxDownloadFailed} (${response.status})`);
  }

  downloadBlob(await response.blob(), ensureDocxExtension(fileName));
}

function normalizeDocxZoomScale(value: number | undefined): number {
  return typeof value === "number" &&
    ZOOM_OPTIONS.includes(value as (typeof ZOOM_OPTIONS)[number])
    ? value
    : DEFAULT_ZOOM;
}

function useDelayedLoadingIndicator(isLoading: boolean, delayMs: number) {
  const [showSpinner, setShowSpinner] = React.useState(false);

  React.useEffect(() => {
    if (!isLoading) return;

    const timeoutId = window.setTimeout(() => {
      setShowSpinner(true);
    }, delayMs);

    return () => {
      window.clearTimeout(timeoutId);
      setShowSpinner(false);
    };
  }, [delayMs, isLoading]);

  return isLoading && showSpinner;
}

function isDocxPaddingWarning(args: unknown[]) {
  return (
    typeof args[0] === "string" &&
    args[0].includes(DOCX_PADDING_WARNING_TEXT) &&
    args.some((arg) => String(arg).includes("padding"))
  );
}

function useSuppressDocxPaddingWarning(enabled: boolean) {
  React.useEffect(() => {
    if (!enabled) return;

    const originalConsoleError = console.error;

    console.error = (...args: unknown[]) => {
      if (isDocxPaddingWarning(args)) return;
      originalConsoleError(...args);
    };

    return () => {
      console.error = originalConsoleError;
    };
  }, [enabled]);
}

function isInteractiveViewerTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'a[href], button, input, select, textarea, [contenteditable="true"], [role="button"], [role="link"]',
      ),
    )
  );
}

function formatDocxLoadError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  if (message === VIEWER_COPY.docxUnsupportedFile) {
    return message;
  }

  if (message.includes(VIEWER_COPY.docxFetchFailed)) {
    return message;
  }

  if (message === "Only .docx files are supported") {
    return VIEWER_COPY.docxUnsupportedFile;
  }

  if (message.startsWith("Failed to load file")) {
    return VIEWER_COPY.unableToLoadDocx;
  }

  return VIEWER_COPY.unableToLoadDocx;
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
    <div className="grid h-full min-h-52 place-items-center bg-transparent">
      {showSpinner ? <Spinner className="size-4" /> : null}
    </div>
  );
}

function DocxFileActionsMenu({
  controlsDisabled,
  downloadDisabled,
  isPreparingDownload,
  isDark,
  onDownload,
  onShowCommentsChange,
  onShowTrackedChangesChange,
  onIsDarkChange,
  onUploadClick,
  showComments,
  showDownloadButton,
  showNightRenderToggle,
  showTrackedChanges,
  showUploadButton,
}: {
  controlsDisabled: boolean;
  downloadDisabled: boolean;
  isPreparingDownload: boolean;
  isDark: boolean;
  onDownload: () => void;
  onShowCommentsChange: (checked: boolean) => void;
  onShowTrackedChangesChange: (checked: boolean) => void;
  onIsDarkChange: (checked: boolean) => void;
  onUploadClick: () => void;
  showComments: boolean;
  showDownloadButton: boolean;
  showNightRenderToggle: boolean;
  showTrackedChanges: boolean;
  showUploadButton: boolean;
}) {
  const showFileActions = showDownloadButton || showUploadButton;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={VIEWER_COPY.openDocxActions}
        >
          <More2Line aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {showNightRenderToggle ? (
          <>
            <DropdownMenuCheckboxItem
              checked={isDark}
              disabled={controlsDisabled}
              onCheckedChange={(checked) => onIsDarkChange(checked === true)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <MoonLine aria-hidden="true" className="size-4" />
                {VIEWER_COPY.darkMode}
              </span>
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuCheckboxItem
          checked={showComments}
          disabled={controlsDisabled}
          onCheckedChange={(checked) => onShowCommentsChange(checked === true)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <CommentLine aria-hidden="true" className="size-4" />
            {VIEWER_COPY.showComments}
          </span>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={showTrackedChanges}
          disabled={controlsDisabled}
          onCheckedChange={(checked) =>
            onShowTrackedChangesChange(checked === true)
          }
        >
          <span className="flex min-w-0 items-center gap-2">
            <GitCompareLine aria-hidden="true" className="size-4" />
            {VIEWER_COPY.showTrackedChanges}
          </span>
        </DropdownMenuCheckboxItem>
        {showFileActions ? <DropdownMenuSeparator /> : null}
        {showDownloadButton ? (
          <DropdownMenuItem disabled={downloadDisabled} onClick={onDownload}>
            {isPreparingDownload ? (
              <Spinner aria-hidden="true" className="size-4" />
            ) : (
              <DownloadLine aria-hidden="true" className="size-4" />
            )}
            {VIEWER_COPY.download}
          </DropdownMenuItem>
        ) : null}
        {showUploadButton ? (
          <DropdownMenuItem onClick={onUploadClick}>
            <UploadLine aria-hidden="true" className="size-4" />
            {VIEWER_COPY.upload}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DocxPageNumberControl({
  activePageStore,
  controlsDisabled,
  onPageChange,
  pageCount,
}: {
  activePageStore: DocxActivePageStore;
  controlsDisabled: boolean;
  onPageChange: (pageNumber: number) => void;
  pageCount: number;
}) {
  const activePage = useDocxActivePage(activePageStore);

  return (
    <ViewerPageNumberControl
      activePage={activePage}
      controlsDisabled={controlsDisabled}
      currentPageEditLabel={VIEWER_COPY.currentPageEdit}
      onPageChange={onPageChange}
      pageCount={pageCount}
      pageNumberLabel={VIEWER_COPY.pageNumber}
    />
  );
}

function DocxToolbar({
  activePageStore,
  leadingToolbarActions,
  controlsDisabled,
  isDark,
  isPreparingDownload,
  onDownload,
  onIsDarkChange,
  onPageChange,
  onShowCommentsChange,
  onShowTrackedChangesChange,
  onToggleSidebar,
  onUploadClick,
  pageCount,
  setZoomScale,
  showComments,
  showDownloadButton = true,
  showNightRenderToggle,
  showTrackedChanges,
  showUploadButton = true,
  toolbarActions,
  zoomScale,
}: {
  activePageStore: DocxActivePageStore;
  controlsDisabled: boolean;
  isDark: boolean;
  isPreparingDownload: boolean;
  leadingToolbarActions?: React.ReactNode;
  onDownload: () => void;
  onIsDarkChange: (checked: boolean) => void;
  onPageChange: (pageNumber: number) => void;
  onShowCommentsChange: (checked: boolean) => void;
  onShowTrackedChangesChange: (checked: boolean) => void;
  onToggleSidebar: () => void;
  onUploadClick: () => void;
  pageCount: number;
  setZoomScale: React.Dispatch<React.SetStateAction<number>>;
  showComments: boolean;
  showDownloadButton?: boolean;
  showNightRenderToggle: boolean;
  showTrackedChanges: boolean;
  showUploadButton?: boolean;
  toolbarActions?: React.ReactNode;
  zoomScale: number;
}) {
  const shouldShowFileActionsMenu =
    showDownloadButton || showUploadButton || showNightRenderToggle;

  return (
    <ViewerToolbar>
      <ViewerToolbarGroup>
        {leadingToolbarActions ? (
          <>
            {leadingToolbarActions}
            <Separator />
          </>
        ) : null}
        <ToolbarTooltip label={VIEWER_COPY.toggleThumbnails}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={VIEWER_COPY.toggleThumbnails}
            disabled={controlsDisabled}
            onClick={onToggleSidebar}
          >
            <LayoutLeftLine aria-hidden="true" className="size-4" />
          </Button>
        </ToolbarTooltip>
        <DocxPageNumberControl
          activePageStore={activePageStore}
          controlsDisabled={controlsDisabled}
          onPageChange={onPageChange}
          pageCount={pageCount}
        />
      </ViewerToolbarGroup>
      <ViewerToolbarGroup align="end">
        <ViewerZoomControls
          ariaLabel={VIEWER_COPY.zoomLevel}
          disabled={controlsDisabled}
          onValueChange={setZoomScale}
          options={ZOOM_OPTIONS}
          value={zoomScale}
          zoomInLabel={VIEWER_COPY.zoomIn}
          zoomOutLabel={VIEWER_COPY.zoomOut}
        />
        {toolbarActions ? (
          <>
            <Separator />
            {toolbarActions}
          </>
        ) : null}
        {shouldShowFileActionsMenu ? (
          <>
            <Separator />
            <DocxFileActionsMenu
              controlsDisabled={controlsDisabled}
              downloadDisabled={controlsDisabled || isPreparingDownload}
              isPreparingDownload={isPreparingDownload}
              isDark={isDark}
              onDownload={onDownload}
              onIsDarkChange={onIsDarkChange}
              onShowCommentsChange={onShowCommentsChange}
              onShowTrackedChangesChange={onShowTrackedChangesChange}
              onUploadClick={onUploadClick}
              showComments={showComments}
              showDownloadButton={showDownloadButton}
              showNightRenderToggle={showNightRenderToggle}
              showTrackedChanges={showTrackedChanges}
              showUploadButton={showUploadButton}
            />
          </>
        ) : null}
      </ViewerToolbarGroup>
    </ViewerToolbar>
  );
}

function DocxSidebarThumbnail({
  canvasRef,
  displayFileName,
  hasError,
  isActive,
  isLoading,
  pageNumber,
  pixelHeightPx,
  pixelWidthPx,
  previewAspectRatio,
}: {
  canvasRef: React.RefCallback<HTMLCanvasElement>;
  displayFileName: string;
  hasError: boolean;
  isActive: boolean;
  isLoading: boolean;
  pageNumber: number;
  pixelHeightPx: number;
  pixelWidthPx: number;
  previewAspectRatio: number;
}) {
  return (
    <FileThumbnail
      file={{
        name: `${displayFileName} page ${pageNumber}`,
        type: DOCX_MIME_TYPE,
      }}
      previewAspectRatio={previewAspectRatio}
      previewClassName="rounded-md bg-white"
      previewContent={
        <canvas
          ref={canvasRef}
          width={pixelWidthPx}
          height={pixelHeightPx}
          className="!size-full bg-white object-cover object-top"
        />
      }
      isLoading={isLoading}
      hasError={hasError}
      className={cn(
        "w-[92px] rounded-md border-0 shadow-xs ring-0 transition-shadow duration-150",
        isActive && "shadow-sm",
      )}
    />
  );
}

function DocxThumbnailSidebarList({
  activePage,
  displayFileName,
  isLoadingDocument,
  onSelectPage,
  onThumbnailRenderWindowChange,
  pageCount,
  sidebarOpen,
  thumbnails,
}: {
  activePage: number;
  displayFileName: string;
  isLoadingDocument: boolean;
  onSelectPage: (pageNumber: number) => void;
  onThumbnailRenderWindowChange: (
    renderWindow: DocxThumbnailRenderWindowState,
  ) => void;
  pageCount: number;
  sidebarOpen: boolean;
  thumbnails: DocxPageThumbnailItem[];
}) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const thumbnailListboxId = React.useId();
  const visibleThumbnails = React.useMemo(
    () => thumbnails.slice(0, pageCount || 0),
    [pageCount, thumbnails],
  );
  const activeDescendantId =
    activePage > 0 && visibleThumbnails.length
      ? `${thumbnailListboxId}-page-${activePage}`
      : undefined;
  const virtualizer = useVirtualizer({
    count: visibleThumbnails.length,
    estimateSize: () => DOCX_THUMBNAIL_ROW_ESTIMATE,
    getItemKey: (index) => visibleThumbnails[index]?.pageIndex ?? index,
    getScrollElement: () => viewportRef.current,
    overscan: 3,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const renderWindowSignature = virtualItems
    .map((virtualRow) => virtualRow.index)
    .join(",");

  React.useEffect(() => {
    if (!sidebarOpen || isLoadingDocument || !visibleThumbnails.length) {
      onThumbnailRenderWindowChange({
        prefetchPageIndexes: [],
        visiblePageIndexes: [],
      });
      return;
    }

    const visiblePageIndexes = virtualItems
      .map((virtualRow) => visibleThumbnails[virtualRow.index]?.pageIndex)
      .filter((pageIndex): pageIndex is number => pageIndex !== undefined);

    const firstVirtualIndex = virtualItems[0]?.index ?? 0;
    const lastVirtualIndex =
      virtualItems[virtualItems.length - 1]?.index ?? firstVirtualIndex;
    const firstPrefetchIndex = Math.max(
      0,
      firstVirtualIndex - DOCX_THUMBNAIL_PREFETCH_ROWS,
    );
    const lastPrefetchIndex = Math.min(
      visibleThumbnails.length - 1,
      lastVirtualIndex + DOCX_THUMBNAIL_PREFETCH_ROWS,
    );
    const visiblePageIndexSet = new Set(visiblePageIndexes);
    const prefetchPageIndexes: number[] = [];

    for (
      let index = firstPrefetchIndex;
      index <= lastPrefetchIndex;
      index += 1
    ) {
      const pageIndex = visibleThumbnails[index]?.pageIndex;

      if (pageIndex !== undefined && !visiblePageIndexSet.has(pageIndex)) {
        prefetchPageIndexes.push(pageIndex);
      }
    }

    onThumbnailRenderWindowChange({
      prefetchPageIndexes,
      visiblePageIndexes,
    });
  }, [
    isLoadingDocument,
    onThumbnailRenderWindowChange,
    renderWindowSignature,
    sidebarOpen,
    visibleThumbnails,
    virtualItems,
  ]);

  React.useEffect(() => {
    if (!sidebarOpen || activePage < 1 || !visibleThumbnails.length) return;

    virtualizer.scrollToIndex(
      Math.min(activePage - 1, visibleThumbnails.length - 1),
      { align: "auto" },
    );
  }, [activePage, sidebarOpen, virtualizer, visibleThumbnails.length]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (pageCount < 1) return;

      const currentPage = activePage > 0 ? activePage : 1;
      let nextPage: number | null = null;

      if (event.key === "ArrowDown") {
        nextPage = Math.min(pageCount, currentPage + 1);
      } else if (event.key === "ArrowUp") {
        nextPage = Math.max(1, currentPage - 1);
      } else if (event.key === "Home") {
        nextPage = 1;
      } else if (event.key === "End") {
        nextPage = pageCount;
      }

      if (nextPage === null) return;

      event.preventDefault();
      onSelectPage(nextPage);
    },
    [activePage, onSelectPage, pageCount],
  );

  return (
    <AppScrollArea
      className="h-full"
      viewportClassName="group/docx-thumbnail-sidebar focus-visible:ring-0 focus-visible:ring-offset-0"
      viewportProps={{
        "aria-activedescendant": activeDescendantId,
        "aria-busy": isLoadingDocument || undefined,
        "aria-label": "DOCX 页面",
        onKeyDown: handleKeyDown,
        onMouseDown: (event) => {
          event.currentTarget.focus({ preventScroll: true });
        },
        role: "listbox",
        tabIndex: 0,
      }}
      viewportRef={viewportRef}
    >
      {isLoadingDocument ? (
        <div className="p-4">
          <div className="mx-auto h-28 w-20 overflow-hidden rounded-md bg-[var(--background-primary)] shadow-xs">
            <div className="h-full animate-pulse bg-[var(--background-secondary)]" />
          </div>
          <div className="mx-auto mt-3 h-3 w-10 rounded-full bg-[var(--background-secondary)]" />
        </div>
      ) : visibleThumbnails.length ? (
        <div
          className="relative"
          style={{
            height:
              virtualizer.getTotalSize() + DOCX_THUMBNAIL_LIST_PADDING * 2,
          }}
        >
          {virtualItems.map((virtualRow) => {
            const thumbnail = visibleThumbnails[virtualRow.index];
            if (!thumbnail) return null;

            return (
              <div
                key={virtualRow.key}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                className={cn(
                  "absolute top-0 right-3 left-3 pb-3 [contain:layout]",
                  thumbnail.pageNumber === activePage && "z-10",
                )}
                style={{
                  transform: `translateY(${
                    virtualRow.start + DOCX_THUMBNAIL_LIST_PADDING
                  }px)`,
                }}
              >
                <div
                  id={`${thumbnailListboxId}-page-${thumbnail.pageNumber}`}
                  role="option"
                  aria-current={
                    thumbnail.pageNumber === activePage ? "page" : undefined
                  }
                  aria-label={`第 ${thumbnail.pageNumber} 页`}
                  aria-posinset={thumbnail.pageNumber}
                  aria-selected={thumbnail.pageNumber === activePage}
                  aria-setsize={pageCount}
                  data-docx-viewer-thumbnail-option={thumbnail.pageNumber}
                  className={cn(
                    "flex h-auto w-full cursor-default flex-col items-center gap-2 rounded-md p-2 text-xs transition-shadow outline-none select-none hover:bg-[var(--selected)]",
                    thumbnail.pageNumber === activePage &&
                      "bg-[var(--selected)] text-[var(--foreground-primary)]",
                    thumbnail.pageNumber !== activePage &&
                      "text-[var(--foreground-secondary)]",
                    thumbnail.pageNumber === activePage &&
                      DOCX_THUMBNAIL_FOCUS_RING_CLASS,
                  )}
                  onClick={() => onSelectPage(thumbnail.pageNumber)}
                >
                  <DocxSidebarThumbnail
                    canvasRef={thumbnail.canvasRef}
                    displayFileName={displayFileName}
                    hasError={thumbnail.status === "error"}
                    isActive={thumbnail.pageNumber === activePage}
                    isLoading={
                      thumbnail.status !== "ready" &&
                      thumbnail.status !== "error"
                    }
                    pageNumber={thumbnail.pageNumber}
                    pixelHeightPx={thumbnail.pixelHeightPx}
                    pixelWidthPx={thumbnail.pixelWidthPx}
                    previewAspectRatio={thumbnail.aspectRatio}
                  />
                  {thumbnail.pageNumber}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </AppScrollArea>
  );
}

function DocxThumbnailSidebarContent({
  activePageStore,
  displayFileName,
  editor,
  isLoadingDocument,
  onSelectPage,
  pageCount,
  reportedPageCount,
  sidebarOpen,
}: {
  activePageStore: DocxActivePageStore;
  displayFileName: string;
  editor: DocxEditorController;
  isLoadingDocument: boolean;
  onSelectPage: (pageNumber: number) => void;
  pageCount: number;
  reportedPageCount: number;
  sidebarOpen: boolean;
}) {
  const [thumbnailRenderWindow, setThumbnailRenderWindow] =
    React.useState<DocxThumbnailRenderWindowState>({
      prefetchPageIndexes: [],
      visiblePageIndexes: [],
    });
  const thumbnailEditor = React.useMemo<DocxEditorController>(
    () => ({
      ...editor,
      totalPages: Math.max(editor.totalPages, reportedPageCount),
    }),
    [editor, reportedPageCount],
  );
  const thumbnailOptions = React.useMemo(
    () => ({
      // Detached thumbnail rendering handles offscreen pages; keep the raster
      // queue dormant while the sidebar is closed.
      disabled: !sidebarOpen,
      pixelRatio: 2,
      renderWindow: thumbnailRenderWindow,
      resolution: {
        maxHeight: DOCX_THUMBNAIL_WIDTH * 1.35,
        maxWidth: DOCX_THUMBNAIL_WIDTH,
      },
    }),
    [sidebarOpen, thumbnailRenderWindow],
  );
  const { thumbnails } = useDocxViewerThumbnails(
    thumbnailEditor,
    thumbnailOptions,
  );
  const activePage = useDocxActivePage(activePageStore);
  const handleThumbnailRenderWindowChange = React.useCallback(
    (nextRenderWindow: DocxThumbnailRenderWindowState) => {
      setThumbnailRenderWindow((currentRenderWindow) => {
        if (
          areNumberArraysEqual(
            currentRenderWindow.visiblePageIndexes,
            nextRenderWindow.visiblePageIndexes,
          ) &&
          areNumberArraysEqual(
            currentRenderWindow.prefetchPageIndexes,
            nextRenderWindow.prefetchPageIndexes,
          )
        ) {
          return currentRenderWindow;
        }

        return nextRenderWindow;
      });
    },
    [],
  );

  if (!sidebarOpen) return null;

  return (
    <DocxThumbnailSidebarList
      activePage={activePage}
      displayFileName={displayFileName}
      isLoadingDocument={isLoadingDocument}
      onSelectPage={onSelectPage}
      onThumbnailRenderWindowChange={handleThumbnailRenderWindowChange}
      pageCount={pageCount}
      sidebarOpen={sidebarOpen}
      thumbnails={thumbnails}
    />
  );
}

export function DocxViewerPreview({
  className,
  defaultZoom = DEFAULT_ZOOM,
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
  defaultZoom?: number;
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
    <DocxViewerContent
      className={className}
      defaultZoom={defaultZoom}
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

function DocxViewerContent({
  className,
  defaultZoom,
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
  defaultZoom?: number;
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
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const [viewportElement, setViewportElement] =
    React.useState<HTMLDivElement | null>(null);
  const [viewerShellRef, viewerShellWidth] = useElementWidth<HTMLDivElement>();
  const [uploadedDocxFile, setUploadedDocxFile] =
    React.useState<UploadedDocxFile | null>(null);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const activePageStore = React.useMemo(createDocxActivePageStore, []);
  const resolvedDefaultZoomScale = normalizeDocxZoomScale(defaultZoom);
  const activeUploadedDocxFile =
    uploadedDocxFile?.sourceUrl === url ? uploadedDocxFile : null;
  const documentKey = activeUploadedDocxFile?.identity ?? url ?? "";
  const setActivePage = activePageStore.setActivePage;
  const sidebarInline = useInlineThumbnailSidebar(viewerShellWidth);
  const viewerBackgroundColor = "var(--background-primary)";
  const displayFileName = React.useMemo(
    () =>
      activeUploadedDocxFile?.file.name ??
      (url ? formatDocumentName(fileName, url) : (fileName ?? "document.docx")),
    [activeUploadedDocxFile?.file.name, fileName, url],
  );
  const [initialDocumentTheme] = React.useState<DocxDocumentTheme>(() =>
    effectiveIsDark ? "dark" : "light",
  );
  const editorOptions = React.useMemo(
    () => ({
      initialDocumentTheme,
      initialFileName: displayFileName,
    }),
    [displayFileName, initialDocumentTheme],
  );
  const editor = useDocxEditor(editorOptions);
  const { layout: pageLayout } = useDocxPageLayout(editor);
  const { importDocxFile, setDocumentTheme, status } = editor;
  const { showComments, setShowComments } = useDocxComments(editor);
  const { showTrackedChanges, setShowTrackedChanges } =
    useDocxTrackChanges(editor);
  const [reportedPageCount, setReportedPageCount] = React.useState(0);
  const [zoomScaleState, setZoomScaleState] = React.useState({
    documentKey: "",
    value: resolvedDefaultZoomScale,
  });
  const zoomScale =
    zoomScaleState.documentKey === documentKey
      ? zoomScaleState.value
      : resolvedDefaultZoomScale;
  const setZoomScale = React.useCallback<
    React.Dispatch<React.SetStateAction<number>>
  >(
    (nextZoomScale) => {
      setZoomScaleState((currentState) => {
        const currentZoomScale =
          currentState.documentKey === documentKey
            ? currentState.value
            : resolvedDefaultZoomScale;
        const value =
          typeof nextZoomScale === "function"
            ? nextZoomScale(currentZoomScale)
            : nextZoomScale;

        return { documentKey, value };
      });
    },
    [documentKey, resolvedDefaultZoomScale],
  );
  const [loadError, setLoadError] = React.useState<string>();
  const [isLoadingDocument, setIsLoadingDocument] = React.useState(true);
  const [isPreparingDownload, setIsPreparingDownload] = React.useState(false);
  const shouldShowDocumentSpinner = useDelayedLoadingIndicator(
    isLoadingDocument,
    DOCX_LOADING_INDICATOR_DELAY_MS,
  );
  const loadingState = (
    <ViewerLoadingSurface showSpinner={shouldShowDocumentSpinner} />
  );
  const documentTheme = effectiveIsDark ? "dark" : "light";
  const renderTrackedChangeCard = React.useMemo(
    () => createDocxTrackedChangeCardRenderer(documentTheme),
    [documentTheme],
  );
  const renderCommentCard = React.useMemo(
    () => createDocxCommentCardRenderer(documentTheme),
    [documentTheme],
  );
  const hasDocument = Boolean(url || activeUploadedDocxFile);
  const pageCount =
    hasDocument && !isLoadingDocument && !loadError
      ? Math.max(1, reportedPageCount || editor.totalPages)
      : 0;
  const thumbnailSidebarVisible = Boolean(
    sidebarOpen && (pageCount || isLoadingDocument),
  );
  const controlsDisabled =
    !hasDocument || isLoadingDocument || Boolean(loadError);
  const handlePageCountChange = React.useCallback((nextPageCount: number) => {
    setReportedPageCount(Math.max(1, Math.round(nextPageCount || 1)));
  }, []);
  const setViewportRef = React.useCallback((element: HTMLDivElement | null) => {
    viewportRef.current = element;
    setViewportElement(element);
  }, []);
  const pageVirtualization = React.useMemo(
    () => ({
      enabled: true,
      overscan: 1,
      scrollElement: viewportElement,
      zoomScale: zoomScale / 100,
    }),
    [viewportElement, zoomScale],
  );
  const handleDownload = React.useCallback(async () => {
    if (isPreparingDownload) return;
    if (!activeUploadedDocxFile && !url) return;

    setIsPreparingDownload(true);

    try {
      await downloadDocxFile({
        file: activeUploadedDocxFile?.file,
        fileName: displayFileName,
        url,
      });
    } catch (error) {
      console.error(error);
    } finally {
      setIsPreparingDownload(false);
    }
  }, [activeUploadedDocxFile, displayFileName, isPreparingDownload, url]);
  useSuppressDocxPaddingWarning(!isLoadingDocument && !loadError);

  React.useEffect(() => {
    setActivePage(1);
    viewportRef.current?.scrollTo({ top: 0, left: 0 });
  }, [documentKey, setActivePage]);

  React.useEffect(() => {
    setDocumentTheme(effectiveIsDark ? "dark" : "light");
  }, [effectiveIsDark, setDocumentTheme]);

  React.useEffect(() => {
    if (
      status.startsWith("Failed to load file") ||
      status === "Only .docx files are supported"
    ) {
      const frame = window.requestAnimationFrame(() => {
        setLoadError(formatDocxLoadError(status));
        setIsLoadingDocument(false);
      });

      return () => window.cancelAnimationFrame(frame);
    }
  }, [status]);

  // Imports mutate the shared editor instance; concurrent calls (effect
  // re-runs, StrictMode double-invoke) race inside the parser and surface as
  // bogus "Invalid DOCX ZIP" errors, so every import is chained through here.
  const importQueueRef = React.useRef<Promise<void>>(Promise.resolve());

  React.useEffect(() => {
    let isCurrent = true;

    async function load() {
      // Superseded while queued: let the newest import run instead.
      if (!isCurrent) return;
      if (!activeUploadedDocxFile && !url) {
        setIsLoadingDocument(false);
        setLoadError(undefined);
        setReportedPageCount(0);
        return;
      }

      setIsLoadingDocument(true);
      setLoadError(undefined);
      setReportedPageCount(0);

      try {
        const docxFile =
          activeUploadedDocxFile?.file ??
          (url ? await loadDocxFile(url, displayFileName) : null);
        if (!docxFile) return;
        await ensureDocxWasmConfigured();
        await importDocxFile(docxFile);

        if (isCurrent) {
          setIsLoadingDocument(false);
          setActivePage(1);
          viewportRef.current?.scrollTo({ top: 0, left: 0 });
        }
      } catch (error) {
        if (isCurrent) {
          setLoadError(formatDocxLoadError(error));
          setIsLoadingDocument(false);
        }
      }
    }

    importQueueRef.current = importQueueRef.current.then(load);

    return () => {
      isCurrent = false;
    };
  }, [
    activeUploadedDocxFile,
    displayFileName,
    importDocxFile,
    setActivePage,
    url,
  ]);

  const updateActivePageFromViewport = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !pageCount) return;

    const viewportRect = viewport.getBoundingClientRect();
    const viewportCenter = viewportRect.top + viewportRect.height / 2;
    let closestPage = 1;
    let closestDistance = Number.POSITIVE_INFINITY;

    viewport
      .querySelectorAll<HTMLElement>(
        '[data-docx-page-wrapper="true"][data-index]',
      )
      .forEach((page) => {
        const pageIndex = Number(page.dataset.index);
        if (!Number.isFinite(pageIndex)) return;

        const pageRect = page.getBoundingClientRect();
        const pageCenter = pageRect.top + pageRect.height / 2;
        const distance = Math.abs(pageCenter - viewportCenter);

        if (distance < closestDistance) {
          closestDistance = distance;
          closestPage = pageIndex + 1;
        }
      });

    activePageStore.setActivePage((currentPage) =>
      currentPage === closestPage ? currentPage : closestPage,
    );
  }, [activePageStore, pageCount]);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !pageCount) return;

    let frameId = 0;
    const handleScroll = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateActivePageFromViewport);
    };

    frameId = window.requestAnimationFrame(updateActivePageFromViewport);
    viewport.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.cancelAnimationFrame(frameId);
      viewport.removeEventListener("scroll", handleScroll);
    };
  }, [pageCount, updateActivePageFromViewport]);

  const scrollToPage = React.useCallback(
    (pageNumber: number) => {
      const viewport = viewportRef.current;
      const targetPageIndex = pageNumber - 1;
      const page = viewport?.querySelector<HTMLElement>(
        `[data-docx-page-wrapper="true"][data-index="${targetPageIndex}"]`,
      );

      setActivePage(pageNumber);

      if (!viewport) return;

      if (!page) {
        const pageStridePx =
          (pageLayout.pageHeightPx + pageLayout.viewportDefaults.pageGapPx) *
          (zoomScale / 100);

        viewport.scrollTo({
          top: Math.max(0, targetPageIndex * pageStridePx - 24),
          behavior: "auto",
        });
        return;
      }

      viewport.scrollTo({
        top:
          page.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top +
          viewport.scrollTop -
          24,
        behavior: "auto",
      });
    },
    [
      pageLayout.pageHeightPx,
      pageLayout.viewportDefaults.pageGapPx,
      setActivePage,
      zoomScale,
    ],
  );

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setZoomScale(resolvedDefaultZoomScale);
    setActivePage(1);
    setReportedPageCount(0);
    setUploadedDocxFile({
      file,
      identity: `${file.name}-${file.size}-${file.lastModified}`,
      sourceUrl: url,
    });
  }

  return (
    <div
      data-slot="docx-viewer"
      className={cn(
        "flex h-[640px] min-h-0 flex-col overflow-hidden bg-[var(--background-primary)]",
        className,
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={handleUpload}
      />
      {showToolbar ? (
        <DocxToolbar
          activePageStore={activePageStore}
          controlsDisabled={controlsDisabled}
          isDark={effectiveIsDark}
          isPreparingDownload={isPreparingDownload}
          leadingToolbarActions={leadingToolbarActions}
          onDownload={handleDownload}
          onIsDarkChange={setNightRenderEnabled}
          onPageChange={scrollToPage}
          onShowCommentsChange={setShowComments}
          onShowTrackedChangesChange={setShowTrackedChanges}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          onUploadClick={() => fileInputRef.current?.click()}
          pageCount={pageCount}
          setZoomScale={setZoomScale}
          showComments={showComments}
          showDownloadButton={showDownload}
          showNightRenderToggle={shouldRenderNightMode}
          showTrackedChanges={showTrackedChanges}
          showUploadButton={showUpload}
          toolbarActions={toolbarActions}
          zoomScale={zoomScale}
        />
      ) : null}
      <div
        ref={viewerShellRef}
        className="relative flex min-h-0 flex-1 overflow-hidden bg-[var(--background-primary)]"
      >
        <DocumentViewerThumbnailSidebar
          inline={sidebarInline}
          open={thumbnailSidebarVisible}
        >
          <DocxThumbnailSidebarContent
            activePageStore={activePageStore}
            displayFileName={displayFileName}
            editor={editor}
            isLoadingDocument={isLoadingDocument}
            onSelectPage={scrollToPage}
            pageCount={pageCount}
            reportedPageCount={reportedPageCount}
            sidebarOpen={thumbnailSidebarVisible}
          />
        </DocumentViewerThumbnailSidebar>
        <AppScrollArea
          className="min-h-0 flex-1"
          rootStyle={{ backgroundColor: viewerBackgroundColor }}
          viewportClassName="px-4 py-6"
          viewportProps={{
            "aria-label": "DOCX 文档",
            onMouseDown: (event) => {
              if (isInteractiveViewerTarget(event.target)) return;
              event.currentTarget.focus({ preventScroll: true });
            },
            tabIndex: 0,
          }}
          viewportRef={setViewportRef}
        >
          {!url && !activeUploadedDocxFile ? (
            <div className="grid h-full min-h-96 place-items-center p-6 text-center">
              <div className="max-w-md rounded-lg border bg-[var(--background-primary)] p-4 text-sm shadow-xs">
                <div className="font-medium">
                  {VIEWER_COPY.uploadDocxToPreview}
                </div>
                <div className="mt-1 text-[var(--foreground-secondary)]">
                  {VIEWER_COPY.uploadDocxHelp}
                </div>
                <div className="mt-1 text-[var(--foreground-secondary)]">
                  旧版 <code>.doc</code> 支持有限，建议转换为 DOCX
                  以获得更准确的排版。
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <UploadLine aria-hidden="true" className="size-4" />
                  {VIEWER_COPY.uploadDocx}
                </Button>
              </div>
            </div>
          ) : loadError ? (
            <div className="grid h-full min-h-96 place-items-center p-6 text-center">
              <div className="max-w-md rounded-lg border bg-[var(--background-primary)] p-4 text-sm text-[var(--danger)] shadow-xs">
                <div className="font-medium">
                  {VIEWER_COPY.unableToLoadDocx}
                </div>
                <div className="mt-1 text-[var(--foreground-secondary)]">
                  {loadError}
                </div>
              </div>
            </div>
          ) : isLoadingDocument ? (
            loadingState
          ) : (
            <div className="flex min-h-full w-max min-w-full justify-center">
              <div
                className={cn(
                  "origin-top",
                  effectiveIsDark && "docx-night-reader-shell",
                )}
                style={{ zoom: zoomScale / 100 }}
              >
                <DocxEditorViewer
                  editor={editor}
                  mode="read-only"
                  showTrackedChanges={showTrackedChanges}
                  renderTrackedChangeCard={renderTrackedChangeCard}
                  showComments={showComments}
                  renderCommentCard={renderCommentCard}
                  loadingState={loadingState}
                  pageBackgroundColor={
                    effectiveIsDark ? "var(--background-primary)" : undefined
                  }
                  pageGapBackgroundColor={viewerBackgroundColor}
                  pageVirtualization={pageVirtualization}
                  deferInitialPaginationPaint={false}
                  onPageCountChange={handlePageCountChange}
                />
              </div>
            </div>
          )}
        </AppScrollArea>
      </div>
    </div>
  );
}
