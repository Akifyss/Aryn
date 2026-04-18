import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { buildMeoWrapperHtml } from './meo-wrapper'
import { resolveMeoRuntimeEntryPath } from '../../config/meo-runtime'

type MeoRuntimeBundle = {
  cacheKey: string
  extensionLabel: string
  runtimeRootPath: string
  wrapperHtml: string
}

type MeoEditorBootstrap = {
  extensionLabel: string
  wrapperUrl: string
}

const meoRoutePrefix = '/meo/'
const bundledMeoRuntimeCacheKey = 'bundled-meo-runtime-v1'
const bundledMeoRuntimeLabel = 'Markdown Editor Optimized'

type MeoServer = {
  baseUrl: string
  close: () => Promise<void>
  extensionsByCacheKey: Map<string, MeoRuntimeBundle>
}

let meoServer: MeoServer | null = null
let meoServerPromise: Promise<MeoServer> | null = null

async function hasFile(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function getContentType(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.css':
      return 'text/css; charset=utf-8'
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8'
    case '.json':
    case '.map':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.woff':
      return 'font/woff'
    case '.woff2':
      return 'font/woff2'
    case '.ttf':
      return 'font/ttf'
    default:
      return 'application/octet-stream'
  }
}

function isPathInsideRoot(targetPath: string, rootPath: string) {
  const relativePath = path.relative(rootPath, targetPath)
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

async function resolveBundledRuntime(runtimeRootPath: string): Promise<MeoRuntimeBundle> {
  if (!(await hasFile(resolveMeoRuntimeEntryPath(runtimeRootPath)))) {
    throw new Error('The bundled MEO runtime is missing its webview bundle.')
  }

  return {
    cacheKey: bundledMeoRuntimeCacheKey,
    extensionLabel: bundledMeoRuntimeLabel,
    runtimeRootPath,
    wrapperHtml: buildMeoWrapperHtml({
      cacheKey: bundledMeoRuntimeCacheKey,
      routePrefix: meoRoutePrefix,
      title: bundledMeoRuntimeLabel,
    }),
  }
}

function sendResponse(response: ServerResponse, statusCode: number, body: string | Buffer, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
  })
  response.end(body)
}

async function handleMeoRequest(
  request: IncomingMessage,
  response: ServerResponse,
  extensionsByCacheKey: Map<string, MeoRuntimeBundle>,
) {
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
  const requestPath = decodeURIComponent(requestUrl.pathname)

  if (!requestPath.startsWith(meoRoutePrefix)) {
    sendResponse(response, 404, 'Not found.')
    return
  }

  const relativeRoutePath = requestPath.slice(meoRoutePrefix.length)
  const [cacheKey, ...relativePathSegments] = relativeRoutePath.split('/').filter(Boolean)

  if (!cacheKey || relativePathSegments.length === 0) {
    sendResponse(response, 404, 'Missing MEO resource path.')
    return
  }

  const extension = extensionsByCacheKey.get(cacheKey)
  if (!extension) {
    sendResponse(response, 404, 'Unknown MEO bundle.')
    return
  }

  const relativeFilePath = relativePathSegments.join('/')

  if (relativeFilePath === '.aryn-meo-wrapper.html') {
    sendResponse(response, 200, extension.wrapperHtml, 'text/html; charset=utf-8')
    return
  }

  const targetPath = path.resolve(extension.runtimeRootPath, relativeFilePath)

  if (!isPathInsideRoot(targetPath, extension.runtimeRootPath)) {
    sendResponse(response, 403, 'Forbidden MEO resource path.')
    return
  }

  try {
    const body = await readFile(targetPath)
    sendResponse(response, 200, body, getContentType(targetPath))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read MEO resource.'
    sendResponse(response, 404, message)
  }
}

async function ensureMeoServer() {
  if (meoServer) {
    return meoServer
  }

  if (meoServerPromise) {
    const existingServer = await meoServerPromise
    if (!existingServer) {
      throw new Error('The MEO server could not be created.')
    }
    return existingServer
  }

  meoServerPromise = new Promise((resolve, reject) => {
    const extensionsByCacheKey = new Map<string, MeoRuntimeBundle>()
    const server = createServer((request, response) => {
      void handleMeoRequest(request, response, extensionsByCacheKey)
    })

    server.once('error', (error) => {
      meoServerPromise = null
      reject(error)
    })

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        meoServerPromise = null
        reject(new Error('Unable to determine the MEO server address.'))
        return
      }

      const nextServer = {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((closeResolve, closeReject) => {
          server.close((error) => {
            if (error) {
              closeReject(error)
              return
            }

            meoServer = null
            meoServerPromise = null
            closeResolve()
          })
        }),
        extensionsByCacheKey,
      } satisfies MeoServer

      meoServer = nextServer
      resolve(nextServer)
    })
  })

  const activeServer = await meoServerPromise
  if (!activeServer) {
    throw new Error('The MEO server could not be created.')
  }
  return activeServer
}

export async function getBundledMeoEditorBootstrap(
  bundledRuntimeRootPath: string,
): Promise<MeoEditorBootstrap> {
  const runtimeBundle = await resolveBundledRuntime(bundledRuntimeRootPath)

  const server = await ensureMeoServer()
  server.extensionsByCacheKey.set(runtimeBundle.cacheKey, runtimeBundle)

  return {
    extensionLabel: runtimeBundle.extensionLabel,
    wrapperUrl: `${server.baseUrl}${meoRoutePrefix}${encodeURIComponent(runtimeBundle.cacheKey)}/.aryn-meo-wrapper.html`,
  }
}

export async function disposeBundledMeoEditorServer() {
  if (!meoServer) {
    return
  }

  await meoServer.close()
}
