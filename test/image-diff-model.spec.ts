import { describe, expect, it } from 'vitest'
import {
  getImageComparisonStageDimensions,
  getImageOverlayStageStyle,
  getImageVersionPresentation,
  imageMayContainTransparency,
} from '@/features/editor/components/git-diff-editor/image-diff-model'
import type { GitFileDiffResult } from '@/features/git/types'

const baseDiff: GitFileDiffResult = {
  change: {
    kind: 'modified',
    originalPath: null,
    path: 'C:\\workspace\\image.png',
    relativePath: 'image.png',
    scope: 'unstaged',
    statusCode: ' M',
  },
  editorKind: 'file',
  modifiedContent: '',
  modifiedExists: true,
  modifiedLabel: 'Working tree',
  originalContent: '',
  originalExists: true,
  originalLabel: 'Index',
  presentation: {
    kind: 'image',
    modified: null,
    original: null,
  },
  repositoryRootPath: 'C:\\workspace',
  selections: [],
  source: { kind: 'working-tree' },
}

describe('image diff model', () => {
  it('keeps Git sources while leading with user-facing comparison states', () => {
    expect(getImageVersionPresentation(baseDiff, 'original', true)).toEqual({
      accessibleLabel: '修改前，来源：暂存区',
      sourceLabel: '暂存区',
      statusLabel: '修改前',
      tone: 'removed',
    })
    expect(getImageVersionPresentation(baseDiff, 'modified', true)).toEqual({
      accessibleLabel: '修改后，来源：工作树',
      sourceLabel: '工作树',
      statusLabel: '修改后',
      tone: 'added',
    })
  })

  it('uses explicit added and deleted labels for single-version images', () => {
    expect(getImageVersionPresentation({
      ...baseDiff,
      change: { ...baseDiff.change, kind: 'deleted' },
    }, 'original', false).statusLabel).toBe('已删除')
    expect(getImageVersionPresentation({
      ...baseDiff,
      change: { ...baseDiff.change, kind: 'added' },
    }, 'modified', false).statusLabel).toBe('新增')
  })

  it('uses the largest decoded bounds when image dimensions differ', () => {
    expect(getImageComparisonStageDimensions(null, null)).toBeNull()
    expect(getImageComparisonStageDimensions(null, { height: 100, width: 120 })).toEqual({
      height: 100,
      width: 120,
    })
    expect(getImageComparisonStageDimensions(
      { height: 100, width: 200 },
      { height: 160, width: 120 },
    )).toEqual({
      height: 160,
      width: 200,
    })
  })

  it('sizes the overlay stage from the decoded image instead of a placeholder canvas', () => {
    const dimensions = { height: 2298, width: 4092 }

    expect(getImageOverlayStageStyle(null)).toBeUndefined()
    expect(getImageOverlayStageStyle(dimensions)).toEqual({
      aspectRatio: '4092 / 2298',
      maxWidth: '4092px',
    })
    expect(getImageOverlayStageStyle(dimensions, {
      height: 900,
      width: 2100,
    })).toEqual({
      aspectRatio: '4092 / 2298',
      maxWidth: 'none',
      width: '1602px',
    })
    expect(getImageOverlayStageStyle(
      { height: 50, width: 100 },
      { height: 1000, width: 1000 },
    )).toEqual({
      aspectRatio: '100 / 50',
      maxWidth: 'none',
      width: '1000px',
    })
  })

  it('uses a transparency grid only for formats that may carry alpha', () => {
    expect(imageMayContainTransparency({
      byteSize: 1,
      contentType: 'image/png',
      dataUrl: '',
    })).toBe(true)
    expect(imageMayContainTransparency({
      byteSize: 1,
      contentType: 'image/jpeg',
      dataUrl: '',
    })).toBe(false)
  })
})
