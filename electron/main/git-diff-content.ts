import type {
  GitDiffImage,
  GitDiffSubmoduleWorkingTree,
  GitFileDiffPresentation,
} from '../shared/contracts/git'
import {
  getFileExtension,
  inferFileContentType,
} from '../shared/contracts/file-content-types'

export const GIT_DIFF_MAX_PATCH_BYTES = 70_000_000
export const GIT_DIFF_LARGE_PATCH_BYTES = 70_000_000 / 16
export const GIT_DIFF_MAX_PATCH_LINE_CHARACTERS = 5_000
export const GIT_DIFF_MAX_IMAGE_BYTES = 16 * 1024 * 1024
export const GIT_DIFF_MAX_TEXT_BYTES = 8 * 1024 * 1024

// Keep this list in lockstep with GitHub Desktop's stable image diff list.
// Other image formats (including APNG, SVG, HEIC, TIFF, and PSD) follow Git's
// text/binary result instead of being forced through the image comparison UI.
const PREVIEWABLE_RASTER_IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'ico',
  'webp',
  'bmp',
  'avif',
])

const TEXT_APPLICATION_TYPES = new Set([
  'application/json',
  'application/sql',
  'application/toml',
  'application/x-bat',
  'application/x-httpd-php',
  'application/x-sh',
  'application/xml',
  'image/svg+xml',
])

export type GitDiffFileHint = 'binary' | 'image' | 'text' | 'unknown'
export type GitDiffFileKind = 'file' | 'submodule' | 'symlink'

export type GitDiffTextMetadata = {
  patchByteSize: number
  patchMaxLineCharacters: number
}

export type GitDiffBlobSnapshot = {
  buffer: Buffer | null
  byteSize: number
  fileKind?: GitDiffFileKind
  filePath: string
  objectId?: string | null
  status: 'loaded' | 'metadata-only' | 'submodule' | 'too-large' | 'unreadable'
  submoduleWorkingTree?: GitDiffSubmoduleWorkingTree | null
}

export type ResolvedGitDiffContent = {
  modifiedContent: string
  originalContent: string
  presentation: GitFileDiffPresentation
}

export function getGitDiffFileHint(filePath: string): GitDiffFileHint {
  const contentType = inferFileContentType(filePath)

  if (PREVIEWABLE_RASTER_IMAGE_EXTENSIONS.has(getFileExtension(filePath))) {
    return 'image'
  }

  if (!contentType) return 'unknown'

  if (contentType.startsWith('text/') || TEXT_APPLICATION_TYPES.has(contentType)) {
    return 'text'
  }

  return 'binary'
}

export function getGitDiffReadLimit(
  filePath: string,
  options: {
    fileKind?: GitDiffFileKind
    gitBinary?: boolean | null
    textConverted?: boolean
  } = {},
) {
  if (options.fileKind === 'symlink') {
    return GIT_DIFF_MAX_TEXT_BYTES
  }

  if (options.textConverted) {
    return 0
  }

  if (options.gitBinary === false) {
    return GIT_DIFF_MAX_TEXT_BYTES
  }

  if (options.gitBinary === true) {
    return getGitDiffFileHint(filePath) === 'image' ? GIT_DIFF_MAX_IMAGE_BYTES : 0
  }

  switch (getGitDiffFileHint(filePath)) {
    case 'binary':
      return 0
    case 'image':
      return GIT_DIFF_MAX_IMAGE_BYTES
    case 'text':
    case 'unknown':
      return GIT_DIFF_MAX_TEXT_BYTES
  }
}

export function isProbablyBinary(buffer: Buffer) {
  const sampleLength = Math.min(buffer.length, 8_000)

  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) {
      return true
    }
  }

  return false
}

function toImage(snapshot: GitDiffBlobSnapshot | null): GitDiffImage | null {
  if (!snapshot?.buffer) {
    return null
  }

  const contentType = inferFileContentType(snapshot.filePath) ?? 'application/octet-stream'

  return {
    byteSize: snapshot.byteSize,
    contentType,
    dataUrl: `data:${contentType};base64,${snapshot.buffer.toString('base64')}`,
  }
}

function getByteSize(snapshot: GitDiffBlobSnapshot | null) {
  return snapshot?.byteSize ?? 0
}

function getExistingSnapshots(
  original: GitDiffBlobSnapshot | null,
  modified: GitDiffBlobSnapshot | null,
) {
  return [original, modified].filter((snapshot): snapshot is GitDiffBlobSnapshot => snapshot !== null)
}

function isLargeTextDiff(textMetadata: GitDiffTextMetadata | null) {
  return (
    (textMetadata?.patchByteSize ?? 0) >= GIT_DIFF_LARGE_PATCH_BYTES
    || (textMetadata?.patchMaxLineCharacters ?? 0) > GIT_DIFF_MAX_PATCH_LINE_CHARACTERS
  )
}

export function resolveGitDiffContent(options: {
  gitBinary?: boolean | null
  modified: GitDiffBlobSnapshot | null
  original: GitDiffBlobSnapshot | null
  textPatch?: string | null
  textConversion?: {
    driver: string
    patch: string
  } | null
  textMetadata?: GitDiffTextMetadata | null
}): ResolvedGitDiffContent {
  const {
    gitBinary = null,
    modified,
    original,
    textPatch = null,
    textConversion = null,
    textMetadata = null,
  } = options
  const existingSnapshots = getExistingSnapshots(original, modified)
  const originalByteSize = getByteSize(original)
  const modifiedByteSize = getByteSize(modified)

  if (existingSnapshots.some((snapshot) => snapshot.status === 'submodule')) {
    return {
      modifiedContent: '',
      originalContent: '',
      presentation: {
        kind: 'submodule',
        modifiedCommit: modified?.objectId ?? null,
        originalCommit: original?.objectId ?? null,
        url: null,
        workingTree: modified?.submoduleWorkingTree ?? null,
      },
    }
  }

  if (existingSnapshots.some((snapshot) => snapshot.status === 'unreadable')) {
    return {
      modifiedContent: '',
      originalContent: '',
      presentation: {
        kind: 'unsupported',
        reason: 'unreadable',
      },
    }
  }

  if (textConversion) {
    return {
      modifiedContent: '',
      originalContent: '',
      presentation: {
        driver: textConversion.driver,
        isLarge: isLargeTextDiff(textMetadata),
        kind: 'converted-text',
        modifiedByteSize,
        originalByteSize,
        patch: textConversion.patch,
        patchByteSize: textMetadata?.patchByteSize ?? Buffer.byteLength(textConversion.patch),
      },
    }
  }

  if (existingSnapshots.some((snapshot) => snapshot.status === 'too-large')) {
    if (gitBinary === false && textPatch && textMetadata) {
      return {
        modifiedContent: '',
        originalContent: '',
        presentation: {
          isLarge: isLargeTextDiff(textMetadata),
          kind: 'patch-text',
          modifiedByteSize,
          originalByteSize,
          patch: textPatch,
          patchByteSize: textMetadata.patchByteSize,
        },
      }
    }

    const exceededLimits = existingSnapshots
      .filter((snapshot) => snapshot.status === 'too-large')
      .map((snapshot) => getGitDiffReadLimit(snapshot.filePath, {
        fileKind: snapshot.fileKind,
        gitBinary,
      }))
      .filter((limitBytes) => limitBytes > 0)

    return {
      modifiedContent: '',
      originalContent: '',
      presentation: {
        kind: 'too-large',
        limitBytes: exceededLimits.length > 0
          ? Math.min(...exceededLimits)
          : GIT_DIFF_MAX_TEXT_BYTES,
        modifiedByteSize,
        originalByteSize,
      },
    }
  }

  const hints = existingSnapshots.map((snapshot) => getGitDiffFileHint(snapshot.filePath))
  const imageCount = hints.filter((hint) => hint === 'image').length
  const symlinkCount = existingSnapshots.filter((snapshot) => snapshot.fileKind === 'symlink').length

  if (symlinkCount > 0 && symlinkCount !== existingSnapshots.length) {
    return {
      modifiedContent: '',
      originalContent: '',
      presentation: {
        kind: 'unsupported',
        reason: 'type-change',
      },
    }
  }

  if (gitBinary !== false && symlinkCount === 0 && imageCount > 0 && imageCount !== existingSnapshots.length) {
    return {
      modifiedContent: '',
      originalContent: '',
      presentation: {
        kind: 'unsupported',
        reason: 'type-change',
      },
    }
  }

  if (gitBinary !== false && symlinkCount === 0 && imageCount > 0) {
    return {
      modifiedContent: '',
      originalContent: '',
      presentation: {
        kind: 'image',
        modified: toImage(modified),
        original: toImage(original),
      },
    }
  }

  if (
    gitBinary === true
    || (gitBinary === null && existingSnapshots.some((snapshot, index) => (
      hints[index] === 'binary'
        || snapshot.status === 'metadata-only'
        || (snapshot.buffer ? isProbablyBinary(snapshot.buffer) : true)
    )))
  ) {
    return {
      modifiedContent: '',
      originalContent: '',
      presentation: {
        kind: 'binary',
        modifiedByteSize,
        originalByteSize,
      },
    }
  }

  const presentation: GitFileDiffPresentation = (
    isLargeTextDiff(textMetadata)
  )
    ? {
      kind: 'large-text',
      modifiedByteSize,
      originalByteSize,
    }
    : { kind: 'text' }

  return {
    modifiedContent: modified?.buffer?.toString('utf8') ?? '',
    originalContent: original?.buffer?.toString('utf8') ?? '',
    presentation,
  }
}
