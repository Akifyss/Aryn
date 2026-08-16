import { describe, expect, it } from 'vitest'
import {
  GIT_DIFF_LARGE_PATCH_BYTES,
  GIT_DIFF_MAX_IMAGE_BYTES,
  GIT_DIFF_MAX_PATCH_LINE_CHARACTERS,
  GIT_DIFF_MAX_TEXT_BYTES,
  getGitDiffFileHint,
  getGitDiffReadLimit,
  isProbablyBinary,
  resolveGitDiffContent,
  type GitDiffBlobSnapshot,
} from '../electron/main/git-diff-content'

function loaded(filePath: string, contents: Buffer | string): GitDiffBlobSnapshot {
  const buffer = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8')

  return {
    buffer,
    byteSize: buffer.length,
    filePath,
    status: 'loaded',
  }
}

function withoutContent(
  filePath: string,
  byteSize: number,
  status: Exclude<GitDiffBlobSnapshot['status'], 'loaded'>,
): GitDiffBlobSnapshot {
  return { buffer: null, byteSize, filePath, status }
}

describe('Git diff content presentation', () => {
  it('classifies known text, previewable image, and binary extensions', () => {
    for (const extension of ['png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'bmp', 'avif']) {
      expect(getGitDiffFileHint(`art/image.${extension}`)).toBe('image')
      expect(getGitDiffFileHint(`art/image.${extension.toUpperCase()}`)).toBe('image')
    }

    expect(getGitDiffFileHint('src/app.tsx')).toBe('text')
    expect(getGitDiffFileHint('art/logo.svg')).toBe('text')
    expect(getGitDiffFileHint('art/animation.apng')).toBe('binary')
    expect(getGitDiffFileHint('art/texture.dds')).toBe('unknown')
    expect(getGitDiffFileHint('art/photo.heic')).toBe('binary')
    expect(getGitDiffFileHint('art/photo.tiff')).toBe('binary')
    for (const extension of [
      'pdf',
      'doc',
      'docx',
      'docm',
      'dot',
      'dotx',
      'dotm',
      'rtf',
      'odf',
      'ods',
      'odt',
      'xls',
      'xlsx',
      'xlsm',
      'xlsb',
      'xlt',
      'xltx',
      'xltm',
      'ppt',
      'pptx',
      'pptm',
      'potx',
      'ppsx',
    ]) {
      expect(getGitDiffFileHint(`document.${extension}`)).toBe('binary')
    }
    expect(getGitDiffFileHint('LICENSE')).toBe('unknown')
  })

  it('uses content sniffing for extensionless files', () => {
    expect(isProbablyBinary(Buffer.from('plain text\n', 'utf8'))).toBe(false)
    expect(isProbablyBinary(Buffer.from([0x66, 0x6f, 0x00, 0x6f]))).toBe(true)

    expect(resolveGitDiffContent({
      modified: loaded('LICENSE', 'updated\n'),
      original: loaded('LICENSE', 'original\n'),
    })).toMatchObject({
      modifiedContent: 'updated\n',
      originalContent: 'original\n',
      presentation: { kind: 'text' },
    })

    expect(resolveGitDiffContent({
      modified: loaded('payload', Buffer.from([0x01, 0x00, 0x02])),
      original: null,
    }).presentation).toMatchObject({ kind: 'binary' })
  })

  it('lets Git attributes override extension-based read limits and classification', () => {
    expect(getGitDiffReadLimit('archive.zip', { gitBinary: false })).toBe(GIT_DIFF_MAX_TEXT_BYTES)
    expect(getGitDiffReadLimit('notes.txt', { gitBinary: true })).toBe(0)

    expect(resolveGitDiffContent({
      gitBinary: false,
      modified: loaded('archive.zip', 'updated text\n'),
      original: loaded('archive.zip', 'original text\n'),
    }).presentation).toEqual({ kind: 'text' })

    expect(resolveGitDiffContent({
      gitBinary: true,
      modified: withoutContent('notes.txt', 12, 'metadata-only'),
      original: withoutContent('notes.txt', 10, 'metadata-only'),
    }).presentation).toMatchObject({ kind: 'binary' })
  })

  it('keeps textconv blobs metadata-only and carries the converted patch as read-only text', () => {
    const patch = [
      'diff --git a/report.docx b/report.docx\n',
      'index 1111111..2222222 100644\n',
      '--- a/report.docx\n',
      '+++ b/report.docx\n',
      '@@ -1 +1 @@\n',
      '-Original paragraph\n',
      '+Updated paragraph\n',
    ].join('')

    expect(getGitDiffReadLimit('report.docx', {
      gitBinary: false,
      textConverted: true,
    })).toBe(0)

    expect(resolveGitDiffContent({
      gitBinary: false,
      modified: withoutContent('report.docx', 2048, 'metadata-only'),
      original: withoutContent('report.docx', 1024, 'metadata-only'),
      textConversion: {
        driver: 'astextplain',
        patch,
      },
      textMetadata: {
        patchByteSize: Buffer.byteLength(patch),
        patchMaxLineCharacters: 22,
      },
    })).toEqual({
      modifiedContent: '',
      originalContent: '',
      presentation: {
        driver: 'astextplain',
        isLarge: false,
        kind: 'converted-text',
        modifiedByteSize: 2048,
        originalByteSize: 1024,
        patch,
        patchByteSize: Buffer.byteLength(patch),
      },
    })
  })

  it('always compares symbolic-link targets as text regardless of the link name', () => {
    expect(resolveGitDiffContent({
      modified: {
        ...loaded('logo.png', 'assets/new-logo.png'),
        fileKind: 'symlink',
      },
      original: {
        ...loaded('logo.png', 'assets/old-logo.png'),
        fileKind: 'symlink',
      },
    })).toMatchObject({
      modifiedContent: 'assets/new-logo.png',
      originalContent: 'assets/old-logo.png',
      presentation: { kind: 'text' },
    })
  })

  it('returns raster images as data URLs without decoding them as text', () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const result = resolveGitDiffContent({
      modified: loaded('logo.png', pngBytes),
      original: null,
    })

    expect(result.modifiedContent).toBe('')
    expect(result.originalContent).toBe('')
    expect(result.presentation).toEqual({
      kind: 'image',
      modified: {
        byteSize: pngBytes.length,
        contentType: 'image/png',
        dataUrl: `data:image/png;base64,${pngBytes.toString('base64')}`,
      },
      original: null,
    })
  })

  it('keeps binary files metadata-only and detects incompatible rename types', () => {
    expect(resolveGitDiffContent({
      modified: withoutContent('archive.zip', 2048, 'metadata-only'),
      original: withoutContent('archive.zip', 1024, 'metadata-only'),
    }).presentation).toEqual({
      kind: 'binary',
      modifiedByteSize: 2048,
      originalByteSize: 1024,
    })

    expect(resolveGitDiffContent({
      modified: loaded('renamed.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])),
      original: loaded('renamed.txt', 'not an image'),
    }).presentation).toEqual({
      kind: 'unsupported',
      reason: 'type-change',
    })
  })

  it('gates large text and refuses content above the type-specific limit', () => {
    const textLargerThanThePreviousFileBasedThreshold = Buffer.alloc(2 * 1024 * 1024, 0x61)
    expect(resolveGitDiffContent({
      gitBinary: false,
      modified: loaded('large.txt', textLargerThanThePreviousFileBasedThreshold),
      original: null,
      textMetadata: {
        patchByteSize: 100,
        patchMaxLineCharacters: 20,
      },
    }).presentation).toEqual({ kind: 'text' })

    expect(resolveGitDiffContent({
      modified: withoutContent('huge.txt', GIT_DIFF_MAX_TEXT_BYTES + 1, 'too-large'),
      original: null,
    }).presentation).toEqual({
      kind: 'too-large',
      limitBytes: GIT_DIFF_MAX_TEXT_BYTES,
      modifiedByteSize: GIT_DIFF_MAX_TEXT_BYTES + 1,
      originalByteSize: 0,
    })

    expect(resolveGitDiffContent({
      modified: withoutContent('huge.png', GIT_DIFF_MAX_IMAGE_BYTES + 1, 'too-large'),
      original: null,
    }).presentation).toMatchObject({
      kind: 'too-large',
      limitBytes: GIT_DIFF_MAX_IMAGE_BYTES,
    })

    expect(resolveGitDiffContent({
      gitBinary: false,
      modified: loaded('small.txt', 'updated\n'),
      original: loaded('small.txt', 'original\n'),
      textMetadata: {
        patchByteSize: GIT_DIFF_LARGE_PATCH_BYTES,
        patchMaxLineCharacters: 20,
      },
    }).presentation).toMatchObject({ kind: 'large-text' })

    expect(resolveGitDiffContent({
      gitBinary: false,
      modified: loaded('long-line.txt', 'updated\n'),
      original: loaded('long-line.txt', 'original\n'),
      textMetadata: {
        patchByteSize: 100,
        patchMaxLineCharacters: GIT_DIFF_MAX_PATCH_LINE_CHARACTERS + 1,
      },
    }).presentation).toMatchObject({ kind: 'large-text' })
  })

  it('renders a valid Git patch when complete text blobs exceed the editable read limit', () => {
    const patch = [
      'diff --git a/large.txt b/large.txt\n',
      'index 1111111..2222222 100644\n',
      '--- a/large.txt\n',
      '+++ b/large.txt\n',
      '@@ -1 +1 @@\n',
      '-before\n',
      '+after\n',
    ].join('')

    expect(resolveGitDiffContent({
      gitBinary: false,
      modified: withoutContent('large.txt', GIT_DIFF_MAX_TEXT_BYTES + 20, 'too-large'),
      original: withoutContent('large.txt', GIT_DIFF_MAX_TEXT_BYTES + 10, 'too-large'),
      textMetadata: {
        patchByteSize: Buffer.byteLength(patch),
        patchMaxLineCharacters: 7,
      },
      textPatch: patch,
    })).toEqual({
      modifiedContent: '',
      originalContent: '',
      presentation: {
        isLarge: false,
        kind: 'patch-text',
        modifiedByteSize: GIT_DIFF_MAX_TEXT_BYTES + 20,
        originalByteSize: GIT_DIFF_MAX_TEXT_BYTES + 10,
        patch,
        patchByteSize: Buffer.byteLength(patch),
      },
    })
  })

  it('returns dedicated states for submodules and unreadable blobs', () => {
    expect(resolveGitDiffContent({
      modified: withoutContent('vendor/module', 0, 'submodule'),
      original: null,
    }).presentation).toEqual({
      kind: 'submodule',
      modifiedCommit: null,
      originalCommit: null,
      url: null,
      workingTree: null,
    })

    expect(resolveGitDiffContent({
      modified: withoutContent('missing.txt', 0, 'unreadable'),
      original: null,
    }).presentation).toEqual({ kind: 'unsupported', reason: 'unreadable' })
  })
})
