import type {
  GitDiffImage,
  GitFileDiffResult,
} from '@/features/git/types'

export type ImageDiffSide = 'modified' | 'original'
export type ImageVersionTone = 'added' | 'neutral' | 'removed'

export type ImageNaturalDimensions = {
  height: number
  width: number
}

export type ImageVersionPresentation = {
  accessibleLabel: string
  sourceLabel: string
  statusLabel: string
  tone: ImageVersionTone
}

export type ImageOverlayStageStyle = {
  aspectRatio: string
  maxWidth: string
  width?: string
}

const TRANSPARENCY_CAPABLE_IMAGE_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/png',
  'image/vnd.microsoft.icon',
  'image/webp',
  'image/x-icon',
])

function localizeImageSourceLabel(label: string) {
  switch (label) {
    case 'Index':
      return '暂存区'
    case 'Working tree':
      return '工作树'
    default:
      return label
  }
}

function getImageStatusLabel(
  diff: GitFileDiffResult,
  side: ImageDiffSide,
  hasBothVersions: boolean,
) {
  if (!hasBothVersions) {
    if (side === 'original') {
      return diff.change.kind === 'deleted' ? '已删除' : '原版本'
    }

    return diff.change.kind === 'added' || diff.change.kind === 'untracked'
      ? '新增'
      : '当前版本'
  }

  if (diff.change.kind === 'copied') {
    return side === 'original' ? '源文件' : '副本'
  }

  if (diff.change.kind === 'renamed') {
    return side === 'original' ? '原文件' : '重命名后'
  }

  return side === 'original' ? '修改前' : '修改后'
}

export function getImageVersionPresentation(
  diff: GitFileDiffResult,
  side: ImageDiffSide,
  hasBothVersions: boolean,
): ImageVersionPresentation {
  const sourceLabel = localizeImageSourceLabel(
    side === 'original' ? diff.originalLabel : diff.modifiedLabel,
  )
  const statusLabel = getImageStatusLabel(diff, side, hasBothVersions)
  const tone = diff.change.kind === 'copied' && side === 'original'
    ? 'neutral'
    : side === 'original'
      ? 'removed'
      : 'added'

  return {
    accessibleLabel: `${statusLabel}，来源：${sourceLabel}`,
    sourceLabel,
    statusLabel,
    tone,
  }
}

export function getImageComparisonStageDimensions(
  original: ImageNaturalDimensions | null,
  modified: ImageNaturalDimensions | null,
): ImageNaturalDimensions | null {
  if (!original) return modified
  if (!modified) return original

  return {
    height: Math.max(original.height, modified.height),
    width: Math.max(original.width, modified.width),
  }
}

export function getImageOverlayStageStyle(
  dimensions: ImageNaturalDimensions | null,
  fitBounds?: ImageNaturalDimensions | null,
): ImageOverlayStageStyle | undefined {
  if (!dimensions) return undefined

  const aspectRatio = `${dimensions.width} / ${dimensions.height}`
  if (fitBounds && fitBounds.width > 0 && fitBounds.height > 0) {
    const fittedWidth = Math.min(
      fitBounds.width,
      fitBounds.height * (dimensions.width / dimensions.height),
    )

    return {
      aspectRatio,
      maxWidth: 'none',
      width: `${Math.max(1, Math.floor(fittedWidth))}px`,
    }
  }

  return {
    aspectRatio,
    maxWidth: `${dimensions.width}px`,
  }
}

export function imageMayContainTransparency(image: GitDiffImage) {
  return TRANSPARENCY_CAPABLE_IMAGE_TYPES.has(image.contentType.toLowerCase())
}
