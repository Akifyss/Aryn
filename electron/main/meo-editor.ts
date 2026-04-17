import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import extractZip from 'extract-zip'

type ExtensionPackageManifest = {
  displayName?: string
  name?: string
}

type ExtractedMeoExtension = {
  cacheKey: string
  extensionLabel: string
  extensionRootPath: string
}

type MeoEditorBootstrap = {
  extensionLabel: string
  wrapperUrl: string
}

const packageFileName = 'package.json'
const bundledVsixFileName = 'vadimmelnicuk.meo-0.1.23.vsix'
const meoRoutePrefix = '/meo/'

type MeoServer = {
  baseUrl: string
  close: () => Promise<void>
  extensionsByCacheKey: Map<string, ExtractedMeoExtension>
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

async function resolveVsixCacheKey(vsixPath: string) {
  const fileInfo = await stat(vsixPath)
  return createHash('sha1')
    .update(path.resolve(vsixPath))
    .update(':')
    .update(String(fileInfo.size))
    .update(':')
    .update(String(fileInfo.mtimeMs))
    .digest('hex')
}

async function resolveExtractedExtensionRoot(extractRootPath: string) {
  const directPackagePath = path.join(extractRootPath, packageFileName)
  const nestedPackagePath = path.join(extractRootPath, 'extension', packageFileName)

  if (await hasFile(directPackagePath)) {
    return extractRootPath
  }

  if (await hasFile(nestedPackagePath)) {
    return path.join(extractRootPath, 'extension')
  }

  const entries = await readdir(extractRootPath, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const candidateRootPath = path.join(extractRootPath, entry.name)
    if (await hasFile(path.join(candidateRootPath, packageFileName))) {
      return candidateRootPath
    }
  }

  throw new Error('The bundled MEO VSIX package does not contain a resolvable extension manifest.')
}

async function ensureExtractedVsix(vsixPath: string, cacheRootPath: string) {
  const cacheKey = await resolveVsixCacheKey(vsixPath)
  const extractRootPath = path.join(cacheRootPath, cacheKey)
  const extensionRootMarkerPath = path.join(extractRootPath, 'extension', packageFileName)
  const directRootMarkerPath = path.join(extractRootPath, packageFileName)

  await mkdir(cacheRootPath, { recursive: true })

  if ((await hasFile(extensionRootMarkerPath)) || (await hasFile(directRootMarkerPath))) {
    return {
      cacheKey,
      extensionRootPath: await resolveExtractedExtensionRoot(extractRootPath),
    }
  }

  await rm(extractRootPath, { recursive: true, force: true })
  await mkdir(extractRootPath, { recursive: true })
  await extractZip(vsixPath, { dir: extractRootPath })

  return {
    cacheKey,
    extensionRootPath: await resolveExtractedExtensionRoot(extractRootPath),
  }
}

async function loadExtensionManifest(extensionRootPath: string) {
  const manifestPath = path.join(extensionRootPath, packageFileName)
  const rawManifest = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(rawManifest) as ExtensionPackageManifest

  return {
    extensionLabel: manifest.displayName?.trim() || manifest.name?.trim() || 'Markdown Editor Optimized',
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

function buildWrapperHtml(cacheKey: string) {
  const staticPrefix = `${meoRoutePrefix}${encodeURIComponent(cacheKey)}`

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Markdown Editor Optimized</title>
    <style>
      :root {
        color-scheme: light dark;
        --vscode-editor-background: #ffffff;
        --vscode-editor-foreground: #1f2328;
        --vscode-sideBar-background: #f6f8fa;
        --vscode-panel-border: #d0d7de;
        --vscode-textCodeBlock-background: #f6f8fa;
        --vscode-editor-font-family: "Georgia", "Times New Roman", serif;
        --vscode-editor-font-size: 15px;
        --vscode-editor-font-weight: 400;
      }

      :root[data-theme="dark"] {
        --vscode-editor-background: #1b1f24;
        --vscode-editor-foreground: #e6edf3;
        --vscode-sideBar-background: #22272e;
        --vscode-panel-border: #30363d;
        --vscode-textCodeBlock-background: #2d333b;
      }

      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: var(--vscode-editor-background);
      }

      #app {
        width: 100%;
        height: 100%;
      }
    </style>
    <link href="${staticPrefix}/webview/dist/katex/katex.min.css" rel="stylesheet" />
    <link href="${staticPrefix}/webview/dist/index.css" rel="stylesheet" />
  </head>
  <body data-meo-mermaid-src="${staticPrefix}/webview/dist/mermaid.min.js">
    <div id="app" class="editor-root"></div>
    <script>
      (() => {
        let state
        const query = new URLSearchParams(window.location.search)
        const theme = query.get('theme')
        if (theme === 'light' || theme === 'dark') {
          document.documentElement.dataset.theme = theme
        }

        window.acquireVsCodeApi = function acquireVsCodeApi() {
          return {
            postMessage(message) {
              window.parent.postMessage({ __arynMeo: true, payload: message }, '*')
            },
            getState() {
              return state
            },
            setState(nextState) {
              state = nextState
              return nextState
            },
          }
        }
      })()
    </script>
    <script type="module" src="${staticPrefix}/webview/dist/index.js"></script>
  </body>
</html>`
}

async function writeWrapperFile(extractedExtension: ExtractedMeoExtension) {
  const wrapperPath = path.join(extractedExtension.extensionRootPath, '.aryn-meo-wrapper.html')
  await writeFile(wrapperPath, buildWrapperHtml(extractedExtension.cacheKey), 'utf8')
  return wrapperPath
}

async function resolveExtractedExtension(vitePublicPath: string, cacheRootPath: string): Promise<ExtractedMeoExtension> {
  const vsixPath = path.join(vitePublicPath, 'extensions', bundledVsixFileName)
  const { cacheKey, extensionRootPath } = await ensureExtractedVsix(vsixPath, cacheRootPath)
  const extensionInfo = await loadExtensionManifest(extensionRootPath)
  const webviewDistPath = path.join(extensionRootPath, 'webview', 'dist')

  if (!(await hasFile(path.join(webviewDistPath, 'index.js')))) {
    throw new Error('The bundled MEO extension is missing its webview bundle.')
  }

  return {
    cacheKey,
    extensionLabel: extensionInfo.extensionLabel,
    extensionRootPath,
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
  extensionsByCacheKey: Map<string, ExtractedMeoExtension>,
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
  const targetPath = path.resolve(extension.extensionRootPath, relativeFilePath)

  if (!isPathInsideRoot(targetPath, extension.extensionRootPath)) {
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
    const extensionsByCacheKey = new Map<string, ExtractedMeoExtension>()
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
  vitePublicPath: string,
  cacheRootPath: string,
): Promise<MeoEditorBootstrap> {
  const extractedExtension = await resolveExtractedExtension(vitePublicPath, cacheRootPath)
  await writeWrapperFile(extractedExtension)

  const server = await ensureMeoServer()
  server.extensionsByCacheKey.set(extractedExtension.cacheKey, extractedExtension)

  return {
    extensionLabel: extractedExtension.extensionLabel,
    wrapperUrl: `${server.baseUrl}${meoRoutePrefix}${encodeURIComponent(extractedExtension.cacheKey)}/.aryn-meo-wrapper.html`,
  }
}

export async function disposeBundledMeoEditorServer() {
  if (!meoServer) {
    return
  }

  await meoServer.close()
}
