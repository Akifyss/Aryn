import { renderAsync } from 'docx-preview'

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
    throw new Error(`无法加载 DOCX 文档（${response.status}）`)
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
      return { pageCount: pages.length || 1, previewAspectRatio: null, url: null }
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
      previewAspectRatio: naturalWidth / naturalHeight,
      url: svgDataUrl(svg),
    }
  } finally {
    host.remove()
  }
}
