import { describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import {
  __fileSystemTestHooks,
  type FileSystemItem,
} from '../src/components/ui/file-system'
import { __csvViewerTestHooks } from '../src/components/ui/csv-viewer'
import { __documentViewerControlsTestHooks } from '../src/components/ui/document-viewer-controls'
import { collectLazyFolderLoadCandidates } from '../src/components/ui/file-system-lazy-loading'
import { __xlsxViewerTestHooks } from '../src/components/ui/xlsx-viewer'
import { inferFileContentType } from '../src/lib/file-content-types'
import { __workspaceFilePreviewTestHooks } from '../src/features/workspace/components/workspace-file-preview'
import {
  isPptxContentType,
  isPptxFileName,
  PPTX_CONTENT_TYPE_BY_EXTENSION,
} from '../src/lib/pptx-file-types'

const manifest: FileSystemItem[] = [
  { kind: 'folder', path: 'docs/' },
  {
    contentType: 'application/pdf',
    kind: 'file',
    name: 'report.pdf',
    path: 'docs/report.pdf',
    size: 400,
    updatedAt: '2026-06-02T00:00:00.000Z',
  },
  {
    contentType: 'text/markdown',
    kind: 'file',
    name: 'notes.md',
    path: 'docs/notes.md',
    size: 100,
    updatedAt: '2026-06-01T00:00:00.000Z',
  },
  {
    contentType: 'video/mp4',
    kind: 'file',
    name: 'demo.mp4',
    path: 'demo.mp4',
    size: 900,
    updatedAt: '2026-06-03T00:00:00.000Z',
  },
]

describe('FileSystem interaction model', () => {
  it('keeps matching descendants and their ancestors visible during search', () => {
    const index = __fileSystemTestHooks.buildFileSystemIndex(manifest)
    const visiblePaths = __fileSystemTestHooks.collectVisiblePaths({
      currentPath: '',
      fileFilter: null,
      index,
      searchQuery: __fileSystemTestHooks.normalizeSearchQuery(' REPORT '),
    })

    expect([...visiblePaths!].sort()).toEqual(['docs/', 'docs/report.pdf'])
  })

  it('combines file-type filtering with descendant visibility', () => {
    const index = __fileSystemTestHooks.buildFileSystemIndex(manifest)
    const pdfFilter = {
      id: 'pdf',
      operator: 'is' as const,
      type: 'fileType' as const,
      value: ['application/pdf'],
    }
    const visiblePaths = __fileSystemTestHooks.collectVisiblePaths({
      currentPath: '',
      fileFilter: (file) => __fileSystemTestHooks.fileMatchesFilter(file, pdfFilter),
      index,
      searchQuery: '',
    })

    expect([...visiblePaths!].sort()).toEqual(['docs/', 'docs/report.pdf'])
  })

  it('discovers unloaded lazy folders under the active search scope', () => {
    const index = __fileSystemTestHooks.buildFileSystemIndex([
      { kind: 'folder', path: 'docs/', hasChildren: true },
      { kind: 'folder', path: 'docs/loaded/', hasChildren: true },
      { kind: 'file', path: 'docs/loaded/readme.md' },
      { kind: 'folder', path: 'src/', hasChildren: true },
      { kind: 'folder', path: 'src/components/', hasChildren: true },
    ])

    expect(collectLazyFolderLoadCandidates({
      currentPath: '',
      index,
      limit: 4,
      loadingFolders: new Set(['src/']),
      requestedFolders: new Set(['docs/']),
    })).toEqual(['src/components/'])

    expect(collectLazyFolderLoadCandidates({
      currentPath: 'src/',
      index,
      limit: 2,
      loadingFolders: new Set(),
      requestedFolders: new Set(),
    })).toEqual(['src/components/'])
  })

  it('sorts files by size and recognizes media filter groups', () => {
    const index = __fileSystemTestHooks.buildFileSystemIndex(manifest)
    const files = [...index.files.values()]
      .sort((left, right) => __fileSystemTestHooks.compareEntriesBySort(left, right, {
        direction: 'desc',
        key: 'size',
      }))

    expect(files.map((file) => file.name)).toEqual(['demo.mp4', 'report.pdf', 'notes.md'])
    expect(__fileSystemTestHooks.fileTypeFilterGroup('video/mp4')).toBe('Audio & video')
  })

  it('moves grid selection by rendered row geometry', () => {
    const index = __fileSystemTestHooks.buildFileSystemIndex([
      { kind: 'file', path: 'a.txt' },
      { kind: 'file', path: 'b.txt' },
      { kind: 'file', path: 'c.txt' },
      { kind: 'file', path: 'd.txt' },
    ])
    const entries = index.children.get('') ?? []
    const focused = vi.fn()
    const itemRefs = new Map(entries.map((entry, itemIndex) => {
      const column = itemIndex % 2
      const row = Math.floor(itemIndex / 2)

      return [entry.path, {
        focus: focused,
        getBoundingClientRect: () => ({
          left: column * 100,
          top: row * 100,
        }),
      } as unknown as HTMLButtonElement]
    }))
    const onSelect = vi.fn()

    expect(__fileSystemTestHooks.moveGridSelection({
      entries,
      itemRefs,
      key: 'ArrowDown',
      onSelect,
      selectedPath: 'a.txt',
    })).toBe(true)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ path: 'c.txt' }))
    expect(focused).toHaveBeenCalledOnce()
  })

  it('normalizes lazy thumbnail metadata without dropping the image ratio', () => {
    expect(__fileSystemTestHooks.normalizePreviewImageLoadResult({
      pageCount: 3,
      previewAspectRatio: 16 / 9,
      url: 'data:image/png;base64,preview',
    })).toEqual({
      pageCount: 3,
      previewAspectRatio: 16 / 9,
      url: 'data:image/png;base64,preview',
    })
  })

  it('normalizes navigation history while preserving root entries', () => {
    expect(__fileSystemTestHooks.normalizeNavigationState({
      index: 5,
      stack: ['', 'docs', 'docs/', 'docs/reports'],
    })).toEqual({
      index: 2,
      stack: ['', 'docs/', 'docs/reports/'],
    })

    expect(__fileSystemTestHooks.normalizeNavigationState(null, 'docs')).toEqual({
      index: 0,
      stack: ['docs/'],
    })
  })
})

describe('FileSystem local file data', () => {
  it('infers common media, archive, font, and code content types', () => {
    expect(inferFileContentType('clip.mp4')).toBe('video/mp4')
    expect(inferFileContentType('sound.flac')).toBe('audio/flac')
    expect(inferFileContentType('bundle.7z')).toBe('application/x-7z-compressed')
    expect(inferFileContentType('font.woff2')).toBe('font/woff2')
    expect(inferFileContentType('Component.vue')).toBe('text/x-vue')
  })

  it('keeps every supported OpenXML presentation variant aligned', () => {
    for (const [extension, contentType] of Object.entries(PPTX_CONTENT_TYPE_BY_EXTENSION)) {
      expect(inferFileContentType(`slides.${extension}`)).toBe(contentType)
      expect(isPptxFileName(`SLIDES.${extension.toUpperCase()}`)).toBe(true)
      expect(isPptxContentType(`${contentType}; charset=binary`)).toBe(true)
      expect(__fileSystemTestHooks.viewerKindForFile({
        contentType,
        kind: 'file',
        path: `slides.${extension}`,
      })).toBe('pptx')
    }

    expect(isPptxFileName('legacy.ppt')).toBe(false)
    expect(isPptxContentType('application/vnd.ms-powerpoint')).toBe(false)
    expect(__fileSystemTestHooks.viewerKindForFile({
      contentType: 'application/vnd.ms-powerpoint',
      kind: 'file',
      path: 'legacy.ppt',
    })).toBeNull()
  })

  it('moves viewer zoom controls by one preset even from an intermediate value', () => {
    const zoomOptions = [10, 25, 50, 75, 100, 125, 150, 175, 200, 400] as const

    expect(__documentViewerControlsTestHooks.getAdjacentZoomValue(zoomOptions, 100, 1)).toBe(125)
    expect(__documentViewerControlsTestHooks.getAdjacentZoomValue(zoomOptions, 110, 1)).toBe(125)
    expect(__documentViewerControlsTestHooks.getAdjacentZoomValue(zoomOptions, 110, -1)).toBe(100)
    expect(__documentViewerControlsTestHooks.getAdjacentZoomValue(zoomOptions, 10, -1)).toBeNull()
    expect(__documentViewerControlsTestHooks.getAdjacentZoomValue(zoomOptions, 400, 1)).toBeNull()
  })

  it('keeps the image preview viewport center anchored when selecting zoom', () => {
    const viewportWidth = 1000
    const viewportHeight = 800
    const currentTransformState = {
      positionX: 40,
      positionY: -20,
      scale: 1,
    }
    const contentCenterBefore = {
      x: (viewportWidth / 2 - currentTransformState.positionX) / currentTransformState.scale,
      y: (viewportHeight / 2 - currentTransformState.positionY) / currentTransformState.scale,
    }
    const nextTransformState =
      __workspaceFilePreviewTestHooks.calculateImagePreviewCenteredZoomTransform({
        currentTransformState,
        nextScale: 2,
        viewportHeight,
        viewportWidth,
      })
    const contentCenterAfter = {
      x: (viewportWidth / 2 - nextTransformState.positionX) / nextTransformState.scale,
      y: (viewportHeight / 2 - nextTransformState.positionY) / nextTransformState.scale,
    }

    expect(contentCenterAfter).toEqual(contentCenterBefore)
    expect(nextTransformState).toEqual({
      positionX: -420,
      positionY: -440,
      scale: 2,
    })
  })

  it('maps the requested thumbnail page to the matching workbook sheet', () => {
    const workbook = XLSX.utils.book_new()

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['One']]), 'First')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Two']]), 'Second')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Three']]), 'Third')

    expect(__xlsxViewerTestHooks.resolveXlsxSheet(workbook, 1)).toMatchObject({
      sheetCount: 3,
      sheetIndex: 1,
      sheetName: 'Second',
    })
    expect(__xlsxViewerTestHooks.resolveXlsxSheet(workbook, 99)).toMatchObject({
      sheetCount: 3,
      sheetIndex: 2,
      sheetName: 'Third',
    })
  })

  it('parses quoted CSV cells for the CSV viewer', () => {
    expect(__csvViewerTestHooks.parseDelimitedText('name,note\n"Ada","hello, world"\n"Linus","uses ""quotes"""')).toEqual([
      ['name', 'note'],
      ['Ada', 'hello, world'],
      ['Linus', 'uses "quotes"'],
    ])
  })
})
