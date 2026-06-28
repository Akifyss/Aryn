import { describe, expect, it } from 'vitest'
import {
  isWorkspaceFileSystemDocx,
  isWorkspaceFileSystemImage,
  isWorkspaceFileSystemPdf,
  isWorkspaceFileSystemPreviewable,
  isWorkspaceFileSystemSpreadsheet,
  shouldUseWorkspaceFileDataUrl,
  workspaceNodesToFileSystemItems,
} from '../src/features/workspace/lib/workspace-file-system'
import type { WorkspaceNode } from '../src/features/workspace/types'

describe('workspace file system manifest', () => {
  it('maps workspace tree nodes to flat file system items', () => {
    const createdAt = '2026-01-02T03:04:05.000Z'
    const updatedAt = '2026-02-03T04:05:06.000Z'
    const nodes: WorkspaceNode[] = [
      {
        createdAt,
        kind: 'directory',
        name: 'src',
        path: 'C:\\workspace\\src',
        updatedAt,
        children: [
          {
            createdAt,
            kind: 'file',
            name: 'App.tsx',
            path: 'C:\\workspace\\src\\App.tsx',
            size: 128,
            updatedAt,
          },
        ],
      },
      {
        kind: 'file',
        name: 'README.md',
        path: 'C:\\workspace\\README.md',
      },
    ]

    expect(workspaceNodesToFileSystemItems(nodes, 'C:\\workspace')).toEqual([
      {
        kind: 'folder',
        createdAt,
        name: 'src',
        path: 'src/',
        hasChildren: true,
        updatedAt,
      },
      {
        kind: 'file',
        contentType: 'text/x-typescript',
        createdAt,
        key: 'C:\\workspace\\src\\App.tsx',
        metadata: {
          Extension: 'TSX',
          Kind: 'TSX 文件',
        },
        name: 'App.tsx',
        path: 'src/App.tsx',
        size: 128,
        updatedAt,
      },
      {
        kind: 'file',
        contentType: 'text/markdown',
        key: 'C:\\workspace\\README.md',
        metadata: {
          Extension: 'MD',
          Kind: 'Markdown 文档',
        },
        name: 'README.md',
        path: 'README.md',
      },
    ])
  })

  it('can map only direct children for lazy file system loading', () => {
    const nodes: WorkspaceNode[] = [
      {
        hasChildren: true,
        kind: 'directory',
        name: 'src',
        path: 'C:\\workspace\\src',
        children: [
          {
            kind: 'file',
            name: 'App.tsx',
            path: 'C:\\workspace\\src\\App.tsx',
          },
        ],
      },
      {
        kind: 'file',
        name: 'README.md',
        path: 'C:\\workspace\\README.md',
      },
    ]

    expect(workspaceNodesToFileSystemItems(nodes, 'C:\\workspace', { includeDescendants: false })).toEqual([
      {
        kind: 'folder',
        name: 'src',
        path: 'src/',
        hasChildren: true,
      },
      {
        kind: 'file',
        contentType: 'text/markdown',
        key: 'C:\\workspace\\README.md',
        metadata: {
          Extension: 'MD',
          Kind: 'Markdown 文档',
        },
        name: 'README.md',
        path: 'README.md',
      },
    ])
  })

  it('maps previewable office, pdf, and image content types', () => {
    const nodes: WorkspaceNode[] = [
      {
        kind: 'file',
        name: 'report.docx',
        path: 'C:\\workspace\\report.docx',
      },
      {
        kind: 'file',
        name: 'sheet.xlsx',
        path: 'C:\\workspace\\sheet.xlsx',
      },
      {
        kind: 'file',
        name: 'diagram.svg',
        path: 'C:\\workspace\\diagram.svg',
      },
      {
        kind: 'file',
        name: 'deck.pdf',
        path: 'C:\\workspace\\deck.pdf',
      },
    ]

    expect(workspaceNodesToFileSystemItems(nodes, 'C:\\workspace')).toMatchObject([
      {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        metadata: {
          Extension: 'DOCX',
          Kind: 'Word 文档',
        },
        path: 'report.docx',
        previewPageCount: 1,
      },
      {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        metadata: {
          Extension: 'XLSX',
          Kind: '表格',
        },
        path: 'sheet.xlsx',
        previewAspectRatio: 1.35,
        previewPageCount: 1,
      },
      {
        contentType: 'image/svg+xml',
        metadata: {
          Extension: 'SVG',
          Kind: '图片',
        },
        path: 'diagram.svg',
        previewPageCount: 1,
      },
      {
        contentType: 'application/pdf',
        metadata: {
          Extension: 'PDF',
          Kind: 'PDF 文档',
        },
        path: 'deck.pdf',
        previewPageCount: 1,
      },
    ])
  })

  it('classifies common local media, archive, font, and document formats', () => {
    const nodes: WorkspaceNode[] = [
      { kind: 'file', name: 'clip.mp4', path: 'C:\\workspace\\clip.mp4' },
      { kind: 'file', name: 'photo.heic', path: 'C:\\workspace\\photo.heic' },
      { kind: 'file', name: 'book.epub', path: 'C:\\workspace\\book.epub' },
      { kind: 'file', name: 'font.woff2', path: 'C:\\workspace\\font.woff2' },
      { kind: 'file', name: 'bundle.7z', path: 'C:\\workspace\\bundle.7z' },
      { kind: 'file', name: 'Component.vue', path: 'C:\\workspace\\Component.vue' },
    ]

    expect(workspaceNodesToFileSystemItems(nodes, 'C:\\workspace')).toMatchObject([
      {
        contentType: 'video/mp4',
        metadata: { Extension: 'MP4', Kind: '视频' },
      },
      {
        contentType: 'image/heic',
        metadata: { Extension: 'HEIC', Kind: '图片' },
      },
      {
        contentType: 'application/epub+zip',
        metadata: { Extension: 'EPUB', Kind: 'EPUB 文档' },
      },
      {
        contentType: 'font/woff2',
        metadata: { Extension: 'WOFF2', Kind: '字体' },
      },
      {
        contentType: 'application/x-7z-compressed',
        metadata: { Extension: '7Z', Kind: '7Z 文件' },
      },
      {
        contentType: 'text/x-vue',
        metadata: { Extension: 'VUE', Kind: 'VUE 文件' },
      },
    ])
  })

  it('falls back to the basename when a node is outside the workspace root', () => {
    const nodes: WorkspaceNode[] = [
      {
        kind: 'file',
        name: 'external.txt',
        path: 'D:\\other\\external.txt',
      },
    ]

    expect(workspaceNodesToFileSystemItems(nodes, 'C:\\workspace')).toEqual([
      {
        kind: 'file',
        contentType: 'text/plain',
        key: 'D:\\other\\external.txt',
        metadata: {
          Extension: 'TXT',
          Kind: '文本文档',
        },
        name: 'external.txt',
        path: 'external.txt',
      },
    ])
  })

  it('does not treat sibling directories with a shared prefix as workspace children', () => {
    const nodes: WorkspaceNode[] = [
      {
        kind: 'file',
        name: 'leak.txt',
        path: 'C:\\workspace-other\\leak.txt',
      },
    ]

    expect(workspaceNodesToFileSystemItems(nodes, 'C:\\workspace')).toEqual([
      {
        kind: 'file',
        contentType: 'text/plain',
        key: 'C:\\workspace-other\\leak.txt',
        metadata: {
          Extension: 'TXT',
          Kind: '文本文档',
        },
        name: 'leak.txt',
        path: 'leak.txt',
      },
    ])
  })
})

describe('workspace file system preview support', () => {
  it('keeps built-in preview behavior for supported file types only', () => {
    expect(isWorkspaceFileSystemPreviewable({
      contentType: 'application/pdf',
      path: 'docs/spec.pdf',
    })).toBe(true)
    expect(isWorkspaceFileSystemPreviewable({
      contentType: undefined,
      path: 'docs/spec.docx',
    })).toBe(true)
    expect(isWorkspaceFileSystemPreviewable({
      contentType: 'application/vnd.ms-excel',
      path: 'docs/legacy.xls',
    })).toBe(true)
    expect(isWorkspaceFileSystemPreviewable({
      contentType: 'image/heic',
      path: 'images/photo.heic',
    })).toBe(false)
    expect(isWorkspaceFileSystemPreviewable({
      contentType: 'text/markdown',
      path: 'README.md',
    })).toBe(false)
  })

  it('selects the URL transport needed by local previews', () => {
    expect(isWorkspaceFileSystemImage({
      contentType: undefined,
      path: 'images/photo.webp',
    })).toBe(true)
    expect(isWorkspaceFileSystemPdf({
      contentType: undefined,
      path: 'docs/spec.pdf',
    })).toBe(true)
    expect(isWorkspaceFileSystemDocx({
      contentType: undefined,
      path: 'docs/spec.docx',
    })).toBe(true)
    expect(isWorkspaceFileSystemSpreadsheet({
      contentType: undefined,
      path: 'docs/sheet.xlsx',
    })).toBe(true)
    expect(isWorkspaceFileSystemSpreadsheet({
      contentType: 'application/vnd.ms-excel',
      path: 'docs/legacy.xls',
    })).toBe(true)
    expect(shouldUseWorkspaceFileDataUrl({
      contentType: 'application/pdf',
      path: 'docs/spec.pdf',
    })).toBe(true)
    expect(shouldUseWorkspaceFileDataUrl({
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      path: 'docs/spec.docx',
    })).toBe(true)
    expect(shouldUseWorkspaceFileDataUrl({
      contentType: 'image/png',
      path: 'images/photo.png',
    })).toBe(true)
    expect(shouldUseWorkspaceFileDataUrl({
      contentType: undefined,
      path: 'images/photo.jpeg',
    })).toBe(true)
    expect(shouldUseWorkspaceFileDataUrl({
      contentType: 'image/heic',
      path: 'images/photo.heic',
    })).toBe(false)
  })
})
