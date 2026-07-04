import {
  PptxViewer,
  RECOMMENDED_ZIP_LIMITS,
  type SlideHandle,
} from '@aiden0z/pptx-renderer'

function svgDataUrl(svg: SVGSVGElement) {
  const serializedSvg = new XMLSerializer().serializeToString(svg)

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serializedSvg)}`
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new DOMException('PPTX thumbnail render aborted', 'AbortError')
  }
}

function waitForAnimationFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}

async function waitForEmbeddedImages(
  root: HTMLElement,
  signal: AbortSignal | undefined,
) {
  const images = Array.from(root.querySelectorAll('img'))

  await Promise.all(images.map((image) => {
    if (image.complete) return null

    return new Promise<void>((resolve, reject) => {
      const finish = () => {
        image.removeEventListener('load', finish)
        image.removeEventListener('error', finish)
        signal?.removeEventListener('abort', abort)
        resolve()
      }
      const abort = () => {
        image.removeEventListener('load', finish)
        image.removeEventListener('error', finish)
        reject(new DOMException('PPTX thumbnail render aborted', 'AbortError'))
      }

      image.addEventListener('load', finish, { once: true })
      image.addEventListener('error', finish, { once: true })
      signal?.addEventListener('abort', abort, { once: true })

      if (image.complete) finish()
      else if (signal?.aborted) abort()
    })
  }))
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image blob.'))
    reader.readAsDataURL(blob)
  })
}

async function resourceUrlToDataUrl(url: string, signal: AbortSignal | undefined) {
  if (!url || url.startsWith('data:')) return url

  const response = await fetch(url, { signal })
  if (!response.ok) return url

  return blobToDataUrl(await response.blob())
}

async function inlineImageElementSources(root: HTMLElement, signal: AbortSignal | undefined) {
  const images = Array.from(root.querySelectorAll('img'))

  await Promise.all(images.map(async (image) => {
    const source = image.getAttribute('src') || image.currentSrc
    if (!source || source.startsWith('data:')) return

    try {
      image.setAttribute('src', await resourceUrlToDataUrl(source, signal))
    } catch {
      // Keep the original URL; the thumbnail still renders if the browser can resolve it.
    }
  }))
}

async function inlineSvgImageSources(root: HTMLElement, signal: AbortSignal | undefined) {
  const images = Array.from(root.querySelectorAll('image'))

  await Promise.all(images.map(async (image) => {
    const source = image.getAttribute('href') ?? image.getAttribute('xlink:href')
    if (!source || source.startsWith('data:')) return

    try {
      const dataUrl = await resourceUrlToDataUrl(source, signal)
      image.setAttribute('href', dataUrl)
      image.setAttribute('xlink:href', dataUrl)
    } catch {
      // Keep the original URL; the thumbnail still renders if the browser can resolve it.
    }
  }))
}

async function inlineBackgroundImages(root: HTMLElement, signal: AbortSignal | undefined) {
  const elements = Array.from(root.querySelectorAll<HTMLElement>('*'))

  await Promise.all(elements.map(async (element) => {
    const backgroundImage = element.style.backgroundImage
    if (!backgroundImage || !backgroundImage.includes('url(')) return

    const matches = Array.from(backgroundImage.matchAll(/url\((['"]?)(.*?)\1\)/g))
    let nextBackgroundImage = backgroundImage

    for (const match of matches) {
      const rawUrl = match[2]
      if (!rawUrl || rawUrl.startsWith('data:')) continue

      try {
        const dataUrl = await resourceUrlToDataUrl(rawUrl, signal)
        nextBackgroundImage = nextBackgroundImage.replace(rawUrl, dataUrl)
      } catch {
        // Keep the original URL; the thumbnail still renders if the browser can resolve it.
      }
    }

    element.style.backgroundImage = nextBackgroundImage
  }))
}

function inlineCanvasSnapshots(sourceRoot: HTMLElement, cloneRoot: HTMLElement) {
  const sourceCanvases = Array.from(sourceRoot.querySelectorAll('canvas'))
  const clonedCanvases = Array.from(cloneRoot.querySelectorAll('canvas'))

  sourceCanvases.forEach((sourceCanvas, index) => {
    const clonedCanvas = clonedCanvases[index]
    if (!clonedCanvas) return

    try {
      const image = document.createElement('img')

      image.src = sourceCanvas.toDataURL('image/png')
      image.alt = ''
      image.style.cssText = sourceCanvas.style.cssText
      if (!image.style.width) {
        image.style.width = `${Math.max(1, sourceCanvas.clientWidth || sourceCanvas.width)}px`
      }
      if (!image.style.height) {
        image.style.height = `${Math.max(1, sourceCanvas.clientHeight || sourceCanvas.height)}px`
      }
      clonedCanvas.replaceWith(image)
    } catch {
      // Cross-origin or tainted canvas snapshots are skipped.
    }
  })
}

function removeUnsafeNodes(root: HTMLElement) {
  root.querySelectorAll('script, iframe, object, embed').forEach((node) => node.remove())
}

async function makePptxThumbnailSelfContained(
  root: HTMLElement,
  signal: AbortSignal | undefined,
) {
  await inlineImageElementSources(root, signal)
  await inlineSvgImageSources(root, signal)
  await inlineBackgroundImages(root, signal)
}

export async function renderPptxSlideToDataUrlWithSlideCount(
  src: string,
  options: {
    maxHeight?: number
    maxWidth?: number
    signal?: AbortSignal
    slideNumber?: number
  } = {},
) {
  const response = await fetch(src, { signal: options.signal })

  if (!response.ok) {
    throw new Error(`无法加载 PPTX 文件（${response.status}）。`)
  }

  const presentationBuffer = await response.arrayBuffer()
  const host = document.createElement('div')
  const viewerContainer = document.createElement('div')
  const thumbnailContainer = document.createElement('div')
  let viewer: PptxViewer | null = null
  let thumbnailHandle: SlideHandle | null = null

  throwIfAborted(options.signal)

  host.style.position = 'fixed'
  host.style.left = '-100000px'
  host.style.top = '0'
  host.style.width = '1px'
  host.style.height = '1px'
  host.style.overflow = 'visible'
  host.style.pointerEvents = 'none'
  host.style.opacity = '0'
  host.setAttribute('aria-hidden', 'true')
  host.append(viewerContainer, thumbnailContainer)
  document.body.append(host)

  try {
    viewer = new PptxViewer(viewerContainer, {
      fitMode: 'none',
      lazyMedia: true,
      lazySlides: true,
      pdfjs: false,
      zipLimits: RECOMMENDED_ZIP_LIMITS,
    })

    await viewer.open(presentationBuffer, {
      lazyMedia: true,
      lazySlides: true,
      renderMode: 'slide',
      signal: options.signal,
    })
    throwIfAborted(options.signal)

    const slideCount = Math.max(1, viewer.slideCount)
    const requestedSlideIndex = Math.max(
      0,
      Math.min((options.slideNumber ?? 1) - 1, slideCount - 1),
    )

    thumbnailHandle = viewer.renderThumbnailToContainer(
      requestedSlideIndex,
      thumbnailContainer,
      {
        height: options.maxHeight ?? 220,
        width: options.maxWidth ?? 360,
      },
    )

    if (!thumbnailHandle) {
      return {
        pageCount: slideCount,
        previewAspectRatio: viewer.slideWidth && viewer.slideHeight
          ? viewer.slideWidth / viewer.slideHeight
          : 16 / 9,
        url: null,
      }
    }

    await thumbnailHandle.ready
    await waitForEmbeddedImages(thumbnailContainer, options.signal)
    await makePptxThumbnailSelfContained(thumbnailContainer, options.signal)
    await waitForAnimationFrame()
    await waitForAnimationFrame()
    throwIfAborted(options.signal)

    const thumbnail = thumbnailContainer.querySelector<HTMLElement>('[data-pptx-thumbnail="true"]')
      ?? thumbnailHandle.element
    const rect = thumbnail.getBoundingClientRect()
    const naturalWidth = Math.max(1, Math.ceil(rect.width || thumbnail.scrollWidth))
    const naturalHeight = Math.max(1, Math.ceil(rect.height || thumbnail.scrollHeight))
    const thumbnailClone = thumbnail.cloneNode(true) as HTMLElement

    inlineCanvasSnapshots(thumbnail, thumbnailClone)
    removeUnsafeNodes(thumbnailClone)
    thumbnailClone.style.margin = '0'
    thumbnailClone.style.boxSizing = 'border-box'

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
    const root = document.createElementNS('http://www.w3.org/1999/xhtml', 'div')

    root.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
    root.style.width = `${naturalWidth}px`
    root.style.height = `${naturalHeight}px`
    root.style.overflow = 'hidden'
    root.style.background = '#ffffff'
    root.append(thumbnailClone)
    foreignObject.setAttribute('width', String(naturalWidth))
    foreignObject.setAttribute('height', String(naturalHeight))
    foreignObject.append(root)
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    svg.setAttribute('width', String(naturalWidth))
    svg.setAttribute('height', String(naturalHeight))
    svg.setAttribute('viewBox', `0 0 ${naturalWidth} ${naturalHeight}`)
    svg.append(foreignObject)

    return {
      pageCount: slideCount,
      previewAspectRatio: viewer.slideWidth && viewer.slideHeight
        ? viewer.slideWidth / viewer.slideHeight
        : naturalWidth / naturalHeight,
      url: svgDataUrl(svg),
    }
  } finally {
    thumbnailHandle?.dispose()
    viewer?.destroy()
    host.remove()
  }
}
