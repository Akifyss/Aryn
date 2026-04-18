import path from 'node:path'

export const MEO_RUNTIME_DIRECTORY_NAME = 'meo-runtime'
export const MEO_RUNTIME_WEBVIEW_DIST_SEGMENTS = ['webview', 'dist'] as const
export const VENDORED_MEO_RUNTIME_SEGMENTS = ['vendor', MEO_RUNTIME_DIRECTORY_NAME] as const

export function resolveVendoredMeoRuntimeDirectory(projectRoot: string) {
  return path.resolve(projectRoot, ...VENDORED_MEO_RUNTIME_SEGMENTS)
}

export function resolveBuiltMeoRuntimeDirectory(projectRoot: string) {
  return path.resolve(projectRoot, 'dist', MEO_RUNTIME_DIRECTORY_NAME)
}

export function resolveBundledMeoRuntimePath(options: {
  appRoot: string
  isDev: boolean
  rendererDist: string
}) {
  return options.isDev
    ? path.join(options.appRoot, ...VENDORED_MEO_RUNTIME_SEGMENTS)
    : path.join(options.rendererDist, MEO_RUNTIME_DIRECTORY_NAME)
}

export function resolveMeoRuntimeWebviewDistPath(runtimeRootPath: string) {
  return path.join(runtimeRootPath, ...MEO_RUNTIME_WEBVIEW_DIST_SEGMENTS)
}

export function resolveMeoRuntimeEntryPath(runtimeRootPath: string) {
  return path.join(resolveMeoRuntimeWebviewDistPath(runtimeRootPath), 'index.js')
}
