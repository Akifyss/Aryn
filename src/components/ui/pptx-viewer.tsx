"use client";

import * as React from "react";
import {
  PptxViewer,
  RECOMMENDED_ZIP_LIMITS,
  type FitMode,
  type SearchHighlightHandle,
  type TextSearchResult,
} from "@aiden0z/pptx-renderer";
import {
  DownloadLine,
  Fullscreen2Line,
  More2Line,
  SearchLine,
  UploadLine,
} from "@mingcute/react";
import { Spinner } from "@heroui/react";

import { AppScrollArea } from "@/components/app-scroll-area";
import { AppTooltip } from "@/components/app-tooltip";
import { cn } from "@/components/ui/viewer-utils";
import {
  isPptxFileName,
  PPTX_FILE_ACCEPT,
  PPTX_MIME_TYPE,
} from "@/lib/pptx-file-types";
import {
  ViewerControlButton as Button,
  ViewerMenuContent as DropdownMenuContent,
  ViewerMenuItem as DropdownMenuItem,
  ViewerMenuRoot as DropdownMenu,
  ViewerMenuSeparator as DropdownMenuSeparator,
  ViewerMenuTrigger as DropdownMenuTrigger,
  ViewerPopoverContent as PopoverContent,
  ViewerPopoverRoot as Popover,
  ViewerPopoverTrigger as PopoverTrigger,
  ViewerPageNumberControl,
  ViewerSearchPanel,
  ViewerToolbar,
  ViewerToolbarGroup,
  ViewerToolbarSeparator as Separator,
  ViewerZoomControls,
} from "@/components/ui/document-viewer-controls";
import { VIEWER_COPY } from "@/components/ui/viewer-copy";

const PPTX_LOADING_INDICATOR_DELAY_MS = 300;
const DEFAULT_FIT_MODE: FitMode = "contain";
const DEFAULT_ZOOM = 100;
const ZOOM_OPTIONS = [10, 25, 50, 75, 100, 125, 150, 175, 200, 400] as const;
type UploadedPresentation = {
  buffer: ArrayBuffer;
  fileName: string;
  sourceUrl: string | undefined;
};

function formatPresentationName(fileName: string | undefined, url: string) {
  if (fileName?.trim()) return fileName;

  const pathname = url.split(/[?#]/, 1)[0] ?? "";
  const rawName = pathname.split("/").pop() ?? "presentation.pptx";

  try {
    const decodedName = decodeURIComponent(rawName);
    return isPptxFileName(decodedName) ? decodedName : "presentation.pptx";
  } catch {
    return isPptxFileName(rawName) ? rawName : "presentation.pptx";
  }
}

function ensurePptxExtension(fileName: string) {
  return isPptxFileName(fileName) ? fileName : `${fileName}.pptx`;
}

function downloadPresentationBuffer(buffer: ArrayBuffer, fileName: string) {
  const url = URL.createObjectURL(
    new Blob([buffer], {
      type: PPTX_MIME_TYPE,
    }),
  );
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = ensurePptxExtension(fileName);
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function loadPresentationBuffer(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`PPTX 文件加载失败（${response.status}）。`);
  }

  return response.arrayBuffer();
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function formatPptxLoadError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "无法渲染此 PPTX 文件。";
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

  return isLoading && showSpinner;
}

function ToolbarTooltip({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
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
    <div className="grid h-full min-h-96 w-full place-items-center bg-transparent">
      {showSpinner ? <Spinner className="size-4" /> : null}
    </div>
  );
}

function PptxFileActionsMenu({
  downloadDisabled,
  onDownload,
  onUploadClick,
  showDownloadButton,
  showUploadButton,
}: {
  downloadDisabled: boolean;
  onDownload: () => void;
  onUploadClick: () => void;
  showDownloadButton: boolean;
  showUploadButton: boolean;
}) {
  if (!showDownloadButton && !showUploadButton) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="打开 PPTX 操作菜单"
        >
          <More2Line aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {showDownloadButton ? (
          <DropdownMenuItem disabled={downloadDisabled} onClick={onDownload}>
            <DownloadLine aria-hidden="true" className="size-4" />
            下载
          </DropdownMenuItem>
        ) : null}
        {showDownloadButton && showUploadButton ? <DropdownMenuSeparator /> : null}
        {showUploadButton ? (
          <DropdownMenuItem onClick={onUploadClick}>
            <UploadLine aria-hidden="true" className="size-4" />
            上传
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PptxSearchPopover({
  activeSearchIndex,
  controlsDisabled,
  onNextResult,
  onPreviousResult,
  onSearchDraftChange,
  searchDraft,
  searchResultCount,
}: {
  activeSearchIndex: number;
  controlsDisabled: boolean;
  onNextResult: () => void;
  onPreviousResult: () => void;
  onSearchDraftChange: (value: string) => void;
  searchDraft: string;
  searchResultCount: number;
}) {
  const hasQuery = Boolean(searchDraft.trim());
  const hasResults = searchResultCount > 0;
  const searchLabel = "搜索 PPTX 文本";
  const resultLabel = !hasQuery
    ? VIEWER_COPY.noSearch
    : hasResults
      ? `${activeSearchIndex + 1} / ${searchResultCount}`
      : VIEWER_COPY.noResults;

  return (
    <Popover>
      <ToolbarTooltip label={searchLabel}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={searchLabel}
            disabled={controlsDisabled}
          >
            <SearchLine aria-hidden="true" className="size-4" />
          </Button>
        </PopoverTrigger>
      </ToolbarTooltip>
      <PopoverContent align="end" className="viewer-search-popover">
        <ViewerSearchPanel
          canClear={hasQuery}
          clearLabel={VIEWER_COPY.clear}
          hasResults={hasResults}
          inputLabel={searchLabel}
          nextResultLabel={VIEWER_COPY.nextResult}
          onClear={() => onSearchDraftChange("")}
          onNextResult={onNextResult}
          onPreviousResult={onPreviousResult}
          onValueChange={onSearchDraftChange}
          placeholder="搜索幻灯片文本"
          previousResultLabel={VIEWER_COPY.previousResult}
          resultLabel={
            hasResults ? (
              <>
                <span className="viewer-search-result-current">
                  {activeSearchIndex + 1}
                </span>
                {` / ${searchResultCount}`}
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

function PptxToolbar({
  activeSearchIndex,
  activeSlideIndex,
  controlsDisabled,
  fitMode,
  leadingToolbarActions,
  onDownload,
  onFitModeToggle,
  onGoToSlide,
  onNextSearchResult,
  onPreviousSearchResult,
  onSearchDraftChange,
  onSetZoom,
  onUploadClick,
  searchDraft,
  searchResultCount,
  showDownloadButton,
  showUploadButton,
  slideCount,
  toolbarActions,
  zoomPercent,
}: {
  activeSearchIndex: number;
  activeSlideIndex: number;
  controlsDisabled: boolean;
  fitMode: FitMode;
  leadingToolbarActions?: React.ReactNode;
  onDownload: () => void;
  onFitModeToggle: () => void;
  onGoToSlide: (slideIndex: number) => void;
  onNextSearchResult: () => void;
  onPreviousSearchResult: () => void;
  onSearchDraftChange: (value: string) => void;
  onSetZoom: (zoomPercent: number) => void;
  onUploadClick: () => void;
  searchDraft: string;
  searchResultCount: number;
  showDownloadButton: boolean;
  showUploadButton: boolean;
  slideCount: number;
  toolbarActions?: React.ReactNode;
  zoomPercent: number;
}) {
  return (
    <ViewerToolbar>
      <ViewerToolbarGroup>
        {leadingToolbarActions ? (
          <>
            {leadingToolbarActions}
            <Separator />
          </>
        ) : null}
        <ViewerPageNumberControl
          activePage={activeSlideIndex + 1}
          controlsDisabled={controlsDisabled}
          currentPageEditLabel={VIEWER_COPY.currentPageEdit}
          onPageChange={(pageNumber) => onGoToSlide(pageNumber - 1)}
          pageCount={slideCount}
          pageNumberLabel={VIEWER_COPY.pageNumber}
        />
      </ViewerToolbarGroup>
      <ViewerToolbarGroup align="end">
        <ViewerZoomControls
          ariaLabel={VIEWER_COPY.zoomLevel}
          disabled={controlsDisabled}
          onValueChange={onSetZoom}
          options={ZOOM_OPTIONS}
          value={zoomPercent}
          zoomInLabel={VIEWER_COPY.zoomIn}
          zoomOutLabel={VIEWER_COPY.zoomOut}
        />
        <ToolbarTooltip label={fitMode === "contain" ? "原始尺寸" : "适应宽度"}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={fitMode === "contain" ? "原始尺寸" : "适应宽度"}
            disabled={controlsDisabled}
            onClick={onFitModeToggle}
          >
            <Fullscreen2Line aria-hidden="true" className="size-4" />
          </Button>
        </ToolbarTooltip>
        <Separator />
        <PptxSearchPopover
          activeSearchIndex={activeSearchIndex}
          controlsDisabled={controlsDisabled}
          onNextResult={onNextSearchResult}
          onPreviousResult={onPreviousSearchResult}
          onSearchDraftChange={onSearchDraftChange}
          searchDraft={searchDraft}
          searchResultCount={searchResultCount}
        />
        {showDownloadButton || showUploadButton ? (
          <>
            <Separator />
            <PptxFileActionsMenu
              downloadDisabled={controlsDisabled}
              onDownload={onDownload}
              onUploadClick={onUploadClick}
              showDownloadButton={showDownloadButton}
              showUploadButton={showUploadButton}
            />
          </>
        ) : null}
        {toolbarActions ? (
          <>
            <Separator />
            {toolbarActions}
          </>
        ) : null}
      </ViewerToolbarGroup>
    </ViewerToolbar>
  );
}

function PptxEmptyState({
  onUploadClick,
  showUpload,
}: {
  onUploadClick: () => void;
  showUpload: boolean;
}) {
  return (
    <div className="grid h-full min-h-96 place-items-center p-6 text-center">
      <div className="max-w-md rounded-lg border bg-[var(--background-primary)] p-4 text-sm shadow-xs">
        <p className="font-medium">上传 PPTX 以预览</p>
        <p className="mt-1 text-[var(--foreground-secondary)]">
          支持 PPTX、PPTM、PPSX、PPSM、POTX、POTM 这类 OpenXML 演示文稿。
        </p>
        {showUpload ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={onUploadClick}
          >
            <UploadLine aria-hidden="true" className="size-4" />
            上传 PPTX
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PptxErrorState({
  error,
}: {
  error: string;
}) {
  return (
    <div className="grid h-full min-h-96 place-items-center p-6 text-center">
      <div className="max-w-md rounded-lg border bg-[var(--background-primary)] p-4 text-sm shadow-xs">
        <p className="font-medium text-[var(--danger)]">无法渲染 PPTX 文件</p>
        <p className="mt-1 text-[var(--foreground-secondary)]">{error}</p>
      </div>
    </div>
  );
}

export function PptxViewerPreview({
  className,
  fileName,
  leadingToolbarActions,
  showDownload = true,
  showToolbar = true,
  showUpload = true,
  src,
  toolbarActions,
}: {
  className?: string;
  fileName?: string;
  leadingToolbarActions?: React.ReactNode;
  showDownload?: boolean;
  showToolbar?: boolean;
  showUpload?: boolean;
  src?: string;
  toolbarActions?: React.ReactNode;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const viewerRef = React.useRef<PptxViewer | null>(null);
  const searchHighlightRef = React.useRef<SearchHighlightHandle | null>(null);
  const searchRequestIdRef = React.useRef(0);
  const slideErrorIndexesRef = React.useRef(new Set<number>());
  const [containerElement, setContainerElement] =
    React.useState<HTMLDivElement | null>(null);
  const [viewportElement, setViewportElement] =
    React.useState<HTMLDivElement | null>(null);
  const [uploadedPresentation, setUploadedPresentation] =
    React.useState<UploadedPresentation | null>(null);
  const [loadedBuffer, setLoadedBuffer] = React.useState<ArrayBuffer | null>(null);
  const [loadError, setLoadError] = React.useState<string>();
  const [isLoadingDocument, setIsLoadingDocument] = React.useState(Boolean(src));
  const [isRendering, setIsRendering] = React.useState(false);
  const [slideCount, setSlideCount] = React.useState(0);
  const [activeSlideIndex, setActiveSlideIndex] = React.useState(0);
  const [slideErrorCount, setSlideErrorCount] = React.useState(0);
  const [fitMode, setFitMode] = React.useState<FitMode>(DEFAULT_FIT_MODE);
  const [zoomPercent, setZoomPercent] = React.useState(DEFAULT_ZOOM);
  const [searchDraft, setSearchDraft] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<TextSearchResult[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = React.useState(0);
  const sourceFileName = React.useMemo(
    () => (src ? formatPresentationName(fileName, src) : (fileName ?? "presentation.pptx")),
    [fileName, src],
  );
  const activeUploadedPresentation =
    uploadedPresentation?.sourceUrl === src ? uploadedPresentation : null;
  const displayFileName = activeUploadedPresentation?.fileName ?? sourceFileName;
  const hasPresentationSource = Boolean(src || activeUploadedPresentation);
  const controlsDisabled =
    !hasPresentationSource ||
    isLoadingDocument ||
    Boolean(loadError) ||
    !viewerRef.current ||
    isRendering;
  const shouldShowLoadingSpinner = useDelayedLoadingIndicator(
    isLoadingDocument,
    PPTX_LOADING_INDICATOR_DELAY_MS,
  );

  const clearSearchHighlight = React.useCallback(() => {
    searchRequestIdRef.current += 1;
    searchHighlightRef.current?.dispose();
    searchHighlightRef.current = null;
    viewerRef.current?.clearSearchHighlights();
  }, []);

  const highlightSearchResult = React.useCallback(
    async (index: number, results: TextSearchResult[]) => {
      const viewer = viewerRef.current;
      const result = results[index];
      if (!viewer || !result) return;

      const requestId = searchRequestIdRef.current + 1;
      searchRequestIdRef.current = requestId;
      searchHighlightRef.current?.dispose();
      searchHighlightRef.current = null;
      viewer.clearSearchHighlights();

      try {
        const handle = await viewer.highlightSearchResult(result, {
          backgroundColor: "rgba(250, 204, 21, 0.18)",
          borderColor: "rgba(234, 179, 8, 0.95)",
          borderRadius: 4,
          borderWidth: 2,
          boxShadow: "0 0 0 2px rgba(15, 23, 42, 0.2)",
          padding: 3,
          scrollIntoView: { behavior: "smooth", block: "center" },
        });

        if (searchRequestIdRef.current !== requestId) {
          handle?.dispose();
          return;
        }

        searchHighlightRef.current = handle;
      } catch (error) {
        if (!isAbortError(error)) {
          console.warn("Failed to highlight PPTX search result.", error);
        }
      }
    },
    [],
  );

  const runSearch = React.useCallback(
    (query: string) => {
      const viewer = viewerRef.current;

      clearSearchHighlight();
      setActiveSearchIndex(0);

      if (!viewer || !query.trim()) {
        setSearchResults((currentResults) =>
          currentResults.length ? [] : currentResults,
        );
        return;
      }

      try {
        const results = viewer.searchText(query.trim());

        setSearchResults(results);
        if (results.length) {
          void highlightSearchResult(0, results);
        }
      } catch (error) {
        console.warn("Failed to search PPTX text.", error);
        setSearchResults([]);
      }
    },
    [clearSearchHighlight, highlightSearchResult],
  );

  React.useEffect(() => {
    if (!searchDraft.trim() || !viewerRef.current || isLoadingDocument || loadError) {
      runSearch("");
      return;
    }

    const timeoutId = window.setTimeout(() => {
      runSearch(searchDraft);
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [isLoadingDocument, loadError, runSearch, searchDraft]);

  React.useEffect(() => {
    setUploadedPresentation(null);
  }, [src]);

  React.useEffect(() => {
    if (!containerElement || !viewportElement) return;

    const renderContainer = containerElement;
    const scrollContainer = viewportElement;
    let isCurrent = true;
    const abortController = new AbortController();
    let viewer: PptxViewer | null = null;

    setIsLoadingDocument(Boolean(src || activeUploadedPresentation));
    setLoadError(undefined);
    setSlideCount(0);
    setActiveSlideIndex(0);
    slideErrorIndexesRef.current = new Set();
    setSlideErrorCount(0);
    setFitMode(DEFAULT_FIT_MODE);
    setZoomPercent(DEFAULT_ZOOM);
    setSearchDraft("");
    setSearchResults([]);
    setActiveSearchIndex(0);
    setLoadedBuffer(activeUploadedPresentation?.buffer ?? null);
    clearSearchHighlight();
    renderContainer.innerHTML = "";

    if (!src && !activeUploadedPresentation) {
      setIsLoadingDocument(false);
      return () => {
        isCurrent = false;
        abortController.abort();
      };
    }

    async function loadPresentation() {
      try {
        const buffer = activeUploadedPresentation?.buffer
          ?? (src ? await loadPresentationBuffer(src, abortController.signal) : null);

        if (!buffer || !isCurrent) return;

        setLoadedBuffer(buffer);

        viewer = new PptxViewer(renderContainer, {
          fitMode: DEFAULT_FIT_MODE,
          lazyMedia: true,
          lazySlides: true,
          onRenderComplete: () => {
            if (isCurrent) setIsRendering(false);
          },
          onRenderStart: () => {
            if (isCurrent) setIsRendering(true);
          },
          onSlideChange: (index) => {
            if (isCurrent) setActiveSlideIndex(index);
          },
          onSlideError: (index, error) => {
            if (!isCurrent) return;
            console.warn("Failed to render PPTX slide.", error);
            const errorIndexes = slideErrorIndexesRef.current;
            if (errorIndexes.has(index)) return;

            errorIndexes.add(index);
            setSlideErrorCount(errorIndexes.size);
          },
          onSlideRendered: (index) => {
            if (!isCurrent || !slideErrorIndexesRef.current.delete(index)) return;
            setSlideErrorCount(slideErrorIndexesRef.current.size);
          },
          pdfjs: false,
          scrollContainer,
          zipLimits: RECOMMENDED_ZIP_LIMITS,
          zoomPercent: DEFAULT_ZOOM,
        });
        viewerRef.current = viewer;

        await viewer.open(buffer, {
          lazyMedia: true,
          lazySlides: true,
          listOptions: {
            batchSize: 4,
            initialSlides: 4,
            overscanViewport: 1.5,
            windowed: true,
          },
          renderMode: "list",
          signal: abortController.signal,
        });

        if (!isCurrent) return;

        setSlideCount(viewer.slideCount);
        setActiveSlideIndex(viewer.currentSlideIndex);
        setFitMode(viewer.fitMode);
        setZoomPercent(Math.round(viewer.zoomPercent));
        setIsLoadingDocument(false);
        setIsRendering(false);
      } catch (error) {
        if (!isCurrent || isAbortError(error)) return;

        viewer?.destroy();
        if (viewerRef.current === viewer) {
          viewerRef.current = null;
        }
        viewer = null;
        setLoadError(formatPptxLoadError(error));
        setIsLoadingDocument(false);
        setIsRendering(false);
      }
    }

    void loadPresentation();

    return () => {
      isCurrent = false;
      abortController.abort();
      clearSearchHighlight();
      if (viewerRef.current === viewer) {
        viewerRef.current = null;
      }
      viewer?.destroy();
      renderContainer.innerHTML = "";
    };
  }, [
    clearSearchHighlight,
    containerElement,
    src,
    activeUploadedPresentation,
    viewportElement,
  ]);

  const goToSlide = React.useCallback((slideIndex: number) => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    void viewer.goToSlide(slideIndex, { behavior: "smooth", block: "center" })
      .catch((error) => console.warn("Failed to navigate PPTX slide.", error));
  }, []);

  const setViewerZoom = React.useCallback((nextZoomPercent: number) => {
    const viewer = viewerRef.current;
    const normalizedZoom = Math.max(10, Math.min(400, Math.round(nextZoomPercent)));

    setZoomPercent(normalizedZoom);
    if (!viewer) return;

    void viewer.setZoom(normalizedZoom)
      .then(() => setZoomPercent(Math.round(viewer.zoomPercent)))
      .catch((error) => console.warn("Failed to update PPTX zoom.", error));
  }, []);

  const toggleFitMode = React.useCallback(() => {
    const viewer = viewerRef.current;
    const nextFitMode: FitMode = fitMode === "contain" ? "none" : "contain";

    setFitMode(nextFitMode);
    if (!viewer) return;

    void viewer.setFitMode(nextFitMode)
      .then(() => setFitMode(viewer.fitMode))
      .catch((error) => console.warn("Failed to update PPTX fit mode.", error));
  }, [fitMode]);

  const goToSearchResult = React.useCallback(
    (direction: 1 | -1) => {
      if (!searchResults.length) return;

      setActiveSearchIndex((currentIndex) => {
        const nextIndex =
          (currentIndex + direction + searchResults.length) % searchResults.length;

        void highlightSearchResult(nextIndex, searchResults);
        return nextIndex;
      });
    },
    [highlightSearchResult, searchResults],
  );

  const handleDownload = React.useCallback(() => {
    const buffer = activeUploadedPresentation?.buffer ?? loadedBuffer;

    if (!buffer) return;

    downloadPresentationBuffer(buffer, displayFileName);
  }, [
    displayFileName,
    loadedBuffer,
    activeUploadedPresentation?.buffer,
  ]);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setLoadError(undefined);
    setUploadedPresentation({
      buffer: await file.arrayBuffer(),
      fileName: file.name,
      sourceUrl: src,
    });
  }

  return (
    <div
      data-slot="pptx-viewer"
      className={cn(
        "flex h-[640px] min-h-0 flex-col overflow-hidden bg-[var(--background-primary)]",
        className,
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={PPTX_FILE_ACCEPT}
        className="hidden"
        onChange={handleUpload}
      />
      {showToolbar ? (
        <PptxToolbar
          activeSearchIndex={activeSearchIndex}
          activeSlideIndex={activeSlideIndex}
          controlsDisabled={controlsDisabled}
          fitMode={fitMode}
          leadingToolbarActions={leadingToolbarActions}
          onDownload={handleDownload}
          onFitModeToggle={toggleFitMode}
          onGoToSlide={goToSlide}
          onNextSearchResult={() => goToSearchResult(1)}
          onPreviousSearchResult={() => goToSearchResult(-1)}
          onSearchDraftChange={setSearchDraft}
          onSetZoom={setViewerZoom}
          onUploadClick={() => fileInputRef.current?.click()}
          searchDraft={searchDraft}
          searchResultCount={searchResults.length}
          showDownloadButton={showDownload}
          showUploadButton={showUpload}
          slideCount={slideCount}
          toolbarActions={toolbarActions}
          zoomPercent={zoomPercent}
        />
      ) : null}
      {slideErrorCount ? (
        <div className="viewer-toolbar-subbar text-xs text-[var(--foreground-secondary)]">
          有 {slideErrorCount} 张幻灯片的部分内容未能渲染，已保留其余内容。
        </div>
      ) : null}
      <AppScrollArea
        className="min-h-0 flex-1 bg-[var(--background-primary)]"
        contentClassName="min-h-full"
        viewportClassName="px-4 py-6"
        viewportProps={{
          "aria-label": "PPTX 演示文稿",
          tabIndex: 0,
        }}
        viewportRef={setViewportElement}
        withHorizontalScrollbar
      >
        <div className="relative min-h-full w-full">
          <div
            ref={setContainerElement}
            className={cn(
              "mx-auto min-h-full w-full",
              (!hasPresentationSource || loadError || isLoadingDocument) && "opacity-0",
            )}
          />
          {!hasPresentationSource ? (
            <div className="absolute inset-0">
              <PptxEmptyState
                onUploadClick={() => fileInputRef.current?.click()}
                showUpload={showUpload}
              />
            </div>
          ) : loadError ? (
            <div className="absolute inset-0">
              <PptxErrorState error={loadError} />
            </div>
          ) : isLoadingDocument ? (
            <div className="absolute inset-0">
              <ViewerLoadingSurface showSpinner={shouldShowLoadingSpinner} />
            </div>
          ) : null}
        </div>
      </AppScrollArea>
    </div>
  );
}
