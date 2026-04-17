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
        color-scheme: light;
        --vscode-editor-background: #ffffff;
        --vscode-editor-foreground: #1f2328;
        --vscode-foreground: #1f2328;
        --vscode-sideBar-background: #f6f8fa;
        --vscode-sideBar-foreground: #57606a;
        --vscode-panel-border: #d0d7de;
        --vscode-textCodeBlock-background: #f6f8fa;
        --vscode-editor-selectionBackground: rgba(9, 105, 218, 0.24);
        --vscode-editorCursor-foreground: #0969da;
        --vscode-editorLineNumber-foreground: #8c959f;
        --vscode-editorWidget-background: #ffffff;
        --vscode-editorHoverWidget-background: #ffffff;
        --vscode-editorHoverWidget-foreground: #1f2328;
        --vscode-editor-findMatchBackground: rgba(255, 196, 0, 0.32);
        --vscode-editor-findMatchBorder: rgba(191, 135, 0, 0.55);
        --vscode-toolbar-hoverBackground: rgba(9, 105, 218, 0.1);
        --vscode-descriptionForeground: #6e7781;
        --vscode-focusBorder: rgba(9, 105, 218, 0.48);
        --vscode-input-background: #ffffff;
        --vscode-input-foreground: #1f2328;
        --vscode-button-border: rgba(31, 35, 40, 0.14);
        --vscode-button-secondaryBackground: #eef2f6;
        --vscode-button-secondaryHoverBackground: #e1e7ef;
        --vscode-list-hoverBackground: rgba(9, 105, 218, 0.08);
        --vscode-list-activeSelectionBackground: rgba(9, 105, 218, 0.12);
        --vscode-list-activeSelectionForeground: #0f172a;
        --vscode-scrollbarSlider-background: rgba(100, 110, 120, 0.28);
        --vscode-scrollbarSlider-hoverBackground: rgba(100, 110, 120, 0.42);
        --vscode-scrollbarSlider-activeBackground: rgba(100, 110, 120, 0.52);
        --vscode-errorForeground: #d1242f;
        --vscode-inputValidation-errorBackground: rgba(209, 36, 47, 0.12);
        --vscode-inputValidation-errorBorder: rgba(209, 36, 47, 0.48);
        --vscode-inputValidation-errorForeground: #b42318;
        --vscode-inputValidation-warningBackground: rgba(191, 135, 0, 0.12);
        --vscode-inputValidation-warningBorder: rgba(191, 135, 0, 0.4);
        --vscode-inputValidation-warningForeground: #8a4600;
        --vscode-inputValidation-infoBackground: rgba(9, 105, 218, 0.12);
        --vscode-inputValidation-infoBorder: rgba(9, 105, 218, 0.4);
        --vscode-inputValidation-infoForeground: #0757b8;
        --vscode-editor-font-family: "Georgia", "Times New Roman", serif;
        --vscode-font-family: "Georgia", "Times New Roman", serif;
        --vscode-editor-font-size: 15px;
        --vscode-editor-font-weight: 400;
      }

      :root[data-theme="dark"] {
        color-scheme: dark;
        --vscode-editor-background: #1b1f24;
        --vscode-editor-foreground: #e6edf3;
        --vscode-foreground: #e6edf3;
        --vscode-sideBar-background: #22272e;
        --vscode-sideBar-foreground: #9da7b3;
        --vscode-panel-border: #30363d;
        --vscode-textCodeBlock-background: #2d333b;
        --vscode-editor-selectionBackground: rgba(31, 111, 235, 0.36);
        --vscode-editorCursor-foreground: #58a6ff;
        --vscode-editorLineNumber-foreground: #6e7681;
        --vscode-editorWidget-background: #22272e;
        --vscode-editorHoverWidget-background: #22272e;
        --vscode-editorHoverWidget-foreground: #e6edf3;
        --vscode-editor-findMatchBackground: rgba(187, 128, 9, 0.34);
        --vscode-editor-findMatchBorder: rgba(242, 205, 82, 0.5);
        --vscode-toolbar-hoverBackground: rgba(88, 166, 255, 0.14);
        --vscode-descriptionForeground: #8b949e;
        --vscode-focusBorder: rgba(88, 166, 255, 0.5);
        --vscode-input-background: #1b1f24;
        --vscode-input-foreground: #e6edf3;
        --vscode-button-border: rgba(230, 237, 243, 0.12);
        --vscode-button-secondaryBackground: #30363d;
        --vscode-button-secondaryHoverBackground: #3b434c;
        --vscode-list-hoverBackground: rgba(88, 166, 255, 0.12);
        --vscode-list-activeSelectionBackground: rgba(88, 166, 255, 0.18);
        --vscode-list-activeSelectionForeground: #f0f6fc;
        --vscode-scrollbarSlider-background: rgba(110, 118, 129, 0.32);
        --vscode-scrollbarSlider-hoverBackground: rgba(110, 118, 129, 0.46);
        --vscode-scrollbarSlider-activeBackground: rgba(110, 118, 129, 0.58);
        --vscode-errorForeground: #ff7b72;
        --vscode-inputValidation-errorBackground: rgba(248, 81, 73, 0.14);
        --vscode-inputValidation-errorBorder: rgba(248, 81, 73, 0.4);
        --vscode-inputValidation-errorForeground: #ffb4ad;
        --vscode-inputValidation-warningBackground: rgba(187, 128, 9, 0.16);
        --vscode-inputValidation-warningBorder: rgba(210, 153, 34, 0.45);
        --vscode-inputValidation-warningForeground: #f2cc60;
        --vscode-inputValidation-infoBackground: rgba(31, 111, 235, 0.14);
        --vscode-inputValidation-infoBorder: rgba(88, 166, 255, 0.45);
        --vscode-inputValidation-infoForeground: #a5d6ff;
      }

      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        font-family: var(--vscode-editor-font-family);
        font-size: var(--vscode-editor-font-size);
      }

      body {
        caret-color: var(--vscode-editorCursor-foreground);
      }

      ::selection {
        background: var(--vscode-editor-selectionBackground);
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
        const applyTheme = (nextTheme) => {
          if (nextTheme === 'light' || nextTheme === 'dark') {
            document.documentElement.dataset.theme = nextTheme
            return
          }

          delete document.documentElement.dataset.theme
        }

        const query = new URLSearchParams(window.location.search)
        applyTheme(query.get('theme'))

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

        window.addEventListener('message', (event) => {
          const payload = event.data
          if (!payload || typeof payload !== 'object') {
            return
          }

          if (payload.type === 'themeChanged') {
            applyTheme(payload.themeKind)
          }
        })
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
