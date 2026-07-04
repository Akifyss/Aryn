import type { PdfDocumentObject, PdfEngine } from '@embedpdf/models'
import pdfiumWasmUrl from '@embedpdf/pdfium/pdfium.wasm?url'

let sharedEnginePromise: Promise<PdfEngine> | null = null
const pdfDocumentCache = new Map<string, Promise<PdfDocumentObject>>()
const thumbnailUrlCache = new Map<string, Promise<string | null>>()

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('Unable to read PDF thumbnail.'))
    }, { once: true })
    reader.addEventListener('error', () => {
      reject(reader.error ?? new Error('Unable to read PDF thumbnail.'))
    }, { once: true })
    reader.readAsDataURL(blob)
  })
}

function resolveAbsoluteWasmUrl(url: string) {
  try {
    return new URL(url, window.location.href).href
  } catch {
    return url
  }
}

export function getPdfDocumentOpenMode(url: string) {
  const normalizedUrl = url.toLowerCase()

  return normalizedUrl.startsWith('blob:')
    || normalizedUrl.startsWith('data:')
    || normalizedUrl.startsWith('file:')
    ? 'full-fetch'
    : 'auto'
}

export function loadSharedPdfEngine() {
  sharedEnginePromise ??= import('@embedpdf/engines/pdfium-worker-engine').then(
    ({ createPdfiumEngine }) =>
      createPdfiumEngine(resolveAbsoluteWasmUrl(pdfiumWasmUrl), {})
  )

  return sharedEnginePromise
}

export async function loadPdfDocument(url: string) {
  let documentPromise = pdfDocumentCache.get(url)

  if (!documentPromise) {
    documentPromise = loadSharedPdfEngine().then((engine) =>
      engine
        .openDocumentUrl(
          { id: url, url },
          { mode: getPdfDocumentOpenMode(url) }
        )
        .toPromise()
    )
    pdfDocumentCache.set(url, documentPromise)
  }

  return documentPromise
}

export async function getPdfPageCount(url: string) {
  return (await loadPdfDocument(url)).pageCount
}

export function renderPdfThumbnailUrl({
  dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
  pageIndex,
  url,
  width,
}: {
  dpr?: number
  pageIndex: number
  url: string
  width: number
}) {
  const cacheKey = `${url}#${pageIndex}@${width}x${dpr}`
  let thumbnailPromise = thumbnailUrlCache.get(cacheKey)

  if (!thumbnailPromise) {
    thumbnailPromise = (async () => {
      const [engine, document] = await Promise.all([
        loadSharedPdfEngine(),
        loadPdfDocument(url),
      ])
      const page = document.pages[pageIndex]

      if (!page) return null

      const blob = await engine
        .renderThumbnail(document, page, {
          dpr,
          imageType: 'image/png',
          scaleFactor: width / page.size.width,
          withAnnotations: true,
        })
        .toPromise()

      return readBlobAsDataUrl(blob)
    })()
    thumbnailUrlCache.set(cacheKey, thumbnailPromise)
  }

  return thumbnailPromise
}
