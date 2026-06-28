import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { renderAsync } from 'docx-preview'
import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area'

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

function ScrollArea({
  children,
  className,
  viewportClassName,
}: {
  children: ReactNode
  className?: string
  viewportClassName?: string
}) {
  return (
    <BaseScrollArea.Root className={cn('relative min-h-0 overflow-hidden', className)}>
      <BaseScrollArea.Viewport className={cn('size-full overscroll-contain', viewportClassName)}>
        {children}
      </BaseScrollArea.Viewport>
      <BaseScrollArea.Scrollbar className='flex h-full w-2.5 touch-none select-none flex-col p-0.5' orientation='vertical'>
        <BaseScrollArea.Thumb className='relative flex-1 rounded-full bg-[var(--scrollbar)] hover:bg-[var(--scrollbar-hover)]' />
      </BaseScrollArea.Scrollbar>
    </BaseScrollArea.Root>
  )
}

type DocxViewerPreviewProps = {
  className?: string
  fileName?: string
  isDark?: boolean
  leadingToolbarActions?: ReactNode
  onIsDarkChange?: Dispatch<SetStateAction<boolean>>
  showToolbar?: boolean
  showUpload?: boolean
  src: string
  toolbarActions?: ReactNode
}

type ViewerState = 'error' | 'loading' | 'ready'

function renderDocxOptions() {
  return {
    breakPages: true,
    className: 'docx',
    experimental: false,
    ignoreFonts: false,
    ignoreHeight: false,
    ignoreLastRenderedPageBreak: true,
    ignoreWidth: false,
    inWrapper: true,
    renderAltChunks: true,
    renderChanges: false,
    renderComments: false,
    renderEndnotes: true,
    renderFooters: true,
    renderFootnotes: true,
    renderHeaders: true,
    trimXmlDeclaration: true,
    useBase64URL: true,
  } as const
}

async function waitForEmbeddedImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll('img'))

  await Promise.all(images.map((image) => {
    if (image.complete) {
      return null
    }

    return new Promise<void>((resolve) => {
      image.addEventListener('load', () => resolve(), { once: true })
      image.addEventListener('error', () => resolve(), { once: true })
    })
  }))
}

function svgDataUrl(svg: SVGSVGElement) {
  const serializedSvg = new XMLSerializer().serializeToString(svg)

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serializedSvg)}`
}

export async function renderDocxPageToDataUrlWithPageCount(
  src: string,
  options: {
    maxHeight?: number
    maxWidth?: number
    pageNumber?: number
  } = {},
) {
  const response = await fetch(src)

  if (!response.ok) {
    throw new Error(`Unable to load document: ${response.status}`)
  }

  const documentBuffer = await response.arrayBuffer()
  const host = document.createElement('div')
  const styleContainer = document.createElement('div')
  const bodyContainer = document.createElement('div')

  host.style.position = 'fixed'
  host.style.left = '-100000px'
  host.style.top = '0'
  host.style.width = '1px'
  host.style.height = '1px'
  host.style.overflow = 'visible'
  host.style.pointerEvents = 'none'
  host.style.opacity = '0'
  host.setAttribute('aria-hidden', 'true')
  host.append(styleContainer, bodyContainer)
  document.body.append(host)

  try {
    await renderAsync(documentBuffer, bodyContainer, styleContainer, renderDocxOptions())
    await waitForEmbeddedImages(bodyContainer)

    const pages = Array.from(bodyContainer.querySelectorAll<HTMLElement>('.docx'))
    const requestedPageIndex = Math.max(0, Math.min((options.pageNumber ?? 1) - 1, Math.max(pages.length - 1, 0)))
    const page = pages[requestedPageIndex] ?? bodyContainer.firstElementChild

    if (!(page instanceof HTMLElement)) {
      return { pageCount: pages.length || 1, url: null }
    }

    page.querySelectorAll('script').forEach((script) => script.remove())

    const rect = page.getBoundingClientRect()
    const naturalWidth = Math.max(page.scrollWidth, Math.ceil(rect.width), 1)
    const naturalHeight = Math.max(page.scrollHeight, Math.ceil(rect.height), 1)
    const maxWidth = options.maxWidth ?? 320
    const maxHeight = options.maxHeight ?? 420
    const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1)
    const thumbnailWidth = Math.max(1, Math.ceil(naturalWidth * scale))
    const thumbnailHeight = Math.max(1, Math.ceil(naturalHeight * scale))
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
    const root = document.createElementNS('http://www.w3.org/1999/xhtml', 'div')
    const style = document.createElementNS('http://www.w3.org/1999/xhtml', 'style')
    const scaledPage = document.createElementNS('http://www.w3.org/1999/xhtml', 'div')
    const pageClone = page.cloneNode(true) as HTMLElement

    pageClone.style.margin = '0'
    pageClone.style.boxSizing = 'border-box'
    pageClone.style.transform = 'none'
    pageClone.style.transformOrigin = 'top left'
    style.textContent = [
      styleContainer.textContent ?? '',
      '.docx-wrapper{background:transparent!important;padding:0!important;}',
      '.docx{margin:0!important;box-shadow:none!important;}',
      '*{box-sizing:border-box;}',
    ].join('\n')
    scaledPage.style.width = `${naturalWidth}px`
    scaledPage.style.height = `${naturalHeight}px`
    scaledPage.style.transform = `scale(${scale})`
    scaledPage.style.transformOrigin = 'top left'
    scaledPage.append(pageClone)
    root.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
    root.style.width = `${thumbnailWidth}px`
    root.style.height = `${thumbnailHeight}px`
    root.style.overflow = 'hidden'
    root.style.background = '#ffffff'
    root.append(style, scaledPage)
    foreignObject.setAttribute('width', String(thumbnailWidth))
    foreignObject.setAttribute('height', String(thumbnailHeight))
    foreignObject.append(root)
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    svg.setAttribute('width', String(thumbnailWidth))
    svg.setAttribute('height', String(thumbnailHeight))
    svg.setAttribute('viewBox', `0 0 ${thumbnailWidth} ${thumbnailHeight}`)
    svg.append(foreignObject)

    return {
      pageCount: pages.length || 1,
      url: svgDataUrl(svg),
    }
  } finally {
    host.remove()
  }
}

export function DocxViewerPreview({
  className,
  fileName,
  isDark: _isDark,
  leadingToolbarActions,
  onIsDarkChange: _onIsDarkChange,
  showToolbar = false,
  showUpload: _showUpload,
  src,
  toolbarActions,
}: DocxViewerPreviewProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const styleRef = useRef<HTMLDivElement | null>(null)
  const [viewerState, setViewerState] = useState<ViewerState>('loading')

  useEffect(() => {
    const bodyElement = bodyRef.current
    const styleElement = styleRef.current

    if (!bodyElement || !styleElement) {
      return
    }

    const bodyContainer: HTMLElement = bodyElement
    const styleContainer: HTMLElement = styleElement
    const abortController = new AbortController()
    let isCurrent = true

    bodyContainer.replaceChildren()
    styleContainer.replaceChildren()
    setViewerState('loading')

    async function renderDocument() {
      try {
        const response = await fetch(src, { signal: abortController.signal })

        if (!response.ok) {
          throw new Error(`Unable to load document: ${response.status}`)
        }

        const documentBuffer = await response.arrayBuffer()

        if (!isCurrent) {
          return
        }

        await renderAsync(documentBuffer, bodyContainer, styleContainer, renderDocxOptions())

        if (isCurrent) {
          setViewerState('ready')
        }
      } catch (error) {
        if (!isCurrent || abortController.signal.aborted) {
          return
        }

        bodyContainer.replaceChildren()
        styleContainer.replaceChildren()
        setViewerState('error')
      }
    }

    void renderDocument()

    return () => {
      isCurrent = false
      abortController.abort()
    }
  }, [src])

  const hasToolbar = showToolbar || Boolean(leadingToolbarActions) || Boolean(toolbarActions)

  return (
    <div className={cn('flex min-h-0 flex-col bg-[var(--background-primary)] text-[var(--foreground-primary)]', className)}>
      {hasToolbar ? (
        <div className='viewer-toolbar'>
          {leadingToolbarActions ? <div className='viewer-toolbar-leading'>{leadingToolbarActions}</div> : null}
          <div className='viewer-toolbar-title'>{fileName ?? '文档'}</div>
          {toolbarActions ? <div className='viewer-toolbar-actions'>{toolbarActions}</div> : null}
        </div>
      ) : null}
      <div ref={styleRef} aria-hidden='true' />
      <ScrollArea
        className='min-h-0 flex-1'
        viewportClassName='bg-[var(--background-primary)]'
      >
        <div className='min-h-full px-4 py-5'>
          {viewerState === 'loading' ? (
            <div className='grid min-h-56 place-items-center text-sm text-[var(--foreground-secondary)]'>
              正在加载文档...
            </div>
          ) : null}
          {viewerState === 'error' ? (
            <div className='grid min-h-56 place-items-center text-sm text-[var(--foreground-secondary)]'>
              无法预览此文档。
            </div>
          ) : null}
          <div
            ref={bodyRef}
            className={cn(
              'mx-auto w-fit max-w-full overflow-visible',
              '[&_.docx-wrapper]:!bg-transparent [&_.docx-wrapper]:!p-0',
              '[&_.docx]:mx-auto [&_.docx]:shadow-sm',
            )}
          />
        </div>
      </ScrollArea>
    </div>
  )
}
