import path from 'node:path'

const DEFAULT_APP_ICON_ASSET_PATH = 'app-icon.png'

function toAssetPath(publicRoot: string, relativeAssetPath: string) {
  return path.join(publicRoot, ...relativeAssetPath.split('/'))
}

export function getDefaultAppIconAssetPath(publicRoot: string) {
  return toAssetPath(publicRoot, DEFAULT_APP_ICON_ASSET_PATH)
}
