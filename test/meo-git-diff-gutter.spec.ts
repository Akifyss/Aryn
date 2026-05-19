import { EditorState, Text, Transaction } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { splitDiffLines } from '../src/vendor/meo/shared/gitDiffCore'
import {
  buildLineFlagsFromVsCodeDiff,
  buildScopedLineFlagsFromVsCodeDiff,
} from '../src/vendor/meo/shared/gitDiffLineFlags'
import {
  __gitDiffGutterTestHooks,
  gitDiffGutterBaselineExtensions,
  gitDiffLineFlagsField,
  refreshGitDiffLineFlagsEffect,
  setGitBaselineEffect,
} from '../src/vendor/meo/webview/helpers/gitDiffGutter'

function flagSummary(flags: ReturnType<typeof buildLineFlagsFromVsCodeDiff>) {
  return Array.from(flags, (flag) => {
    if (flag?.deleted) return 'deleted'
    if (flag?.modified) return 'modified'
    if (flag?.added) return 'added'
    return null
  })
}

function scopedFlagSummary(flags: ReturnType<typeof buildScopedLineFlagsFromVsCodeDiff>) {
  return Array.from(flags, (flag) => {
    if (flag?.deleted) return `${flag.scope}:deleted`
    if (flag?.modified) return `${flag.scope}:modified`
    if (flag?.added) return `${flag.scope}:added`
    return null
  })
}

function hunkIdsByKind(flags: ReturnType<typeof buildLineFlagsFromVsCodeDiff>) {
  return Array.from(flags, (flag) => ({
    added: flag?.hunks?.added?.hunkId,
    deleted: flag?.hunks?.deleted?.hunkId,
    modified: flag?.hunks?.modified?.hunkId,
  }))
}

describe('meo git diff gutter', () => {
  it('tracks the hit segment kind and hunk when a marker has both addition and deletion visuals', () => {
    const originalHTMLElement = globalThis.HTMLElement
    const originalElement = globalThis.Element
    class FakeHTMLElement {
      private readonly classes = new Set<string>(['meo-git-gutter-marker', 'is-added', 'is-deleted'])
      children: FakeHTMLElement[] = []
      dataset: Record<string, string> = {}
      parent: FakeHTMLElement | null = null

      classList = {
        add: (...tokens: string[]) => {
          for (const token of tokens) this.classes.add(token)
        },
        contains: (token: string) => this.classes.has(token),
        remove: (...tokens: string[]) => {
          for (const token of tokens) this.classes.delete(token)
        },
      }

      append(child: FakeHTMLElement) {
        child.parent = this
        this.children.push(child)
      }

      closest(selector: string) {
        if (selector === '.cm-gutter.meo-git-gutter') {
          return this.classes.has('cm-gutter') && this.classes.has('meo-git-gutter')
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

      getBoundingClientRect() {
        return {
          bottom: 24,
          height: 20,
          left: 0,
          right: 3,
          top: 4,
          width: 3,
          x: 0,
          y: 4,
          toJSON: () => ({}),
        } as DOMRect
      }

      querySelectorAll(selector: string) {
        const matches: FakeHTMLElement[] = []
        const visit = (node: FakeHTMLElement) => {
          if (
            selector === '.meo-git-gutter-marker' &&
            node.classList.contains('meo-git-gutter-marker')
          ) {
            matches.push(node)
          }
          for (const child of node.children) visit(child)
        }
        visit(this)
        return matches
      }
    }

    Object.defineProperty(globalThis, 'Element', {
      configurable: true,
      writable: true,
      value: FakeHTMLElement,
    })
    Object.defineProperty(globalThis, 'HTMLElement', {
      configurable: true,
      writable: true,
      value: FakeHTMLElement,
    })

    try {
      const gutter = new FakeHTMLElement()
      gutter.classList.add('cm-gutter', 'meo-git-gutter')
      const marker = new FakeHTMLElement()
      marker.dataset.meoGitHunkAdded = JSON.stringify({ d: 'diff-add-hunk', i: 'add-hunk', s: 19, e: 19 })
      marker.dataset.meoGitHunkDeleted = JSON.stringify({ d: 'diff-delete-hunk', i: 'delete-hunk', s: 20, e: 20 })
      const sameDeleteHunk = new FakeHTMLElement()
      sameDeleteHunk.classList.remove('is-added')
      sameDeleteHunk.dataset.meoGitHunkDeleted = JSON.stringify({ i: 'delete-hunk', s: 20, e: 20 })
      const otherAddHunk = new FakeHTMLElement()
      otherAddHunk.classList.remove('is-deleted')
      otherAddHunk.dataset.meoGitHunkAdded = JSON.stringify({ i: 'add-hunk', s: 19, e: 19 })
      gutter.append(marker)
      gutter.append(sameDeleteHunk)
      gutter.append(otherAddHunk)

      expect(__gitDiffGutterTestHooks.getGitGutterMarkerChangeKindAt(marker as unknown as HTMLElement, 10)).toBe('added')
      expect(__gitDiffGutterTestHooks.getGitGutterMarkerChangeKindAt(marker as unknown as HTMLElement, 23)).toBe('deleted')
      sameDeleteHunk.getBoundingClientRect = () => ({
        bottom: 48,
        height: 20,
        left: 0,
        right: 3,
        top: 28,
        width: 3,
        x: 0,
        y: 28,
        toJSON: () => ({}),
      }) as DOMRect
      expect(__gitDiffGutterTestHooks.getGitGutterMarkerChangeKindAt(sameDeleteHunk as unknown as HTMLElement, 30)).toBe(null)
      expect(__gitDiffGutterTestHooks.getGitGutterMarkerChangeKindAt(sameDeleteHunk as unknown as HTMLElement, 47)).toBe('deleted')
      expect(__gitDiffGutterTestHooks.getGitGutterMarkerHunkMetadata(marker as unknown as HTMLElement, 'added')?.hunkId).toBe('add-hunk')
      expect(__gitDiffGutterTestHooks.getGitGutterMarkerHunkMetadata(marker as unknown as HTMLElement, 'deleted')?.hunkId).toBe('delete-hunk')
      expect(__gitDiffGutterTestHooks.getGitGutterMarkerHunkMetadata(marker as unknown as HTMLElement, 'added')?.diffHunkId).toBe('diff-add-hunk')
      expect(__gitDiffGutterTestHooks.getGitGutterMarkerHunkMetadata(marker as unknown as HTMLElement, 'deleted')?.diffHunkId).toBe('diff-delete-hunk')
      const deletedMarkers = __gitDiffGutterTestHooks.getGitGutterHunkMarkers(marker as unknown as HTMLElement, 'deleted')
      const addedMarkers = __gitDiffGutterTestHooks.getGitGutterHunkMarkers(marker as unknown as HTMLElement, 'added')
      expect(deletedMarkers).toHaveLength(2)
      expect(deletedMarkers.includes(marker as unknown as HTMLElement)).toBe(true)
      expect(deletedMarkers.includes(sameDeleteHunk as unknown as HTMLElement)).toBe(true)
      expect(addedMarkers).toHaveLength(2)
      expect(addedMarkers.includes(marker as unknown as HTMLElement)).toBe(true)
      expect(addedMarkers.includes(otherAddHunk as unknown as HTMLElement)).toBe(true)

      __gitDiffGutterTestHooks.addGitHunkHoverClasses(marker as unknown as HTMLElement, 'deleted')

      expect(marker.classList.contains('is-hunk-hover')).toBe(true)
      expect(marker.classList.contains('is-hunk-hover-deleted')).toBe(true)
      expect(marker.classList.contains('is-hunk-hover-added')).toBe(false)

      __gitDiffGutterTestHooks.removeGitHunkHoverClasses(marker as unknown as HTMLElement)
      expect(marker.classList.contains('is-hunk-hover')).toBe(false)
    } finally {
      Object.defineProperty(globalThis, 'Element', {
        configurable: true,
        writable: true,
        value: originalElement,
      })
      Object.defineProperty(globalThis, 'HTMLElement', {
        configurable: true,
        writable: true,
        value: originalHTMLElement,
      })
    }
  })

  it('assigns one hover hunk id to adjacent changed gutter lines regardless of change kind', () => {
    const withHunks = __gitDiffGutterTestHooks.addGitHunkMetadataToLineFlags([
      { added: true, deleted: false, modified: false, scope: 'unstaged' },
      { added: false, deleted: false, modified: true, scope: 'unstaged' },
      undefined,
      { added: true, deleted: false, modified: false, scope: 'unstaged' },
    ])

    expect(withHunks?.[0]?.hunkId).toBe(withHunks?.[1]?.hunkId)
    expect(withHunks?.[0]?.hunkStartLine).toBe(1)
    expect(withHunks?.[0]?.hunkEndLine).toBe(2)
    expect(withHunks?.[2]).toBeUndefined()
    expect(withHunks?.[3]?.hunkId).not.toBe(withHunks?.[0]?.hunkId)
    expect(withHunks?.[3]?.hunkStartLine).toBe(4)
    expect(withHunks?.[3]?.hunkEndLine).toBe(4)
  })

  it('keeps adjacent staged and unstaged gutter lines in separate hover hunks', () => {
    const withHunks = __gitDiffGutterTestHooks.addGitHunkMetadataToLineFlags([
      { added: false, deleted: false, modified: true, scope: 'staged' },
      { added: false, deleted: false, modified: true, scope: 'unstaged' },
    ])

    expect(withHunks?.[0]?.hunkId).not.toBe(withHunks?.[1]?.hunkId)
    expect(withHunks?.[0]?.hunkStartLine).toBe(1)
    expect(withHunks?.[0]?.hunkEndLine).toBe(1)
    expect(withHunks?.[1]?.hunkStartLine).toBe(2)
    expect(withHunks?.[1]?.hunkEndLine).toBe(2)
  })

  it('keeps adjacent explicit gutter hunk ids separate', () => {
    const withHunks = __gitDiffGutterTestHooks.addGitHunkMetadataToLineFlags([
      { added: true, deleted: false, hunkEndLine: 1, hunkId: 'chunk-a', hunkStartLine: 1, modified: false, scope: 'unstaged' },
      { added: true, deleted: false, hunkEndLine: 2, hunkId: 'chunk-b', hunkStartLine: 2, modified: false, scope: 'unstaged' },
    ])

    expect(withHunks?.[0]?.hunkId).toBe('chunk-a')
    expect(withHunks?.[1]?.hunkId).toBe('chunk-b')
    expect(withHunks?.[0]?.hunkId).not.toBe(withHunks?.[1]?.hunkId)
  })

  it('keeps adjacent explicit per-kind gutter hunk ids separate', () => {
    const withHunks = __gitDiffGutterTestHooks.addGitHunkMetadataToLineFlags([
      {
        added: true,
        deleted: true,
        hunkEndLine: 1,
        hunkId: 'add-hunk',
        hunkStartLine: 1,
        hunks: {
          added: { diffHunkId: 'diff-add-hunk', hunkEndLine: 1, hunkId: 'add-hunk', hunkStartLine: 1 },
          deleted: { diffHunkId: 'diff-delete-hunk', hunkEndLine: 1, hunkId: 'delete-hunk', hunkStartLine: 1 },
        },
        modified: false,
        scope: 'unstaged',
      },
      {
        added: false,
        deleted: true,
        hunkEndLine: 2,
        hunkId: 'delete-hunk',
        hunkStartLine: 2,
        hunks: {
          deleted: { hunkEndLine: 2, hunkId: 'delete-hunk', hunkStartLine: 2 },
        },
        modified: false,
        scope: 'unstaged',
      },
    ])

    expect(withHunks?.[0]?.hunks?.added?.hunkId).toBe('add-hunk')
    expect(withHunks?.[0]?.hunks?.deleted?.hunkId).toBe('delete-hunk')
    expect(withHunks?.[0]?.hunks?.added?.diffHunkId).toBe('diff-add-hunk')
    expect(withHunks?.[0]?.hunks?.deleted?.diffHunkId).toBe('diff-delete-hunk')
    expect(withHunks?.[1]?.hunks?.deleted?.hunkId).toBe('delete-hunk')
    expect(withHunks?.[1]?.hunks?.added).toBeUndefined()
  })

  it('keeps insertion and deletion hunk metadata separate when they share one current line marker', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\nD\n'),
      Text.of('A\nX\nB\nD\n'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      null,
      'added',
      'deleted',
      null,
      null,
    ])
    expect(flags[1]?.hunks?.added?.hunkId).toEqual(expect.any(String))
    expect(flags[1]?.hunks?.added?.diffHunkId).toBe(flags[1]?.hunks?.added?.hunkId)
    expect(flags[1]?.hunks?.deleted).toBeUndefined()
    expect(flags[2]?.hunks?.deleted?.hunkId).toEqual(expect.any(String))
    expect(flags[2]?.hunks?.deleted?.diffHunkId).toBe(flags[2]?.hunks?.deleted?.hunkId)
    expect(flags[1]?.hunks?.added?.hunkId).not.toBe(flags[2]?.hunks?.deleted?.hunkId)
    expect(hunkIdsByKind(flags)[1]?.added).toBe(flags[1]?.hunks?.added?.hunkId)
  })

  it('matches VS Code-style line ranges for blank lines inserted before the EOF visual line', () => {
    const baseText = 'L1\nL2\nL3\n'
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines(baseText),
      Text.of(`${baseText}\n\n\n`.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      null,
      null,
      null,
      'added',
      'added',
      'added',
      null,
    ])
  })

  it('moves trailing newline insertions after a no-final-newline last line onto the new blank lines', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines('A'),
      Text.of('A\n\n\n'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      null,
      'added',
      'added',
      'added',
    ])
  })

  it('marks a middle inserted blank line as added', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      Text.of('A\nB\n\nC\n'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      null,
      null,
      'added',
      null,
      null,
    ])
  })

  it('does not mark pushed-down content when blank lines are inserted before it', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      [
        '# Tab',
        '',
        '- A',
        '- B',
        '- C',
        '## Project',
        '-',
      ],
      Text.of([
        '# Tab',
        '',
        '- A',
        '- B',
        '- C',
        '',
        '',
        '## Project',
        '-',
      ]),
    )

    expect(flagSummary(flags)).toEqual([
      null,
      null,
      null,
      null,
      null,
      'added',
      'added',
      null,
      null,
    ])
  })

  it('marks replaced current lines as modified', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      Text.of('A\nX\nC\n'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      null,
      'modified',
      null,
      null,
    ])
  })

  it('keeps native live gutter markers for normal block widgets', () => {
    let state = EditorState.create({
      doc: 'A\nX\nC\n',
      extensions: gitDiffGutterBaselineExtensions(),
    })
    state = state.update({
      effects: setGitBaselineEffect.of({
        available: true,
        baseText: 'A\nB\nC\n',
        headOid: 'HEAD',
        indexText: null,
        tracked: true,
      }),
    }).state

    const line = state.doc.line(2)
    const marker = __gitDiffGutterTestHooks.liveWidgetMarkerAtPos(
      state,
      state.field(gitDiffLineFlagsField),
      {},
      line.from,
    ) as { flags?: { modified?: boolean, scope?: string } } | null

    expect(marker?.flags?.modified).toBe(true)
    expect(marker?.flags?.scope).toBe('unstaged')
  })

  it('lets unified deleted widgets override the live gutter marker color', () => {
    let state = EditorState.create({
      doc: 'A\nX\nC\n',
      extensions: gitDiffGutterBaselineExtensions(),
    })
    state = state.update({
      effects: setGitBaselineEffect.of({
        available: true,
        baseText: 'A\nB\nC\n',
        headOid: 'HEAD',
        indexText: null,
        tracked: true,
      }),
    }).state

    const line = state.doc.line(2)
    const marker = __gitDiffGutterTestHooks.liveWidgetMarkerAtPos(
      state,
      state.field(gitDiffLineFlagsField),
      { marksDeletedLines: true },
      line.from,
      undefined,
      (flags, context) => context.widget?.marksDeletedLines
        ? {
            added: false,
            deleted: false,
            modified: false,
            removed: true,
            scope: flags?.scope ?? 'unstaged',
          }
        : undefined,
    ) as { flags?: { added?: boolean, removed?: boolean, scope?: string } } | null

    expect(marker?.flags?.removed).toBe(true)
    expect(marker?.flags?.added).toBe(false)
    expect(marker?.flags?.scope).toBe('unstaged')
  })

  it('keeps unified deleted widget markers in the same hover hunk as the changed line', () => {
    let state = EditorState.create({
      doc: 'A\nX\nC\n',
      extensions: gitDiffGutterBaselineExtensions(),
    })
    state = state.update({
      effects: setGitBaselineEffect.of({
        available: true,
        baseText: 'A\nB\nC\n',
        headOid: 'HEAD',
        indexText: null,
        tracked: true,
      }),
    }).state

    const flags = state.field(gitDiffLineFlagsField)
    const line = state.doc.line(2)
    const marker = __gitDiffGutterTestHooks.liveWidgetMarkerAtPos(
      state,
      flags,
      { marksDeletedLines: true },
      line.from,
      undefined,
      (lineFlags, context) => context.widget?.marksDeletedLines
        ? {
            added: false,
            deleted: false,
            modified: false,
            removed: true,
            scope: lineFlags?.scope ?? 'unstaged',
          }
        : undefined,
    ) as { flags?: { hunkId?: string, removed?: boolean } } | null

    expect(marker?.flags?.removed).toBe(true)
    expect(marker?.flags?.hunkId).toBe(flags?.[1]?.hunkId)
  })

  it('uses the collapsed block aggregate kind when selecting live hunk metadata', () => {
    let state = EditorState.create({
      doc: '| A |\n| - |\n| B |\n',
      extensions: gitDiffGutterBaselineExtensions(),
    })
    state = state.update({
      effects: __gitDiffGutterTestHooks.setGitDiffLineFlagsEffect.of([
        {
          added: true,
          deleted: true,
          hunkEndLine: 1,
          hunkId: 'added-hunk',
          hunkStartLine: 1,
          hunks: {
            added: { diffHunkId: 'diff-added-hunk', hunkEndLine: 1, hunkId: 'added-hunk', hunkStartLine: 1 },
            deleted: { diffHunkId: 'diff-deleted-hunk', hunkEndLine: 1, hunkId: 'deleted-hunk', hunkStartLine: 1 },
          },
          modified: false,
          scope: 'unstaged',
        },
        undefined,
        undefined,
        undefined,
      ]),
    }).state

    const line = state.doc.line(1)
    const marker = __gitDiffGutterTestHooks.liveCollapsedBlockMarkerAtPos(
      state,
      state.field(gitDiffLineFlagsField),
      line.from,
    ) as { flags?: { hunks?: { deleted?: { diffHunkId?: string, hunkId?: string } }, hunkId?: string } } | null

    expect(marker?.flags?.hunkId).toBe('deleted-hunk')
    expect(marker?.flags?.hunks?.deleted?.hunkId).toBe('deleted-hunk')
    expect(marker?.flags?.hunks?.deleted?.diffHunkId).toBe('diff-deleted-hunk')
  })

  it('lets unified pure deletion widgets render a red marker without a modified line flag', () => {
    const state = EditorState.create({
      doc: 'A\nC\n',
      extensions: gitDiffGutterBaselineExtensions(),
    })
    const line = state.doc.line(2)
    const marker = __gitDiffGutterTestHooks.liveWidgetMarkerAtPos(
      state,
      null,
      { marksDeletedLines: true },
      line.from,
      undefined,
      (_flags, context) => context.widget?.marksDeletedLines
        ? {
            added: false,
            deleted: false,
            modified: false,
            removed: true,
            scope: 'unstaged',
          }
        : undefined,
    ) as { flags?: { removed?: boolean, scope?: string } } | null

    expect(marker?.flags?.removed).toBe(true)
    expect(marker?.flags?.scope).toBe('unstaged')
  })

  it('lets inline split diff widgets own their own gutter row', () => {
    let state = EditorState.create({
      doc: 'A\nX\nC\n',
      extensions: gitDiffGutterBaselineExtensions(),
    })
    state = state.update({
      effects: setGitBaselineEffect.of({
        available: true,
        baseText: 'A\nB\nC\n',
        headOid: 'HEAD',
        indexText: null,
        tracked: true,
      }),
    }).state

    const line = state.doc.line(2)
    const marker = __gitDiffGutterTestHooks.liveWidgetMarkerAtPos(
      state,
      state.field(gitDiffLineFlagsField),
      { isMeoLiveInlineDiffWidget: true },
      line.from,
    )

    expect(marker).toBeNull()
  })

  it('anchors middle pure deletions to the previous current line like VS Code', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      Text.of('A\nC\n'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      'deleted',
      null,
      null,
    ])
  })

  it('anchors leading pure deletions to the first current line bottom edge like VS Code', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      Text.of('B\nC\n'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      'deleted',
      null,
      null,
    ])
  })

  it('anchors trailing pure deletions to the last remaining current line', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      Text.of('A\nB\n'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      null,
      'deleted',
      null,
    ])
  })

  it('matches VS Code anchors for leading and mid-file deletion blocks', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      [
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'test',
        '',
        '',
        '',
        'Agent',
      ],
      Text.of([
        '',
        '',
        '',
        '',
        '',
        'test',
        '',
        'Agent',
      ]),
    )

    expect(flagSummary(flags)).toEqual([
      'deleted',
      null,
      null,
      null,
      null,
      'deleted',
      null,
      null,
    ])
  })

  it('marks whitespace-only line edits as modified like VS Code', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      Text.of('A\nB  \nC\n'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      null,
      'modified',
      null,
      null,
    ])
  })

  it('keeps an all-content deletion visible on the remaining empty visual line', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines('hello'),
      Text.of(''.split('\n')),
    )

    expect(flagSummary(flags)).toEqual(['modified'])
  })

  it('marks final newline insertions on the EOF visual line', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines('A'),
      Text.of('A\n'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      null,
      'added',
    ])
  })

  it('keeps a single inserted EOF blank line added in meo gutter state', () => {
    const initialState = EditorState.create({
      doc: '\n\ntest\n',
      extensions: gitDiffGutterBaselineExtensions(),
    })
    const transaction = initialState.update({
      effects: setGitBaselineEffect.of({
        available: true,
        baseText: '\n\ntest',
        headOid: 'HEAD',
        indexText: null,
        tracked: true,
      }),
    })

    expect(flagSummary(transaction.state.field(gitDiffLineFlagsField))).toEqual([
      null,
      null,
      null,
      'added',
    ])
  })

  it('refreshes git gutter flags after deferred IME composition edits', () => {
    let state = EditorState.create({
      doc: 'A\nB\nC\n',
      extensions: gitDiffGutterBaselineExtensions(),
    })
    state = state.update({
      effects: setGitBaselineEffect.of({
        available: true,
        baseText: 'A\nB\nC\n',
        headOid: 'HEAD',
        indexText: null,
        tracked: true,
      }),
    }).state

    const previousFlags = state.field(gitDiffLineFlagsField)
    const line = state.doc.line(2)
    const composedState = state.update({
      changes: { from: line.to, insert: ' changed' },
      annotations: Transaction.userEvent.of('input.type.compose'),
    }).state

    expect(composedState.field(gitDiffLineFlagsField)).toBe(previousFlags)

    const refreshedState = composedState.update({
      effects: refreshGitDiffLineFlagsEffect.of(null),
    }).state

    expect(flagSummary(refreshedState.field(gitDiffLineFlagsField))).toEqual([
      null,
      'modified',
      null,
      null,
    ])
  })

  it('treats content added to an empty tracked file as added, not modified', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines(''),
      Text.of('hello'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual(['added'])
  })

  it('separates staged and unstaged gutter lines with unstaged taking precedence', () => {
    const flags = buildScopedLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      splitDiffLines('A staged\nB\nC\n'),
      Text.of('A staged\nB unstaged\nC\n'.split('\n')),
    )

    expect(scopedFlagSummary(flags)).toEqual([
      'staged:modified',
      'unstaged:modified',
      null,
      null,
    ])
  })

  it('maps staged lines onto working tree line numbers after unstaged insertions', () => {
    const flags = buildScopedLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      splitDiffLines('A staged\nB\nC\n'),
      Text.of('X unstaged\nA staged\nB\nC\n'.split('\n')),
    )

    expect(scopedFlagSummary(flags)).toEqual([
      'unstaged:added',
      'staged:modified',
      null,
      null,
      null,
    ])
  })

  it('marks unstaged pure deletions in scoped gutter state', () => {
    const flags = buildScopedLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      splitDiffLines('A\nB\nC\n'),
      Text.of('A\nC\n'.split('\n')),
    )

    expect(scopedFlagSummary(flags)).toEqual([
      'unstaged:deleted',
      null,
      null,
    ])
  })

  it('maps staged pure deletions onto the current worktree anchor line', () => {
    const flags = buildScopedLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      splitDiffLines('A\nC\n'),
      Text.of('A\nC\n'.split('\n')),
    )

    expect(scopedFlagSummary(flags)).toEqual([
      'staged:deleted',
      null,
      null,
    ])
  })
})
