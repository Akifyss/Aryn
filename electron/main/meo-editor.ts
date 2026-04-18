import { access } from 'node:fs/promises'
import { buildMeoWrapperHtml } from './meo-wrapper'
import { createMeoResourceServer, type MeoResourceServer, type MeoRuntimeBundle } from './meo-resource-server'
import { resolveMeoRuntimeEntryPath } from '../../config/meo-runtime'

type MeoEditorBootstrap = {
  extensionLabel: string
  wrapperUrl: string
}

const meoRoutePrefix = '/meo/'
const bundledMeoRuntimeCacheKey = 'bundled-meo-runtime-v1'
const bundledMeoRuntimeLabel = 'Markdown Editor Optimized'

let meoServer: MeoResourceServer | null = null
let meoServerPromise: Promise<MeoResourceServer> | null = null

async function hasFile(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
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

  meoServerPromise = createMeoResourceServer(meoRoutePrefix)
    .then((server) => {
      meoServer = {
        ...server,
        close: async () => {
          await server.close()
          meoServer = null
          meoServerPromise = null
        },
      }
      return meoServer
    })
    .catch((error) => {
      meoServerPromise = null
      throw error
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

  return {
    extensionLabel: runtimeBundle.extensionLabel,
    wrapperUrl: server.registerBundle(runtimeBundle),
  }
}

export async function disposeBundledMeoEditorServer() {
  if (!meoServer) {
    return
  }

  await meoServer.close()
}
