import { Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import type { CodeMirrorDiffChunk } from '../src/features/editor/lib/git-diff-navigation'
import { __meoLiveInlineDiffTestHooks } from '../src/features/editor/lib/meo-native-live-inline-diff'
import {
  buildCodeMirrorChunksFromVsCodeDiff,
  createGitDiffLineHunkId,
} from '../src/vendor/meo/shared/gitDiffLineFlags'

function createScenarioDocs() {
  const originalLines = Array.from({ length: 62 }, (_, index) => `line ${index + 1}`)
  originalLines[57] = '## 9. Math formulas'
  originalLines[58] = 'Markdown supports LaTeX formulas.'

  const modifiedLines = [...originalLines]
  modifiedLines[57] = '## 9. Math formulas!'
  modifiedLines[58] = 'Markdown supports LaTeX formulas. extra'

  return {
    modifiedDoc: Text.of(modifiedLines),
    originalDoc: Text.of(originalLines),
  }
}

function createChineseMarkdownScenarioDocs() {
  const originalLines = Array.from({ length: 62 }, (_, index) => `line ${index + 1}`)
  originalLines[57] = '## 9. 数学公式'
  originalLines[58] = 'Markdown 支持 LaTeX 语法来书写数学公式。'

  const modifiedLines = [...originalLines]
  modifiedLines[57] = '## 9. 数学公式发'
  modifiedLines[58] = 'Markdown 支持 LaTeX 语法来书写数学公式。 都得空'

  return {
    modifiedDoc: Text.of(modifiedLines),
    originalDoc: Text.of(originalLines),
  }
}

describe('meo live inline diff', () => {
  it('keeps inline split as the default and toggles to unified explicitly', () => {
    expect(__meoLiveInlineDiffTestHooks.getNextInlineDiffViewMode('split')).toBe('unified')
    expect(__meoLiveInlineDiffTestHooks.getNextInlineDiffViewMode('unified')).toBe('split')
    expect(__meoLiveInlineDiffTestHooks.getInlineDiffViewModeToggleLabel('split')).toBe('Switch to inline unified')
    expect(__meoLiveInlineDiffTestHooks.getInlineDiffViewModeToggleLabel('unified')).toBe('Switch to inline split')
    expect(__meoLiveInlineDiffTestHooks.getInlineDiffViewModeToggleIconName('split')).toBe('unified')
    expect(__meoLiveInlineDiffTestHooks.getInlineDiffViewModeToggleIconName('unified')).toBe('split')
  })

  it('projects the current-side render envelope back to original lines', () => {
    const { modifiedDoc, originalDoc } = createScenarioDocs()
    const originalParagraph = originalDoc.line(59)
    const modifiedHeading = modifiedDoc.line(58)
    const modifiedParagraph = modifiedDoc.line(59)
    const chunk: CodeMirrorDiffChunk = {
      changes: [],
      endA: originalParagraph.to,
      endB: modifiedParagraph.to,
      fromA: originalParagraph.from,
      fromB: modifiedHeading.from,
      toA: originalParagraph.to,
      toB: modifiedParagraph.to,
      vscodeModifiedEndLineExclusive: 60,
      vscodeModifiedStartLine: 58,
      vscodeOriginalEndLineExclusive: 60,
      vscodeOriginalStartLine: 59,
    }

    const match = __meoLiveInlineDiffTestHooks.findInlineChunkMatch(
      originalDoc,
      modifiedDoc,
      [chunk],
      59,
    )

    expect(match?.selection).toEqual({
      modifiedLineCount: 2,
      modifiedStartLine: 58,
      originalLineCount: 1,
      originalStartLine: 59,
    })
    expect(match?.displaySelection).toEqual({
      modifiedLineCount: 2,
      modifiedStartLine: 58,
      originalLineCount: 2,
      originalStartLine: 58,
    })
  })

  it('keeps adjacent refreshed chunks in separate inline split widgets', () => {
    const { modifiedDoc, originalDoc } = createScenarioDocs()
    const originalHeading = originalDoc.line(58)
    const originalParagraph = originalDoc.line(59)
    const modifiedHeading = modifiedDoc.line(58)
    const modifiedParagraph = modifiedDoc.line(59)
    const chunks: CodeMirrorDiffChunk[] = [
      {
        changes: [],
        endA: originalHeading.to,
        endB: modifiedHeading.to,
        fromA: originalHeading.from,
        fromB: modifiedHeading.from,
        toA: originalHeading.to,
        toB: modifiedHeading.to,
        vscodeModifiedEndLineExclusive: 59,
        vscodeModifiedStartLine: 58,
        vscodeOriginalEndLineExclusive: 59,
        vscodeOriginalStartLine: 58,
      },
      {
        changes: [],
        endA: originalParagraph.to,
        endB: modifiedParagraph.to,
        fromA: originalParagraph.from,
        fromB: modifiedParagraph.from,
        toA: originalParagraph.to,
        toB: modifiedParagraph.to,
        vscodeModifiedEndLineExclusive: 60,
        vscodeModifiedStartLine: 59,
        vscodeOriginalEndLineExclusive: 60,
        vscodeOriginalStartLine: 59,
      },
    ]

    const match = __meoLiveInlineDiffTestHooks.findInlineChunkMatch(
      originalDoc,
      modifiedDoc,
      chunks,
      59,
    )

    expect(match?.selection).toEqual({
      modifiedLineCount: 1,
      modifiedStartLine: 59,
      originalLineCount: 1,
      originalStartLine: 59,
    })
    expect(match?.displaySelection).toEqual(match?.selection)
  })

  it('keeps overlapping refreshed chunks in one inline split widget', () => {
    const { modifiedDoc, originalDoc } = createScenarioDocs()
    const originalHeading = originalDoc.line(58)
    const originalParagraph = originalDoc.line(59)
    const modifiedHeading = modifiedDoc.line(58)
    const modifiedParagraph = modifiedDoc.line(59)
    const chunks: CodeMirrorDiffChunk[] = [
      {
        changes: [],
        endA: originalParagraph.to,
        endB: modifiedHeading.to,
        fromA: originalHeading.from,
        fromB: modifiedHeading.from,
        toA: originalParagraph.to,
        toB: modifiedHeading.to,
        vscodeModifiedEndLineExclusive: 59,
        vscodeModifiedStartLine: 58,
        vscodeOriginalEndLineExclusive: 60,
        vscodeOriginalStartLine: 58,
      },
      {
        changes: [],
        endA: originalParagraph.to,
        endB: modifiedParagraph.to,
        fromA: originalParagraph.from,
        fromB: modifiedHeading.from,
        toA: originalParagraph.to,
        toB: modifiedParagraph.to,
        vscodeModifiedEndLineExclusive: 60,
        vscodeModifiedStartLine: 58,
        vscodeOriginalEndLineExclusive: 60,
        vscodeOriginalStartLine: 59,
      },
    ]

    const match = __meoLiveInlineDiffTestHooks.findInlineChunkMatch(
      originalDoc,
      modifiedDoc,
      chunks,
      59,
    )

    expect(match?.selection).toEqual({
      modifiedLineCount: 2,
      modifiedStartLine: 58,
      originalLineCount: 2,
      originalStartLine: 58,
    })
    expect(match?.displaySelection).toEqual(match?.selection)
  })

  it('keeps the refreshed markdown block envelope with real diff chunks', () => {
    const { modifiedDoc, originalDoc } = createScenarioDocs()
    const chunks = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc) as readonly CodeMirrorDiffChunk[]

    const match = __meoLiveInlineDiffTestHooks.findInlineChunkMatch(
      originalDoc,
      modifiedDoc,
      chunks,
      59,
    )

    expect(match?.displaySelection).toEqual({
      modifiedLineCount: 2,
      modifiedStartLine: 58,
      originalLineCount: 2,
      originalStartLine: 58,
    })
  })

  it('keeps the refreshed Chinese markdown heading and paragraph envelope', () => {
    const { modifiedDoc, originalDoc } = createChineseMarkdownScenarioDocs()
    const chunks = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc) as readonly CodeMirrorDiffChunk[]

    const match = __meoLiveInlineDiffTestHooks.findInlineChunkMatch(
      originalDoc,
      modifiedDoc,
      chunks,
      59,
    )

    expect(match?.displaySelection).toEqual({
      modifiedLineCount: 2,
      modifiedStartLine: 58,
      originalLineCount: 2,
      originalStartLine: 58,
    })
  })

  it('matches pure insertion gutter hunk ids to inline split chunks', () => {
    const originalDoc = Text.of('A\nC\n'.split('\n'))
    const modifiedDoc = Text.of('A\nB\nC\n'.split('\n'))
    const chunks = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc) as readonly CodeMirrorDiffChunk[]
    const requestedHunkId = createGitDiffLineHunkId(2, 2, 2, 3)

    const match = __meoLiveInlineDiffTestHooks.findInlineChunkMatch(
      originalDoc,
      modifiedDoc,
      chunks,
      2,
      requestedHunkId,
    )

    expect(match?.selection).toEqual({
      modifiedLineCount: 1,
      modifiedStartLine: 2,
      originalLineCount: 0,
      originalStartLine: 1,
    })
    expect(match?.displaySelection).toEqual({
      modifiedLineCount: 1,
      modifiedStartLine: 2,
      originalLineCount: 0,
      originalStartLine: 1,
    })
  })

  it('projects pure insertion split chunks without pulling the next line into inline split', () => {
    const originalDoc = Text.of([
      'line 18',
      'line 20',
    ])
    const modifiedDoc = Text.of([
      'line 18',
      'line 19 inserted',
      'line 20',
    ])
    const chunks = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc) as readonly CodeMirrorDiffChunk[]
    const match = __meoLiveInlineDiffTestHooks.findInlineChunkMatch(
      originalDoc,
      modifiedDoc,
      chunks,
      2,
      createGitDiffLineHunkId(2, 2, 2, 3),
    )

    expect(match?.displaySelection).toEqual({
      modifiedLineCount: 1,
      modifiedStartLine: 2,
      originalLineCount: 0,
      originalStartLine: 1,
    })
    expect(modifiedDoc.sliceString(modifiedDoc.line(2).from, modifiedDoc.line(2).to)).toBe('line 19 inserted')

    const [inlineChunk] = __meoLiveInlineDiffTestHooks.translateInlineDiffChunks(
      originalDoc,
      modifiedDoc,
      match?.chunks ?? [],
      match!.displaySelection,
    )
    expect(inlineChunk).toMatchObject({
      fromA: 0,
      fromB: 0,
      toA: 0,
      toB: 'line 19 inserted\n'.length,
    })
  })

  it('matches pure deletion gutter hunk ids to inline split chunks', () => {
    const originalDoc = Text.of('A\nB\nC\n'.split('\n'))
    const modifiedDoc = Text.of('A\nC\n'.split('\n'))
    const chunks = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc) as readonly CodeMirrorDiffChunk[]
    const requestedHunkId = createGitDiffLineHunkId(2, 3, 2, 2)

    const match = __meoLiveInlineDiffTestHooks.findInlineChunkMatch(
      originalDoc,
      modifiedDoc,
      chunks,
      1,
      requestedHunkId,
    )

    expect(match?.selection).toEqual({
      modifiedLineCount: 0,
      modifiedStartLine: 1,
      originalLineCount: 1,
      originalStartLine: 2,
    })
    expect(match?.displaySelection).toEqual({
      modifiedLineCount: 0,
      modifiedStartLine: 1,
      originalLineCount: 1,
      originalStartLine: 2,
    })
  })

  it('places zero-width inline deletion widgets before the next line', () => {
    const doc = Text.of([
      'A',
      'C',
    ])

    expect(__meoLiveInlineDiffTestHooks.getInlineWidgetSide(
      doc,
      doc.line(2).from,
      doc.line(2).from,
    )).toBe(-1)
  })

  it('hides only the outer git marker for the active inline hunk id', () => {
    const originalHTMLElement = globalThis.HTMLElement

    class FakeHTMLElement {
      private readonly classes = new Set<string>()
      children: FakeHTMLElement[] = []
      dataset: Record<string, string> = {}
      parent: FakeHTMLElement | null = null

      constructor(className = '') {
        this.className = className
      }

      get className() {
        return Array.from(this.classes).join(' ')
      }

      set className(value: string) {
        this.classes.clear()
        for (const token of value.split(/\s+/)) {
          if (token) this.classes.add(token)
        }
      }

      classList = {
        add: (...tokens: string[]) => {
          for (const token of tokens) this.classes.add(token)
        },
        contains: (token: string) => this.classes.has(token),
        remove: (...tokens: string[]) => {
          for (const token of tokens) this.classes.delete(token)
        },
        toggle: (token: string, force?: boolean) => {
          const shouldAdd = force ?? !this.classes.has(token)
          if (shouldAdd) {
            this.classes.add(token)
          } else {
            this.classes.delete(token)
          }
          return shouldAdd
        },
      }

      append(...children: FakeHTMLElement[]) {
        for (const child of children) {
          child.parent = this
          this.children.push(child)
        }
      }

      closest(selector: string) {
        if (selector === '.meo-live-inline-diff') {
          return this.classes.has('meo-live-inline-diff')
            ? this
            : this.parent?.closest(selector) ?? null
        }
        if (selector === '.meo-git-gutter-marker') {
          return this.classes.has('meo-git-gutter-marker')
            ? this
            : this.parent?.closest(selector) ?? null
        }
        return null
      }

      querySelectorAll(selector: string) {
        const matches: FakeHTMLElement[] = []
        const visit = (node: FakeHTMLElement) => {
          if (selector === '.meo-git-gutter-marker' && node.classList.contains('meo-git-gutter-marker')) {
            matches.push(node)
          }
          for (const child of node.children) visit(child)
        }
        visit(this)
        return matches
      }
    }

    Object.defineProperty(globalThis, 'HTMLElement', {
      configurable: true,
      writable: true,
      value: FakeHTMLElement,
    })

    try {
      const root = new FakeHTMLElement()
      const activeMarker = new FakeHTMLElement('meo-git-gutter-marker is-deleted')
      activeMarker.dataset.meoGitHunkDeleted = JSON.stringify({
        d: 'git-diff:21:22:21:21',
        e: 20,
        i: 'git-diff:21:22:21:21',
        s: 20,
      })
      const similarMarker = new FakeHTMLElement('meo-git-gutter-marker is-deleted')
      similarMarker.dataset.meoGitHunkDeleted = JSON.stringify({
        d: 'git-diff:21:22:21:210',
        e: 200,
        i: 'git-diff:21:22:21:210',
        s: 200,
      })
      const inlineContainer = new FakeHTMLElement('meo-live-inline-diff')
      const inlineMarker = new FakeHTMLElement('meo-git-gutter-marker is-deleted')
      inlineMarker.dataset.meoGitHunkDeleted = activeMarker.dataset.meoGitHunkDeleted
      inlineContainer.append(inlineMarker)
      root.append(activeMarker, similarMarker, inlineContainer)

      __meoLiveInlineDiffTestHooks.setActiveInlineHunkIds(root as unknown as HTMLElement, [{
        hunkId: 'git-diff:21:22:21:21',
      } as never])

      expect(activeMarker.classList.contains('is-live-inline-active-hunk')).toBe(true)
      expect(similarMarker.classList.contains('is-live-inline-active-hunk')).toBe(false)
      expect(inlineMarker.classList.contains('is-live-inline-active-hunk')).toBe(false)

      __meoLiveInlineDiffTestHooks.setActiveInlineHunkIds(root as unknown as HTMLElement, [])

      expect(activeMarker.classList.contains('is-live-inline-active-hunk')).toBe(false)
    } finally {
      Object.defineProperty(globalThis, 'HTMLElement', {
        configurable: true,
        writable: true,
        value: originalHTMLElement,
      })
    }
  })

  it('maps an outer live caret inside a refreshed hunk to the inline modified editor', () => {
    const lines = Array.from({ length: 62 }, (_, index) => `line ${index + 1}`)
    lines[57] = '## 9. Math formulasaa'
    lines[58] = 'Markdown supports LaTeX formulas. extra'

    const outerDoc = Text.of(lines)
    const line58 = outerDoc.line(58)
    const line59 = outerDoc.line(59)
    const inlineDoc = Text.of([line58.text, line59.text])
    const cursor = line58.to

    const target = __meoLiveInlineDiffTestHooks.createModifiedSelectionTarget(
      outerDoc,
      {
        modifiedText: inlineDoc.toString(),
        replaceFrom: line58.from,
        replaceTo: line59.to,
      },
      { anchor: cursor, head: cursor },
    )

    expect(target).toEqual({
      anchor: {
        column: line58.text.length,
        lineOffset: 0,
      },
      head: {
        column: line58.text.length,
        lineOffset: 0,
      },
    })
    expect(__meoLiveInlineDiffTestHooks.resolveModifiedSelectionTargetOffsets(inlineDoc, target!)).toEqual({
      anchor: inlineDoc.line(1).to,
      head: inlineDoc.line(1).to,
    })
  })

  it('restores an inline caret to the outer editor when its line leaves the refreshed hunk', () => {
    const lines = Array.from({ length: 62 }, (_, index) => `line ${index + 1}`)
    lines[57] = '## 9. Math formulasaa'
    lines[58] = 'Markdown supports LaTeX formulas.'

    const outerDoc = Text.of(lines)
    const line58 = outerDoc.line(58)
    const line59 = outerDoc.line(59)
    const nextInlineDoc = Text.of([line58.text, line59.text])
    const inlineCursor = nextInlineDoc.line(2).to

    const outerTarget = __meoLiveInlineDiffTestHooks.createOuterSelectionTargetFromInlineSelection(
      line58.from,
      nextInlineDoc.toString(),
      { anchor: inlineCursor, head: inlineCursor },
    )

    expect(__meoLiveInlineDiffTestHooks.createModifiedSelectionTarget(
      outerDoc,
      {
        modifiedText: line58.text,
        replaceFrom: line58.from,
        replaceTo: line58.to,
      },
      outerTarget,
    )).toBeNull()

    const restoredSelection = __meoLiveInlineDiffTestHooks.resolveOuterEditorSelection(outerDoc, outerTarget)
    expect({
      anchor: restoredSelection.main.anchor,
      head: restoredSelection.main.head,
    }).toEqual({
      anchor: line59.to,
      head: line59.to,
    })
  })
})
