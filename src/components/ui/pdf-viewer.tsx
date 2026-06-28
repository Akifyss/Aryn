import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area'
import { LeftLine, RightLine, ZoomInLine, ZoomOutLine } from '@mingcute/react'
import { AppTooltipButton } from '@/components/app-tooltip'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type PDFViewerProps = {
  className?: string
  fileName?: string
  leadingToolbarActions?: ReactNode
  showToolbar?: boolean
  showUpload?: boolean
  src: string
  toolbarActions?: ReactNode
}

type PDFViewerState =
  | { status: 'error' }
  | { status: 'loading' }
  | { pageCount: number; status: 'ready' }

type RenderPdfPageOptions = {
  maxWidth?: number
  pageNumber?: number
  pixelRatio?: number
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const PDF_CANVAS_BACKGROUND = 'rgb(255, 255, 255)'

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function formatZoom(zoom: number) {
  return `${Math.round(zoom * 100)}%`
}

function ScrollArea({
  children,
  className,
  viewportClassName,
  viewportRef,
}: {
  children: ReactNode
  className?: string
  viewportClassName?: string
  viewportRef?: Ref<HTMLDivElement>
}) {
  return (
    <BaseScrollArea.Root className={cn('relative min-h-0 overflow-hidden', className)}>
      <BaseScrollArea.Viewport
        ref={viewportRef}
        className={cn('size-full overscroll-contain', viewportClassName)}
      >
        {children}
      </BaseScrollArea.Viewport>
      <BaseScrollArea.Scrollbar
        className='flex h-full w-2.5 touch-none select-none flex-col p-0.5'
        orientation='vertical'
      >
        <BaseScrollArea.Thumb className='relative flex-1 rounded-full bg-[var(--scrollbar)] hover:bg-[var(--scrollbar-hover)]' />
      </BaseScrollArea.Scrollbar>
      <BaseScrollArea.Scrollbar
        className='flex h-2.5 touch-none select-none p-0.5'
        orientation='horizontal'
      >
        <BaseScrollArea.Thumb className='relative flex-1 rounded-full bg-[var(--scrollbar)] hover:bg-[var(--scrollbar-hover)]' />
      </BaseScrollArea.Scrollbar>
    </BaseScrollArea.Root>
  )
}

async function renderPdfPageToCanvas(
  src: string,
  options: RenderPdfPageOptions = {},
) {
  const loadingTask = pdfjs.getDocument({ url: src })

  try {
    const pdfDocument = await loadingTask.promise
    const pageNumber = clamp(options.pageNumber ?? 1, 1, pdfDocument.numPages)
    const page = await pdfDocument.getPage(pageNumber)
    const baseViewport = page.getViewport({ scale: 1 })
    const maxWidth = options.maxWidth ?? baseViewport.width
    const scale = Math.max(0.1, maxWidth / baseViewport.width)
    const viewport = page.getViewport({ scale })
    const pixelRatio = options.pixelRatio ?? window.devicePixelRatio ?? 1
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')

    if (!context) {
      throw new Error('Canvas is not available.')
    }

    canvas.width = Math.ceil(viewport.width * pixelRatio)
    canvas.height = Math.ceil(viewport.height * pixelRatio)
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.fillStyle = PDF_CANVAS_BACKGROUND
    context.fillRect(0, 0, viewport.width, viewport.height)

    await page.render({
      canvas,
      canvasContext: context,
      viewport,
    }).promise

    return { canvas, pageCount: pdfDocument.numPages }
  } finally {
    await loadingTask.destroy()
  }
}

export async function renderPdfPageToDataUrl(
  src: string,
  options: RenderPdfPageOptions = {},
) {
  const { canvas } = await renderPdfPageToCanvas(src, options)
  return canvas.toDataURL('image/png')
}

export async function renderPdfPageToDataUrlWithPageCount(
  src: string,
  options: RenderPdfPageOptions = {},
) {
  const { canvas, pageCount } = await renderPdfPageToCanvas(src, options)

  return {
    pageCount,
    url: canvas.toDataURL('image/png'),
  }
}

export function PDFViewer({
  className,
  fileName,
  leadingToolbarActions,
  showToolbar = false,
  showUpload: _showUpload,
  src,
  toolbarActions,
}: PDFViewerProps) {
  const canvasHostRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const renderTokenRef = useRef(0)
  const [viewerState, setViewerState] = useState<PDFViewerState>({ status: 'loading' })
  const [pageNumber, setPageNumber] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [fitWidth, setFitWidth] = useState(true)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [isRendering, setIsRendering] = useState(false)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver === 'undefined') {
      setViewportWidth(viewport?.clientWidth ?? 0)
      return
    }

    const update = () => setViewportWidth(viewport.clientWidth)
    const observer = new ResizeObserver(update)

    update()
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setViewerState({ status: 'loading' })
    setPageNumber(1)
    setZoom(1)
    setFitWidth(true)
  }, [src])

  useEffect(() => {
    const host = canvasHostRef.current
    if (!host || (fitWidth && viewportWidth <= 0)) {
      return
    }

    const hostElement: HTMLDivElement = host
    const renderToken = renderTokenRef.current + 1
    renderTokenRef.current = renderToken
    const loadingTask = pdfjs.getDocument({ url: src })
    let isCurrent = true

    setIsRendering(true)

    async function renderCurrentPage() {
      try {
        const pdfDocument = await loadingTask.promise
        const resolvedPageNumber = clamp(pageNumber, 1, pdfDocument.numPages)
        const page = await pdfDocument.getPage(resolvedPageNumber)
        const baseViewport = page.getViewport({ scale: 1 })
        const fitScale = fitWidth
          ? Math.max(0.1, (viewportWidth - 48) / baseViewport.width)
          : 1
        const renderScale = clamp(fitScale * zoom, 0.1, 4)
        const viewport = page.getViewport({ scale: renderScale })
        const pixelRatio = window.devicePixelRatio ?? 1
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')

        if (!context) {
          throw new Error('Canvas is not available.')
        }

        canvas.width = Math.ceil(viewport.width * pixelRatio)
        canvas.height = Math.ceil(viewport.height * pixelRatio)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        canvas.className = 'max-w-none rounded-sm bg-white shadow-sm'
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
        context.fillStyle = PDF_CANVAS_BACKGROUND
        context.fillRect(0, 0, viewport.width, viewport.height)

        await page.render({
          canvas,
          canvasContext: context,
          viewport,
        }).promise

        if (!isCurrent || renderTokenRef.current !== renderToken) {
          return
        }

        hostElement.replaceChildren(canvas)
        setViewerState({ pageCount: pdfDocument.numPages, status: 'ready' })
        if (resolvedPageNumber !== pageNumber) {
          setPageNumber(resolvedPageNumber)
        }
      } catch {
        if (!isCurrent || renderTokenRef.current !== renderToken) {
          return
        }

        hostElement.replaceChildren()
        setViewerState({ status: 'error' })
      } finally {
        if (isCurrent && renderTokenRef.current === renderToken) {
          setIsRendering(false)
        }
      }
    }

    void renderCurrentPage()

    return () => {
      isCurrent = false
      void loadingTask.destroy()
    }
  }, [fitWidth, pageNumber, src, viewportWidth, zoom])

  const pageCount = viewerState.status === 'ready' ? viewerState.pageCount : 0
  const canGoPrevious = pageCount > 0 && pageNumber > 1
  const canGoNext = pageCount > 0 && pageNumber < pageCount
  const hasToolbar = showToolbar || Boolean(leadingToolbarActions) || Boolean(toolbarActions)
  const toolbarLabel = useMemo(() => {
    if (viewerState.status === 'ready') {
      return `${pageNumber} / ${viewerState.pageCount}`
    }

    return viewerState.status === 'loading' ? '加载中' : '预览失败'
  }, [pageNumber, viewerState])

  return (
    <div className={cn('flex min-h-0 flex-col bg-[var(--background-primary)] text-[var(--foreground-primary)]', className)}>
      {hasToolbar ? (
        <div className='viewer-toolbar'>
          {leadingToolbarActions ? <div className='viewer-toolbar-leading'>{leadingToolbarActions}</div> : null}
          <div className='viewer-toolbar-title'>{fileName ?? 'PDF'}</div>
          <div className='viewer-toolbar-control-group'>
            <AppTooltipButton
              type='button'
              aria-label='上一页'
              disabled={!canGoPrevious}
              className='viewer-toolbar-icon-button'
              tooltip='上一页'
              onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
            >
              <LeftLine aria-hidden='true' />
            </AppTooltipButton>
            <span className='viewer-toolbar-status'>{toolbarLabel}</span>
            <AppTooltipButton
              type='button'
              aria-label='下一页'
              disabled={!canGoNext}
              className='viewer-toolbar-icon-button'
              tooltip='下一页'
              onClick={() => setPageNumber((current) => Math.min(pageCount || current, current + 1))}
            >
              <RightLine aria-hidden='true' />
            </AppTooltipButton>
            <span className='viewer-toolbar-separator' />
            <AppTooltipButton
              type='button'
              aria-label='缩小'
              className='viewer-toolbar-icon-button'
              tooltip='缩小'
              onClick={() => {
                setFitWidth(false)
                setZoom((current) => clamp(current - 0.1, MIN_ZOOM, MAX_ZOOM))
              }}
            >
              <ZoomOutLine aria-hidden='true' />
            </AppTooltipButton>
            <AppTooltipButton
              type='button'
              aria-label={fitWidth ? '适应宽度' : '重置缩放'}
              className='viewer-toolbar-text-button'
              tooltip={fitWidth ? '适应宽度' : '重置缩放'}
              onClick={() => {
                setFitWidth(true)
                setZoom(1)
              }}
            >
              {fitWidth ? 'Fit' : formatZoom(zoom)}
            </AppTooltipButton>
            <AppTooltipButton
              type='button'
              aria-label='放大'
              className='viewer-toolbar-icon-button'
              tooltip='放大'
              onClick={() => {
                setFitWidth(false)
                setZoom((current) => clamp(current + 0.1, MIN_ZOOM, MAX_ZOOM))
              }}
            >
              <ZoomInLine aria-hidden='true' />
            </AppTooltipButton>
          </div>
          {toolbarActions ? <div className='viewer-toolbar-actions'>{toolbarActions}</div> : null}
        </div>
      ) : null}
      <ScrollArea
        className='min-h-0 flex-1 bg-[var(--background-primary)]'
        viewportClassName='bg-[var(--background-primary)]'
        viewportRef={viewportRef}
      >
        <div className='grid min-h-full place-items-center p-4'>
          {viewerState.status === 'loading' ? (
            <div className='text-sm text-[var(--foreground-secondary)]'>正在加载 PDF...</div>
          ) : null}
          {viewerState.status === 'error' ? (
            <div className='text-sm text-[var(--foreground-secondary)]'>无法预览此 PDF。</div>
          ) : null}
          <div
            ref={canvasHostRef}
            className={cn(
              'min-h-0 min-w-0',
              isRendering && viewerState.status === 'ready' && 'opacity-70',
            )}
          />
        </div>
      </ScrollArea>
    </div>
  )
}
