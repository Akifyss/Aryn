import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export type MeoRuntimeBundle = {
  cacheKey: string
  extensionLabel: string
  runtimeRootPath: string
  wrapperHtml: string
}

export type MeoResourceServer = {
  baseUrl: string
  close: () => Promise<void>
  registerBundle: (bundle: MeoRuntimeBundle) => string
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

function sendResponse(
  response: ServerResponse,
  statusCode: number,
  body: string | Buffer,
  contentType = 'text/plain; charset=utf-8',
) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
  })
  response.end(body)
}

async function handleMeoRequest(
  request: IncomingMessage,
  response: ServerResponse,
  bundlesByCacheKey: Map<string, MeoRuntimeBundle>,
  routePrefix: string,
) {
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
  const requestPath = decodeURIComponent(requestUrl.pathname)

  if (!requestPath.startsWith(routePrefix)) {
    sendResponse(response, 404, 'Not found.')
    return
  }

  const relativeRoutePath = requestPath.slice(routePrefix.length)
  const [cacheKey, ...relativePathSegments] = relativeRoutePath.split('/').filter(Boolean)

  if (!cacheKey || relativePathSegments.length === 0) {
    sendResponse(response, 404, 'Missing MEO resource path.')
    return
  }

  const bundle = bundlesByCacheKey.get(cacheKey)
  if (!bundle) {
    sendResponse(response, 404, 'Unknown MEO bundle.')
    return
  }

  const relativeFilePath = relativePathSegments.join('/')

  if (relativeFilePath === '.aryn-meo-wrapper.html') {
    sendResponse(response, 200, bundle.wrapperHtml, 'text/html; charset=utf-8')
    return
  }

  const targetPath = path.resolve(bundle.runtimeRootPath, relativeFilePath)
  if (!isPathInsideRoot(targetPath, bundle.runtimeRootPath)) {
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

export async function createMeoResourceServer(routePrefix: string): Promise<MeoResourceServer> {
  return new Promise((resolve, reject) => {
    const bundlesByCacheKey = new Map<string, MeoRuntimeBundle>()
    let activeServer: MeoResourceServer | null = null

    const server = createServer((request, response) => {
      void handleMeoRequest(request, response, bundlesByCacheKey, routePrefix)
    })

    server.once('error', (error) => {
      reject(error)
    })

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to determine the MEO server address.'))
        return
      }

      activeServer = {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((closeResolve, closeReject) => {
          server.close((error) => {
            if (error) {
              closeReject(error)
              return
            }

            closeResolve()
          })
        }),
        registerBundle: (bundle) => {
          bundlesByCacheKey.set(bundle.cacheKey, bundle)
          return `${activeServer?.baseUrl ?? `http://127.0.0.1:${address.port}`}${routePrefix}${encodeURIComponent(bundle.cacheKey)}/.aryn-meo-wrapper.html`
        },
      }

      resolve(activeServer)
    })
  })
}
