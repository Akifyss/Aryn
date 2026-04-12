import { nativeImage } from 'electron'
import path from 'node:path'
import type { AppIconCatalogOption } from '../../src/features/settings/types'

type AppIconDefinition = Omit<AppIconCatalogOption, 'previewSrc'> & {
  relativeAssetPath: string
}

export const DEFAULT_APP_ICON_ID = 'default'

const APP_ICON_DEFINITIONS: AppIconDefinition[] = [
  {
    id: DEFAULT_APP_ICON_ID,
    label: '默认',
    description: 'app-icon.png',
    relativeAssetPath: 'app-icon.png',
  },
  {
    id: 'alt1',
    label: 'ALT1',
    description: 'ALT1.png',
    relativeAssetPath: 'app-icons/alt-1.png',
  },
  {
    id: 'alt2',
    label: 'ALT2',
    description: 'ALT2png.png',
    relativeAssetPath: 'app-icons/alt-2.png',
  },
  {
    id: 'alt3',
    label: 'ALT3',
    description: 'ALT3png.png',
    relativeAssetPath: 'app-icons/alt-3.png',
  },
  {
    id: 'alt4',
    label: 'ALT4',
    description: 'ALT4.png',
    relativeAssetPath: 'app-icons/alt-4.png',
  },
  {
    id: 'alt5',
    label: 'ALT5',
    description: 'ALT5.png',
    relativeAssetPath: 'app-icons/alt-5.png',
  },
  {
    id: 'alt6',
    label: 'ALT6',
    description: 'ALT6.png',
    relativeAssetPath: 'app-icons/alt-6.png',
  },
]

function getAppIconDefinition(appIconId?: string | null) {
  return APP_ICON_DEFINITIONS.find((option) => option.id === appIconId)
    ?? APP_ICON_DEFINITIONS[0]
}

function toAssetPath(publicRoot: string, relativeAssetPath: string) {
  return path.join(publicRoot, ...relativeAssetPath.split('/'))
}

function toPreviewDataUrl(assetPath: string) {
  const icon = nativeImage.createFromPath(assetPath)

  if (icon.isEmpty()) {
    return ''
  }

  return icon
    .resize({ width: 96, height: 96 })
    .toDataURL()
}

export function resolveAppIconId(appIconId?: string | null) {
  return getAppIconDefinition(appIconId).id
}

export function getAppIconAssetPath(publicRoot: string, appIconId?: string | null) {
  return toAssetPath(publicRoot, getAppIconDefinition(appIconId).relativeAssetPath)
}

export function getAppIconCatalog(publicRoot: string): AppIconCatalogOption[] {
  return APP_ICON_DEFINITIONS.map(({ relativeAssetPath, ...option }) => {
    const assetPath = toAssetPath(publicRoot, relativeAssetPath)

    return {
      ...option,
      previewSrc: toPreviewDataUrl(assetPath),
    }
  })
}
