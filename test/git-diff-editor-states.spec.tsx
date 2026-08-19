import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import binaryFileIcon from '@iconify-icons/streamline-flex-color/file-code-1-flat'
import renderErrorIcon from '@iconify-icons/streamline-flex-color/monitor-error-flat'
import cleanIcon from '@iconify-icons/streamline-plump-color/check-thick-flat'
import repositoryIcon from '@iconify-icons/streamline-plump-color/end-point-branches-flat'
import imageUnavailableIcon from '@iconify-icons/streamline-plump-color/no-photo-taking-zone-flat'
import unreadableIcon from '@iconify-icons/streamline-plump-color/broken-link-2-flat'
import { EMPTY_STATE_ICONS } from '@/components/empty-state'
import {
  DIFF_UNSAFE_CSS,
  GitDiffEditor,
} from '@/features/editor/components/git-diff-editor/git-diff-editor'
import type { GitFileDiffResult } from '@/features/git/types'

const baseDiff: GitFileDiffResult = {
  change: {
    kind: 'modified',
    originalPath: null,
    path: 'C:\\workspace\\example.bin',
    relativePath: 'example.bin',
    scope: 'unstaged',
    statusCode: ' M',
  },
  editorKind: 'code',
  modifiedContent: '',
  modifiedExists: true,
  modifiedLabel: '工作树',
  originalContent: '',
  originalExists: true,
  originalLabel: '版本',
  presentation: {
    kind: 'binary',
    modifiedByteSize: 12,
    originalByteSize: 10,
  },
  repositoryRootPath: 'C:\\workspace',
  selections: [],
  source: { kind: 'working-tree' },
}

function renderDiff(diff: GitFileDiffResult) {
  return renderToStaticMarkup(
    <GitDiffEditor
      diff={diff}
      draftContent={diff.modifiedContent}
      onDiscardChange={() => undefined}
      onDraftChange={() => undefined}
      onSaveEditedFile={async () => undefined}
      onStageChange={() => undefined}
      onUnstageChange={() => undefined}
    />,
  )
}

describe('GitDiffEditor states', () => {
  it('centers the Pierre loading state across the full diff viewport', () => {
    const markup = renderDiff({
      ...baseDiff,
      change: {
        ...baseDiff.change,
        path: 'C:\\workspace\\example.txt',
        relativePath: 'example.txt',
      },
      modifiedContent: 'after',
      originalContent: 'before',
      presentation: { kind: 'text' },
    })

    expect(markup).toContain('class="app-loading-state is-fill git-diff-render-loading"')
    expect(markup).toContain('正在准备差异…')
  })

  it('renders explicit Git textconv patches as ordinary read-only text like GitHub Desktop', () => {
    const patch = [
      'diff --git a/report.docx b/report.docx\n',
      'index 1111111..2222222 100644\n',
      '--- a/report.docx\n',
      '+++ b/report.docx\n',
      '@@ -1 +1 @@\n',
      '-Original paragraph\n',
      '+Updated paragraph\n',
    ].join('')
    const markup = renderDiff({
      ...baseDiff,
      change: {
        ...baseDiff.change,
        path: 'C:\\workspace\\report.docx',
        relativePath: 'report.docx',
      },
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

    expect(markup).not.toContain('aria-label="差异类型：')
    expect(markup).not.toContain('转换文本')
    expect(markup).toContain('正在准备差异…')
  })

  it('renders oversized regular text from its Git patch instead of rejecting the diff', () => {
    const patch = [
      'diff --git a/large.txt b/large.txt\n',
      'index 1111111..2222222 100644\n',
      '--- a/large.txt\n',
      '+++ b/large.txt\n',
      '@@ -1 +1 @@\n',
      '-before\n',
      '+after\n',
    ].join('')
    const markup = renderDiff({
      ...baseDiff,
      change: {
        ...baseDiff.change,
        path: 'C:\\workspace\\large.txt',
        relativePath: 'large.txt',
      },
      presentation: {
        isLarge: false,
        kind: 'patch-text',
        modifiedByteSize: 9_000_000,
        originalByteSize: 9_000_000,
        patch,
        patchByteSize: Buffer.byteLength(patch),
      },
    })

    expect(markup).not.toContain('aria-label="差异类型：')
    expect(markup).toContain('正在准备差异…')
    expect(markup).not.toContain('文件过大，无法安全显示')
  })

  it('keeps Pierre editor text on the fixed-width metric grid used by its overlays', () => {
    expect(DIFF_UNSAFE_CSS).toContain('--diffs-font-features: "liga" 0, "calt" 0;')
    expect(DIFF_UNSAFE_CSS).toContain('--diffs-gap-block: 0px;')
    expect(DIFF_UNSAFE_CSS).toContain('font-variant-ligatures: none;')
    expect(DIFF_UNSAFE_CSS).toContain('letter-spacing: 0;')
  })

  it('bundles shared empty-state artwork as local Iconify data', () => {
    expect(Object.values(EMPTY_STATE_ICONS).every(
      (icon) => typeof icon.body === 'string' && icon.body.length > 0,
    )).toBe(true)
  })

  it('maps empty-state artwork to the state it communicates', () => {
    expect(EMPTY_STATE_ICONS).toMatchObject({
      binaryFile: binaryFileIcon,
      clean: cleanIcon,
      imageUnavailable: imageUnavailableIcon,
      renderError: renderErrorIcon,
      repository: repositoryIcon,
      unreadable: unreadableIcon,
    })
  })

  it('uses the shared empty state for unavailable and oversized diffs', () => {
    const binaryMarkup = renderDiff(baseDiff)
    const largeTextMarkup = renderDiff({
      ...baseDiff,
      change: {
        ...baseDiff.change,
        path: 'C:\\workspace\\large.txt',
        relativePath: 'large.txt',
      },
      editorKind: 'code',
      modifiedContent: 'changed',
      originalContent: 'original',
      presentation: {
        kind: 'large-text',
        modifiedByteSize: 2_000_000,
        originalByteSize: 1_900_000,
      },
    })

    expect(binaryMarkup).toContain('class="app-empty-state git-diff-unavailable"')
    expect(binaryMarkup).toContain('role="status"')
    expect(binaryMarkup).toContain('二进制文件已更改')
    expect(binaryMarkup).toContain('用系统默认程序打开')
    expect(binaryMarkup).toContain('class="app-empty-state-icon"')
    expect(largeTextMarkup).toContain('class="app-empty-state git-diff-unavailable"')
    expect(largeTextMarkup).toContain('这是一个较大的文本差异')
    expect(largeTextMarkup).toContain('仍然显示')
  })

  it('explains text and image diffs that have no renderable content', () => {
    const unchangedTextMarkup = renderDiff({
      ...baseDiff,
      change: {
        ...baseDiff.change,
        kind: 'renamed',
        originalPath: 'C:\\workspace\\before.txt',
        path: 'C:\\workspace\\after.txt',
        relativePath: 'after.txt',
        statusCode: 'R100',
      },
      editorKind: 'code',
      presentation: { kind: 'text' },
    })
    const emptyImageMarkup = renderDiff({
      ...baseDiff,
      change: {
        ...baseDiff.change,
        path: 'C:\\workspace\\image.png',
        relativePath: 'image.png',
      },
      editorKind: 'file',
      presentation: {
        kind: 'image',
        modified: null,
        original: null,
      },
    })

    expect(unchangedTextMarkup).toContain('文件内容没有变化')
    expect(unchangedTextMarkup).toContain('重命名、权限或其他元数据变化')
    expect(emptyImageMarkup).toContain('没有可显示的图片版本')
    expect(emptyImageMarkup).toContain('class="app-empty-state git-diff-unavailable"')
  })

  it('offers the GitHub Desktop image comparison modes for modified images', () => {
    const markup = renderDiff({
      ...baseDiff,
      change: {
        ...baseDiff.change,
        path: 'C:\\workspace\\image.png',
        relativePath: 'image.png',
      },
      presentation: {
        kind: 'image',
        modified: {
          byteSize: 4,
          contentType: 'image/png',
          dataUrl: 'data:image/png;base64,bmV3',
        },
        original: {
          byteSize: 4,
          contentType: 'image/png',
          dataUrl: 'data:image/png;base64,b2xk',
        },
      },
    })

    expect(markup).toContain('aria-label="图片差异查看方式"')
    const headerMarkup = markup.slice(
      markup.indexOf('<header'),
      markup.indexOf('</header>') + '</header>'.length,
    )
    expect(headerMarkup).toContain('aria-label="文件差异工具栏"')
    expect(headerMarkup).toContain('class="viewer-toolbar git-diff-header"')
    expect(headerMarkup).toContain('aria-label="图片差异查看方式"')
    expect(headerMarkup).not.toContain('差异类型：image')
    expect(headerMarkup).not.toContain('>图片</span>')
    expect(markup).not.toContain('git-diff-image-toolbar')
    expect(markup).toContain('修改前')
    expect(markup).toContain('修改后')
    expect(markup).toContain('并排')
    expect(markup).toContain('滑动')
    expect(markup).toContain('叠加')
    expect(markup).toContain('差异')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).not.toContain('aria-label="图片缩放"')
    expect(markup).not.toContain('app-scroll-area')
    expect(markup).toContain('data-checkerboard=""')
  })

  it('describes a deleted opaque image with user-facing status and no transparency grid', () => {
    const markup = renderDiff({
      ...baseDiff,
      change: {
        ...baseDiff.change,
        kind: 'deleted',
        path: 'C:\\workspace\\photo.jpg',
        relativePath: 'photo.jpg',
        statusCode: ' D',
      },
      modifiedExists: false,
      modifiedLabel: 'Working tree',
      originalLabel: 'Index',
      presentation: {
        kind: 'image',
        modified: null,
        original: {
          byteSize: 4,
          contentType: 'image/jpeg',
          dataUrl: 'data:image/jpeg;base64,b2xk',
        },
      },
    })

    expect(markup).toContain('已删除')
    expect(markup).toContain('暂存区')
    expect(markup).not.toContain('aria-label="图片差异查看方式"')
    expect(markup).not.toContain('aria-label="图片缩放"')
    expect(markup).not.toContain('data-checkerboard=""')
  })

  it('shows submodule commit pointers, working-tree state, and an open action', () => {
    const markup = renderDiff({
      ...baseDiff,
      change: {
        ...baseDiff.change,
        path: 'C:\\workspace\\vendor\\module',
        relativePath: 'vendor/module',
      },
      presentation: {
        kind: 'submodule',
        modifiedCommit: '2222222222222222222222222222222222222222',
        originalCommit: '1111111111111111111111111111111111111111',
        url: 'git@github.com:example/module.git',
        workingTree: {
          modifiedChanges: true,
          untrackedChanges: true,
        },
      },
    })

    expect(markup).toContain('子模块提交已更新')
    expect(markup).toContain('11111111')
    expect(markup).toContain('22222222')
    expect(markup).toContain('已修改内容和未跟踪文件')
    expect(markup).toContain('git@github.com:example/module.git')
    expect(markup).toContain('打开子模块文件夹')
    expect(markup).toContain('class="app-empty-state-icon"')
  })
})
