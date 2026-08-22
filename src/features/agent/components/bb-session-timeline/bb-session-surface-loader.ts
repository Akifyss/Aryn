import type * as BbSurfaceModule from '@aryn/bb-session-surface'
import { BB_SESSION_SURFACE_REVISION } from './bb-session-surface-revision'

type SurfaceModule = typeof BbSurfaceModule

let surfaceAssetsPromise: Promise<SurfaceModule> | null = null
let loadedSurfaceModule: SurfaceModule | null = null
let surfaceModulePromise: Promise<SurfaceModule> | null = null
let surfaceStylesPromise: Promise<void> | null = null
let surfacePreloadScheduled = false

function ensureSurfaceResourceHint(
  id: string,
  href: string,
  rel: 'modulepreload' | 'preload',
  as?: 'style',
) {
  const current = document.getElementById(id)
  if (current instanceof HTMLLinkElement && current.href === href) return
  current?.remove()
  const link = document.createElement('link')
  link.id = id
  link.rel = rel
  link.href = href
  if (as) link.as = as
  document.head.append(link)
}

function surfaceAssetUrl(assetName: 'index.js' | 'style.css') {
  const url = new URL(`./bb-session-surface/${assetName}`, document.baseURI)
  url.searchParams.set('v', BB_SESSION_SURFACE_REVISION)
  return url.href
}

function loadSurfaceModule() {
  if (!surfaceModulePromise) {
    const moduleUrl = surfaceAssetUrl('index.js')
    surfaceModulePromise = (import(/* @vite-ignore */ moduleUrl) as Promise<SurfaceModule>)
      .catch((error) => {
        surfaceModulePromise = null
        throw error
      })
  }
  return surfaceModulePromise
}

function ensureSurfaceStyles() {
  const id = 'aryn-bb-session-surface-styles'
  const href = surfaceAssetUrl('style.css')
  const current = document.getElementById(id)

  if (
    surfaceStylesPromise
    && current instanceof HTMLLinkElement
    && current.href === href
  ) return surfaceStylesPromise

  surfaceStylesPromise = null
  let existing = current
  if (current instanceof HTMLLinkElement && current.href !== href) {
    current.remove()
    existing = null
  }
  if (existing instanceof HTMLLinkElement && existing.sheet) return Promise.resolve()
  if (existing && !(existing instanceof HTMLLinkElement)) existing.remove()

  const link = existing instanceof HTMLLinkElement ? existing : document.createElement('link')
  const shouldAppend = !(existing instanceof HTMLLinkElement)
  if (shouldAppend) {
    link.id = id
    link.rel = 'stylesheet'
    link.href = href
  }

  surfaceStylesPromise = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      link.removeEventListener('load', handleLoad)
      link.removeEventListener('error', handleError)
    }
    const handleLoad = () => {
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      link.remove()
      surfaceStylesPromise = null
      reject(new Error('统一消息视图样式加载失败。'))
    }
    link.addEventListener('load', handleLoad, { once: true })
    link.addEventListener('error', handleError, { once: true })
    if (shouldAppend) document.head.append(link)
  })

  return surfaceStylesPromise
}

export function getPreloadedBbSessionSurface() {
  return loadedSurfaceModule
}

export function preloadBbSessionSurface() {
  if (!surfaceAssetsPromise) {
    surfaceAssetsPromise = Promise.all([ensureSurfaceStyles(), loadSurfaceModule()])
      .then(([, module]) => {
        loadedSurfaceModule = module
        return module
      })
      .catch((error) => {
        loadedSurfaceModule = null
        surfaceAssetsPromise = null
        throw error
      })
  }
  return surfaceAssetsPromise
}

export function preloadBbSessionSurfaceResources() {
  ensureSurfaceResourceHint(
    'aryn-bb-session-surface-module-preload',
    surfaceAssetUrl('index.js'),
    'modulepreload',
  )
  ensureSurfaceResourceHint(
    'aryn-bb-session-surface-style-preload',
    surfaceAssetUrl('style.css'),
    'preload',
    'style',
  )
}

export function scheduleBbSessionSurfacePreload() {
  if (surfacePreloadScheduled || surfaceAssetsPromise || loadedSurfaceModule) return
  surfacePreloadScheduled = true
  preloadBbSessionSurfaceResources()
  const run = () => {
    surfacePreloadScheduled = false
    void preloadBbSessionSurface().catch(() => undefined)
  }
  // This renderer is required by every native Agent conversation. Waiting for
  // an idle callback leaves a first-click race where the session snapshot is
  // already available but its message view is not. Start the non-blocking
  // import immediately after the first paint instead: app chrome remains the
  // startup priority, while later session navigation never owns this one-time
  // module cost.
  window.requestAnimationFrame(() => {
    globalThis.setTimeout(run, 0)
  })
}
