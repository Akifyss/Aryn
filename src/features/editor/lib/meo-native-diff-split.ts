import { defaultKeymap, history, historyKeymap, indentLess, indentMore, redo, undo } from '@codemirror/commands'
import { markdownKeymap } from '@codemirror/lang-markdown'
import { bracketMatching, forceParsing, indentOnInput, indentUnit } from '@codemirror/language'
import { goToNextChunk, goToPreviousChunk, MergeView, refreshInlineChangeLayerEffect } from '@codemirror/merge'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Annotation, Compartment, EditorSelection, EditorState, type Extension, RangeSetBuilder, StateEffect, StateField, Text, Transaction } from '@codemirror/state'
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type ViewUpdate,
  ViewPlugin,
} from '@codemirror/view'
import type { GitBaselinePayload, GitChangeItem, GitChangeScope, GitDiffBlockAction, GitDiffSelection } from '@/features/git/types'
import { mountMeoBaseScrollArea } from '@/features/editor/lib/meo-base-scroll-area'
import type { MeoDiffSplitGitChangeContext, MeoEditorInsertFormat, MeoEditorViewportPosition } from '@/features/editor/lib/meo-native-editor-types'
import {
  createSelectionFromCodeMirrorChunk,
  findBestNavigationTarget,
  type CodeMirrorDiffChunk,
  type DiffNavigationSide,
} from '@/features/editor/lib/git-diff-navigation'
import { buildCodeMirrorChunksFromVsCodeDiff, buildSourceToTargetLineMap } from '@/vendor/meo/shared/gitDiffLineFlags'
import { insertCodeBlock } from '@/vendor/meo/webview/helpers/codeBlocks'
import { getLinkHrefAtPointer, isPrimaryModifierPointerClick } from '@/vendor/meo/webview/helpers/linkNavigation'
import {
  collectOrderedListRenumberChanges,
  handleArrowLeftAtListContentStart,
  handleArrowRightAtListLineStart,
  handleBackspaceAtListContentStart,
  handleEnterAtListContentStart,
  handleEnterBeforeNestedList,
  handleEnterContinueList,
  handleEnterOnEmptyListItem,
  indentListByTwoSpaces,
  listMarkerData,
  outdentListByTwoSpaces,
  shouldCollectOrderedListRenumberChanges,
} from '@/vendor/meo/webview/helpers/listMarkers'
import { extractHeadings, extractHeadingSections } from '@/vendor/meo/webview/helpers/markdownSyntax'
import { insertTable } from '@/vendor/meo/webview/helpers/tables'
import { liveModeExtensions, refreshLiveDecorationsEffect } from '@/vendor/meo/webview/liveMode'
import { expandAllCollapsibleSections } from '@/vendor/meo/webview/helpers/headingCollapse'
import { isRegularInlineSelection } from '@/vendor/meo/webview/helpers/selectionMenu'
import {
  gitDiffGutterBaselineExtensions,
  gitDiffGutterLiveRenderExtensions,
  setGitBaseline,
  setGitDiffLineFlags,
} from '@/vendor/meo/webview/helpers/gitDiffGutter'
import {
  createGitDiffOverviewRulerController,
  type GitDiffOverviewSegment,
} from '@/vendor/meo/webview/helpers/gitDiffOverviewRuler'

type MeoDiffSplitControllerOptions = {
  baseline: GitBaselinePayload | null
  diffGutterVisible: boolean
  editable?: boolean
  fallbackOriginalLabel: string
  fallbackOriginalText: string
  gitChangeContext: MeoDiffSplitGitChangeContext
  lineNumbersVisible: boolean
  onChange: (nextValue: string) => void
  onApplyGitDiffSelection?: (change: GitChangeItem, selection: GitDiffSelection, action: GitDiffBlockAction) => Promise<void>
  onCompositionChange?: (isComposing: boolean) => void
  onOpenLink?: (href: string) => void
  onSave?: (nextValue: string) => void
  onSelectionChange?: (selectionState: { visible?: boolean, anchorX?: number, anchorY?: number } | null) => void
  onViewportChange?: () => void
  parent: HTMLElement
  text: string
}

type MeoDiffSplitGitNavigationRequest = {
  lineNumber: number
  scope: GitChangeScope
}

export type MeoDiffSplitController = {
  countMatches: (query: string, options?: SearchOptions) => number
  destroy: () => void
  findNext: (query: string, options?: SearchOptions & { focusEditor?: boolean }) => SearchNavigationResult
  findPrevious: (query: string, options?: SearchOptions & { focusEditor?: boolean }) => SearchNavigationResult
  focus: () => void
  getHeadings: () => ReturnType<typeof extractHeadings>
  getText: () => string
  getTopVisiblePosition: () => MeoEditorViewportPosition | null
  hasFocus: () => boolean
  insertFormat: (action: MeoEditorInsertFormat, options?: unknown) => void
  moveHeadingSection: (sourceFrom: number, targetFrom: number, placement: 'before' | 'after') => boolean
  nextChange: () => boolean
  revealGitChangeLine: (request: MeoDiffSplitGitNavigationRequest) => boolean
  refreshLayout: () => void
  refreshDecorations: () => void
  replaceAll: (query: string, replacement: string, options?: SearchOptions) => { replaced: number, total: number }
  replaceCurrent: (query: string, replacement: string, options?: SearchOptions) => SearchNavigationResult & { replaced: boolean }
  restoreTopLine: (lineNumber: number, lineOffset?: number) => void
  scrollToLine: (lineNumber: number, align?: string) => void
  selectAll: () => boolean
  setBaseline: (baseline: GitBaselinePayload | null) => void
  setFallbackOriginal: (fallback: { label: string, text: string }) => void
  setGitChangeContext: (context: MeoDiffSplitGitChangeContext) => void
  setDiffGutterVisible: (visible: boolean) => void
  setLineNumbersVisible: (visible: boolean) => void
  setSearchQuery: (query: string | null | undefined, options?: SearchOptions) => void
  setText: (text: string) => void
  undo: () => boolean
  redo: () => boolean
  previousChange: () => boolean
  view: EditorView
}

type SearchOptions = {
  caseSensitive?: boolean
  wholeWord?: boolean
}

type SearchQueryState = {
  caseSensitive: boolean
  text: string
  wholeWord: boolean
}

type SearchMatchRange = {
  end: number
  start: number
}

type DiffSplitNavigationHighlightRange = {
  endLineNumber: number
  startLineNumber: number
}

type SearchNavigationResult = {
  current: number
  found: boolean
  total: number
}

type TextSyncChange = {
  from: number
  insert: string
  to: number
}

type TextChangeSetLike = {
  length?: number
  iterChanges: (
    callback: (
      fromA: number,
      toA: number,
      fromB: number,
      toB: number,
      inserted: Text,
    ) => void,
  ) => void
}

export type TextSnapshot = {
  value: string
}

export type DiffSplitResolvedState = {
  actionChange: GitChangeItem | null
  actionScope: 'staged' | 'unstaged' | null
  isFallback: boolean
  label: string
  modifiedReadOnly: boolean
  modifiedLabel: string
  modifiedText: string
  reason: GitBaselinePayload['reason'] | null
  text: string
}

type InlineSelectionRange = {
  empty: boolean
  from: number
  head: number
  anchor: number
  to: number
}

type MarkerReplacementContext = {
  contentStart: number
  isExistingTask: boolean
  oldMarkerLen: number
}

type ActiveTableSelectionTransform = (value: string, start: number, end: number) => boolean

const existingListMarkerRegex = /^(\s*)([-+*]\s+\[[ xX~\-]\]|[-+*]|\d+[.)])\s+/
const existingHeadingMarkerRegex = /^(\s*)(#{1,6})\s+/
const existingTaskMarkerRegex = /^[-+*]\s+\[[ xX~\-]\]/

const setSearchQueryEffect = StateEffect.define<SearchQueryState>()
const refreshSearchMatchesEffect = StateEffect.define<null>()
const searchMatchMark = Decoration.mark({ class: 'meo-search-match' })
const setDiffSplitNavigationHighlightEffect = StateEffect.define<DiffSplitNavigationHighlightRange | null>()
const diffSplitNavigationHighlightField = StateField.define<ReturnType<typeof Decoration.set>>({
  create() {
    return Decoration.none
  },
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setDiffSplitNavigationHighlightEffect)) {
        continue
      }

      const range = effect.value
      if (!range) {
        return Decoration.none
      }

      const lineDecorations = []
      const startLineNumber = Math.max(1, Math.min(transaction.state.doc.lines, Math.floor(range.startLineNumber)))
      const endLineNumber = Math.max(startLineNumber, Math.min(transaction.state.doc.lines, Math.floor(range.endLineNumber)))
      for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber += 1) {
        const line = transaction.state.doc.line(lineNumber)
        lineDecorations.push(Decoration.line({
          attributes: {
            class: 'meo-diff-split-navigation-target-line',
          },
        }).range(line.from))
      }

      return Decoration.set(lineDecorations, true)
    }

    return decorations.map(transaction.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})
const allowReadOnlyDocumentUpdate = Annotation.define<boolean>()
const externalDocumentSync = Annotation.define<boolean>()

function isLiveTextEditTransaction(transaction: Transaction) {
  if (
    !transaction.docChanged
    || transaction.annotation(allowReadOnlyDocumentUpdate)
    || transaction.annotation(externalDocumentSync)
  ) {
    return false
  }

  const userEvent = transaction.annotation(Transaction.userEvent)
  return typeof userEvent === 'string'
    && (userEvent.startsWith('input') || userEvent.startsWith('delete'))
}

export function shouldDeferSplitMergeChunkUpdate(
  transactions: readonly Transaction[],
  side: 'a' | 'b',
) {
  return side === 'b'
    && transactions.some(isLiveTextEditTransaction)
    && transactions.every((transaction) => !transaction.docChanged || isLiveTextEditTransaction(transaction))
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function createSearchQueryState(query: string | null | undefined, options: SearchOptions = {}): SearchQueryState {
  return {
    caseSensitive: options.caseSensitive === true,
    text: query ?? '',
    wholeWord: options.wholeWord === true,
  }
}

function isWordBoundaryCharacter(value: string): boolean {
  return /[0-9A-Za-z_]/.test(value)
}

function isWholeWordRange(text: string, start: number, end: number): boolean {
  const previous = start > 0 ? text.slice(start - 1, start) : ''
  const next = end < text.length ? text.slice(end, end + 1) : ''
  return !isWordBoundaryCharacter(previous) && !isWordBoundaryCharacter(next)
}

function findSearchMatchRanges(text: string, query: string, options: SearchOptions = {}): SearchMatchRange[] {
  if (!query) {
    return []
  }

  const haystack = options.caseSensitive ? text : text.toLocaleLowerCase()
  const needle = options.caseSensitive ? query : query.toLocaleLowerCase()
  const matches: SearchMatchRange[] = []
  let offset = 0
  while (offset <= text.length) {
    const index = haystack.indexOf(needle, offset)
    if (index < 0) {
      break
    }

    const end = index + query.length
    if (!options.wholeWord || isWholeWordRange(text, index, end)) {
      matches.push({ end, start: index })
    }
    offset = Math.max(end, index + 1)
  }
  return matches
}

function buildSearchDecorations(doc: EditorState['doc'], searchQuery: SearchQueryState) {
  if (!searchQuery.text) {
    return Decoration.none
  }

  const builder = new RangeSetBuilder<Decoration>()
  const textValue = doc.toString()
  const matches = findSearchMatchRanges(textValue, searchQuery.text, searchQuery)
  for (const match of matches) {
    builder.add(match.start, match.end, searchMatchMark)
  }
  return builder.finish()
}

export function shouldDeferSplitSearchMatchUpdate(transaction: Transaction, searchQueryText: string): boolean {
  return !!searchQueryText && isLiveTextEditTransaction(transaction)
}

const searchQueryField = StateField.define<SearchQueryState>({
  create() {
    return createSearchQueryState('')
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSearchQueryEffect)) {
        return effect.value
      }
    }
    return value
  },
})

const searchMatchField = StateField.define({
  create() {
    return Decoration.none
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSearchQueryEffect)) {
        return buildSearchDecorations(transaction.state.doc, effect.value)
      }
    }

    const refreshSearchMatches = transaction.effects.some((effect) => effect.is(refreshSearchMatchesEffect))
    if (transaction.docChanged) {
      const searchQuery = transaction.state.field(searchQueryField)
      if (!refreshSearchMatches && shouldDeferSplitSearchMatchUpdate(transaction, searchQuery.text)) {
        return value.map(transaction.changes)
      }
      return buildSearchDecorations(transaction.state.doc, searchQuery)
    }

    if (refreshSearchMatches) {
      return buildSearchDecorations(transaction.state.doc, transaction.state.field(searchQueryField))
    }

    return value
  },
  provide(field) {
    return EditorView.decorations.from(field)
  },
})

export const __meoDiffSplitSearchTestHooks = {
  createSearchQueryState,
  refreshSearchMatchesEffect,
  searchMatchField,
  searchQueryField,
  setSearchQueryEffect,
} as const

function countSearchMatches(text: string, query: string, options: SearchOptions = {}) {
  return findSearchMatchRanges(text, query, options).length
}

function replaceMatchRanges(text: string, matches: SearchMatchRange[], replacement: string): string {
  if (!matches.length) {
    return text
  }

  let nextText = ''
  let offset = 0
  for (const match of matches) {
    nextText += text.slice(offset, match.start)
    nextText += replacement
    offset = match.end
  }
  nextText += text.slice(offset)
  return nextText
}

function findSyncChange(previousText: string, nextText: string): TextSyncChange | null {
  if (previousText === nextText) {
    return null
  }

  let from = 0
  const maxStart = Math.min(previousText.length, nextText.length)
  while (from < maxStart && previousText.charCodeAt(from) === nextText.charCodeAt(from)) {
    from += 1
  }

  let previousTo = previousText.length
  let nextTo = nextText.length
  while (
    previousTo > from
    && nextTo > from
    && previousText.charCodeAt(previousTo - 1) === nextText.charCodeAt(nextTo - 1)
  ) {
    previousTo -= 1
    nextTo -= 1
  }

  return {
    from,
    insert: nextText.slice(from, nextTo),
    to: previousTo,
  }
}

export function applyCodeMirrorChangesToText(text: string, changes: TextChangeSetLike): string {
  let cursor = 0
  let nextText = ''

  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const from = Math.max(cursor, Math.min(text.length, fromA))
    const to = Math.max(from, Math.min(text.length, toA))
    nextText += text.slice(cursor, from)
    nextText += inserted.toString()
    cursor = to
  })

  nextText += text.slice(cursor)
  return nextText
}

function mapPositionThroughChange(position: number, change: TextSyncChange): number {
  const insertLength = change.insert.length
  const deletedLength = change.to - change.from
  const delta = insertLength - deletedLength

  if (position <= change.from) {
    return position
  }

  if (position >= change.to) {
    return position + delta
  }

  return change.from + insertLength
}

function findSelectedSearchMatchIndex(matches: SearchMatchRange[], from: number, to: number): number {
  return matches.findIndex((match) => match.start === from && match.end === to)
}

function normalizeLineEndings(text: string) {
  return text.replace(/\r\n?/g, '\n')
}

export function createTextDocFromContent(content: string) {
  return Text.of(content.split('\n'))
}

export function mapCurrentLineToIndexLine(indexText: string, currentText: string, currentLineNumber: number) {
  const indexDoc = createTextDocFromContent(indexText)
  const currentDoc = createTextDocFromContent(currentText)
  const indexToCurrentLineMap = buildSourceToTargetLineMap(indexDoc, currentDoc)
  const normalizedLineNumber = Math.max(1, Math.floor(currentLineNumber))

  for (let indexLineNumber = 1; indexLineNumber < indexToCurrentLineMap.length; indexLineNumber += 1) {
    if (indexToCurrentLineMap[indexLineNumber] === normalizedLineNumber) {
      return indexLineNumber
    }
  }

  return normalizedLineNumber
}

export function resolveOriginalText(
  baseline: GitBaselinePayload | null,
  fallback: { label: string, text: string },
  currentText: string,
  gitChangeContext: MeoDiffSplitGitChangeContext,
  preferredScope: GitChangeScope | null = null,
): DiffSplitResolvedState {
  if (
    preferredScope === 'staged'
    && gitChangeContext.stagedChange
    && typeof baseline?.baseText === 'string'
    && typeof baseline.indexText === 'string'
  ) {
    return {
      actionChange: gitChangeContext.stagedChange,
      actionScope: 'staged' as const,
      isFallback: false,
      label: baseline.headOid ? 'HEAD' : 'Empty baseline',
      modifiedLabel: 'Index',
      modifiedReadOnly: normalizeLineEndings(currentText) !== normalizeLineEndings(baseline.indexText),
      modifiedText: baseline.indexText,
      reason: null,
      text: baseline.baseText,
    }
  }

  if (gitChangeContext.unstagedChange && preferredScope !== 'staged') {
    if (gitChangeContext.unstagedChange.kind === 'untracked') {
      return {
        actionChange: gitChangeContext.unstagedChange,
        actionScope: 'unstaged' as const,
        isFallback: false,
        label: 'Index',
        modifiedLabel: 'Working tree',
        modifiedReadOnly: false,
        modifiedText: currentText,
        reason: null,
        text: '',
      }
    }

    if (typeof baseline?.indexText === 'string') {
      return {
        actionChange: gitChangeContext.unstagedChange,
        actionScope: 'unstaged' as const,
        isFallback: false,
        label: 'Index',
        modifiedLabel: 'Working tree',
        modifiedReadOnly: false,
        modifiedText: currentText,
        reason: null,
        text: baseline.indexText,
      }
    }
  }

  if (
    gitChangeContext.stagedChange
    && typeof baseline?.baseText === 'string'
    && typeof baseline.indexText === 'string'
  ) {
    if (normalizeLineEndings(currentText) !== normalizeLineEndings(baseline.indexText)) {
      return {
        actionChange: null,
        actionScope: null,
        isFallback: false,
        label: 'Index',
        modifiedLabel: 'Current document',
        modifiedReadOnly: false,
        modifiedText: currentText,
        reason: null,
        text: baseline.indexText,
      }
    }

    return {
      actionChange: gitChangeContext.stagedChange,
      actionScope: 'staged' as const,
      isFallback: false,
      label: baseline.headOid ? 'HEAD' : 'Empty baseline',
      modifiedLabel: 'Index',
      modifiedReadOnly: false,
      modifiedText: baseline.indexText,
      reason: null,
      text: baseline.baseText,
    }
  }

  if (typeof baseline?.baseText === 'string') {
    return {
      actionChange: null,
      actionScope: null,
      isFallback: false,
      label: baseline.headOid ? 'HEAD' : 'Empty baseline',
      modifiedLabel: 'Current document',
      modifiedReadOnly: false,
      modifiedText: currentText,
      reason: null,
      text: baseline.baseText,
    }
  }

  if (baseline?.available && (!baseline.tracked || baseline.reason === 'untracked')) {
    return {
      actionChange: null,
      actionScope: null,
      isFallback: false,
      label: 'Untracked',
      modifiedLabel: 'Current document',
      modifiedReadOnly: false,
      modifiedText: currentText,
      reason: null,
      text: '',
    }
  }

  return {
    actionChange: null,
    actionScope: null,
    isFallback: true,
    label: fallback.label,
    modifiedLabel: 'Current document',
    modifiedReadOnly: false,
    modifiedText: currentText,
    reason: baseline?.reason ?? null,
    text: fallback.text,
  }
}

function getActionChangeKey(change: GitChangeItem | null): string {
  if (!change) {
    return ''
  }

  return [
    change.scope,
    change.kind,
    change.statusCode,
    change.path,
    change.originalPath ?? '',
  ].join('\0')
}

function hasResolvedViewFrameChanged(
  previous: DiffSplitResolvedState,
  next: DiffSplitResolvedState,
): boolean {
  return previous.text !== next.text
    || previous.label !== next.label
    || previous.modifiedLabel !== next.modifiedLabel
    || previous.actionScope !== next.actionScope
    || previous.isFallback !== next.isFallback
    || previous.modifiedReadOnly !== next.modifiedReadOnly
    || previous.reason !== next.reason
    || getActionChangeKey(previous.actionChange) !== getActionChangeKey(next.actionChange)
}

function canUseTextOnlyResolvedUpdate(
  previous: DiffSplitResolvedState,
  gitChangeContext: MeoDiffSplitGitChangeContext,
): boolean {
  return previous.actionScope !== 'staged'
    && !gitChangeContext.stagedChange
    && !previous.modifiedReadOnly
}

const SPLIT_DIFF_REFRESH_IDLE_DELAY_MS = 200
const SPLIT_DIFF_REFRESH_AFTER_COMPOSITION_MS = 80

export function getDiffConfig(editable: boolean) {
  return {
    incrementalUpdates: editable,
    overrideChunks: buildCodeMirrorChunksFromVsCodeDiff,
    scanLimit: editable ? 1000 : 10000,
    timeout: 200,
  }
}

function isPlainPrimaryPointerEvent(event: PointerEvent) {
  return event.button === 0
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
}

function rangeTouchesTaskStatusMarker(state: EditorState, from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return false
  }

  const clampedFrom = clampNumber(Math.floor(from), 0, state.doc.length)
  const clampedTo = clampNumber(Math.floor(to), clampedFrom, state.doc.length)
  const line = state.doc.lineAt(Math.min(clampedFrom, state.doc.length))
  const marker = listMarkerData(state.doc.sliceString(line.from, line.to))
  if (marker?.taskBracketStart === undefined) {
    return false
  }

  const statusFrom = line.from + marker.taskBracketStart + 1
  const statusTo = statusFrom + 1
  if (clampedFrom === clampedTo) {
    return clampedFrom === statusFrom
  }

  return clampedFrom < statusTo && clampedTo > statusFrom
}

export function shouldRefreshSplitLiveDecorationsAfterTaskMarkerChange(transaction: Transaction) {
  if (!transaction.docChanged) {
    return false
  }

  let shouldRefresh = false
  transaction.changes.iterChanges((fromA, toA, fromB, toB) => {
    if (shouldRefresh) {
      return
    }

    shouldRefresh = rangeTouchesTaskStatusMarker(transaction.startState, fromA, toA)
      || rangeTouchesTaskStatusMarker(transaction.state, fromB, toB)
  })
  return shouldRefresh
}

type SplitInlineChangeLayerRefreshOptions = {
  liveDecorationsWillRefresh?: boolean
}

function hasRefreshLiveDecorationsEffect(transaction: Transaction) {
  return transaction.effects.some((effect) => effect.is(refreshLiveDecorationsEffect))
}

// Live mode can reveal Markdown source markers from selection/focus changes
// without changing diff chunks. Refresh the measured merge overlay in the same
// transaction so inline text highlights follow the rendered marker layout.
export function shouldRefreshSplitInlineChangeLayerAfterLiveMarkerLayoutChange(
  transaction: Transaction,
  options: SplitInlineChangeLayerRefreshOptions = {},
) {
  const liveDecorationsWillRefresh = options.liveDecorationsWillRefresh
    ?? shouldRefreshSplitLiveDecorationsAfterTaskMarkerChange(transaction)
  return !transaction.startState.selection.eq(transaction.state.selection)
    || hasRefreshLiveDecorationsEffect(transaction)
    || liveDecorationsWillRefresh
}

export function getHunkActionLabel(action: GitDiffBlockAction) {
  switch (action) {
    case 'stage':
      return 'Stage block'
    case 'unstage':
      return 'Unstage block'
    case 'discard':
      return 'Discard block'
    default:
      return 'Apply block action'
  }
}

export function getHunkActionIcon(action: GitDiffBlockAction) {
  if (action === 'stage') {
    return '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3.25v9.5"/><path d="M3.25 8h9.5"/></svg>'
  }

  if (action === 'unstage') {
    return '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3.25 8h9.5"/></svg>'
  }

  return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" style="color:currentColor" aria-hidden="true"><g fill="none"><path d="M24 0v24H0V0zM12.593 23.258l-.011.002-.071.035-.02.004-.014-.004-.071-.035q-.016-.005-.024.005l-.004.01-.017.428.005.02.01.013.104.074.015.004.012-.004.104-.074.012-.016.004-.017-.017-.427q-.004-.016-.017-.018m.265-.113-.013.002-.185.093-.01.01-.003.011.018.43.005.012.008.007.201.093q.019.005.029-.008l.004-.014-.034-.614q-.005-.019-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014-.034.614q.001.018.017.024l.015-.002.201-.093.01-.008.004-.011.017-.43-.003-.012-.01-.01z"></path><path fill="currentColor" d="M6.046 11.677A7.5 7.5 0 0 1 20 15.5a1 1 0 1 0 2 0A9.5 9.5 0 0 0 4.78 9.963l-.537-3.045a1 1 0 1 0-1.97.347l1.042 5.909a1 1 0 0 0 .412.645 1.1 1.1 0 0 0 .975.125l5.68-1.001a1 1 0 1 0-.347-1.97z"></path></g></svg>'
}

const readOnlyWidgetSelector = 'textarea, input, select, button, [contenteditable="true"]'

function lockReadOnlyWidgetElement(element: Element) {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    element.readOnly = true
    element.tabIndex = -1
    element.setAttribute('aria-readonly', 'true')
    return
  }

  if (element instanceof HTMLSelectElement || element instanceof HTMLButtonElement) {
    element.disabled = true
    element.tabIndex = -1
    element.setAttribute('aria-disabled', 'true')
    return
  }

  if (element instanceof HTMLElement && element.contentEditable === 'true') {
    element.contentEditable = 'false'
    element.tabIndex = -1
    element.setAttribute('aria-readonly', 'true')
  }
}

export function lockReadOnlyWidgets(rootElement: Element) {
  if (rootElement.matches(readOnlyWidgetSelector)) {
    lockReadOnlyWidgetElement(rootElement)
  }

  for (const element of rootElement.querySelectorAll(readOnlyWidgetSelector)) {
    lockReadOnlyWidgetElement(element)
  }
}

export function createLineNumberExtensions(visible: boolean, startLineNumber = 1) {
  if (!visible) {
    return []
  }

  const normalizedStartLineNumber = Math.max(1, Math.floor(startLineNumber))
  return normalizedStartLineNumber === 1
    ? [lineNumbers()]
    : [lineNumbers({
        formatNumber: (lineNumber) => String(normalizedStartLineNumber + lineNumber - 1),
      })]
}

function createActiveLineGutterExtensions(visible: boolean) {
  return visible ? [highlightActiveLineGutter()] : []
}

function createEditableExtension(editable: boolean, readOnly: boolean) {
  return EditorView.editable.of(editable && !readOnly)
}

function createReadOnlyExtension(editable: boolean, readOnly: boolean) {
  return EditorState.readOnly.of(readOnly || !editable)
}

type DiffSplitGutterFlags = {
  added: boolean
  deleted: boolean
  modified: boolean
  removed?: boolean
  liveBlockEndLine?: number
  liveBlockStartLine?: number
  scope?: 'staged' | 'unstaged'
}

function createDiffSplitGutterFlags(flags: Partial<DiffSplitGutterFlags>): DiffSplitGutterFlags {
  return {
    added: flags.added === true,
    deleted: flags.deleted === true,
    liveBlockEndLine: flags.liveBlockEndLine,
    liveBlockStartLine: flags.liveBlockStartLine,
    modified: flags.modified === true,
    removed: flags.removed === true,
    scope: flags.scope,
  }
}

export function buildDiffSplitGutterFlagsFromChunks(
  originalDoc: Text,
  modifiedDoc: Text,
  chunks: readonly CodeMirrorDiffChunk[],
  side: 'original' | 'modified',
): (DiffSplitGutterFlags | undefined)[] {
  const doc = side === 'original' ? originalDoc : modifiedDoc
  const lineFlags = new Array<DiffSplitGutterFlags | undefined>(doc.lines)

  for (const chunk of chunks) {
    const selection = createSelectionFromCodeMirrorChunk(originalDoc, modifiedDoc, chunk)
    if (side === 'original') {
      const lineCount = Math.max(0, selection.originalLineCount)
      if (!lineCount) {
        continue
      }

      const startLine = clampNumber(selection.originalStartLine, 1, doc.lines)
      const endLine = clampNumber(startLine + lineCount - 1, startLine, doc.lines)
      for (let lineNo = startLine; lineNo <= endLine; lineNo += 1) {
        lineFlags[lineNo - 1] = createDiffSplitGutterFlags({
          removed: true,
          scope: 'unstaged',
        })
      }
      continue
    }

    const lineCount = Math.max(0, selection.modifiedLineCount)
    if (!lineCount) {
      continue
    }

    const startLine = clampNumber(selection.modifiedStartLine, 1, doc.lines)
    const endLine = clampNumber(startLine + lineCount - 1, startLine, doc.lines)
    for (let lineNo = startLine; lineNo <= endLine; lineNo += 1) {
      lineFlags[lineNo - 1] = createDiffSplitGutterFlags({
        added: true,
        scope: 'unstaged',
      })
    }
  }

  return lineFlags
}

function mapDiffSplitOriginalGutterFlag(flags: DiffSplitGutterFlags) {
  return {
    added: false,
    deleted: false,
    liveBlockEndLine: flags.liveBlockEndLine,
    liveBlockStartLine: flags.liveBlockStartLine,
    modified: false,
    removed: flags.added || flags.modified || !!flags.removed,
    scope: flags.scope,
  }
}

function mapDiffSplitModifiedGutterFlag(flags: DiffSplitGutterFlags) {
  return {
    added: flags.added || flags.modified || !!flags.removed,
    deleted: false,
    liveBlockEndLine: flags.liveBlockEndLine,
    liveBlockStartLine: flags.liveBlockStartLine,
    modified: false,
    removed: false,
    scope: flags.scope,
  }
}

export function createDiffExtensions({
  activeLineGutterCompartment,
  editable,
  editableCompartment,
  interactive,
  lineNumbersCompartment,
  lineNumberStart = 1,
  lineNumbersVisible,
  onChange,
  onCompositionChange,
  onOpenLink,
  onSave,
  onSelectionChange,
  onViewportChange,
  readOnly,
  readOnlyCompartment,
  reportViewportChanges = true,
  side,
  textSnapshot,
}: {
  activeLineGutterCompartment: Compartment
  editable: boolean
  editableCompartment: Compartment
  interactive?: boolean
  lineNumbersCompartment: Compartment
  lineNumberStart?: number
  lineNumbersVisible: boolean
  onChange: (nextValue: string) => void
  onCompositionChange?: (isComposing: boolean) => void
  onOpenLink?: (href: string) => void
  onSave?: (nextValue: string) => void
  onSelectionChange?: (selectionState: { visible?: boolean, anchorX?: number, anchorY?: number } | null) => void
  onViewportChange?: () => void
  readOnly: boolean | (() => boolean)
  readOnlyCompartment: Compartment
  reportViewportChanges?: boolean
  side: 'original' | 'modified'
  textSnapshot?: TextSnapshot
}) {
  let pointerSelectionPending = false
  let selectionPointerId: number | null = null
  let capturedPointerId: number | null = null
  let checkboxClick: { pointerId: number } | null = null
  let compositionActive = false
  let pendingCompositionDocChange = false
  let pendingCompositionFlushFrame = 0
  let pendingCompositionView: EditorView | null = null
  const selectionMatchCompartment = new Compartment()
  const selectionMatchExtension = highlightSelectionMatches()
  const isInteractivePane = interactive ?? side === 'modified'
  const isReadOnly = () => typeof readOnly === 'function' ? readOnly() : readOnly
  const readViewText = (view: EditorView) => {
    const nextText = view.state.doc.toString()
    if (textSnapshot) {
      textSnapshot.value = nextText
    }
    return nextText
  }
  const getCurrentText = (view: EditorView) => (
    pendingCompositionDocChange && pendingCompositionView === view
      ? readViewText(view)
      : textSnapshot?.value ?? view.state.doc.toString()
  )
  const readChangedText = (update: ViewUpdate) => {
    if (!textSnapshot) {
      return update.state.doc.toString()
    }

    if (typeof update.changes.length === 'number' && update.changes.length !== textSnapshot.value.length) {
      textSnapshot.value = update.state.doc.toString()
      return textSnapshot.value
    }

    const nextText = applyCodeMirrorChangesToText(textSnapshot.value, update.changes)
    textSnapshot.value = nextText
    return nextText
  }

  const releasePointerCaptureIfHeld = (view: EditorView, pointerId: number | null) => {
    if (pointerId === null || !view.dom.releasePointerCapture) {
      return
    }

    if (view.dom.hasPointerCapture?.(pointerId)) {
      view.dom.releasePointerCapture(pointerId)
    }
  }

  const emitSelectionChange = (view: EditorView) => {
    if (isReadOnly()) {
      return
    }

    const selection = view.state.selection.main
    if (selection.empty) {
      onSelectionChange?.(null)
      return
    }

    const from = Math.min(selection.from, selection.to)
    const to = Math.max(selection.from, selection.to)
    if (!isRegularInlineSelection(view.state, from, to)) {
      onSelectionChange?.(null)
      return
    }

    const coords = view.coordsAtPos(selection.head) ?? view.coordsAtPos(selection.from)
    onSelectionChange?.(coords
      ? {
          anchorX: coords.left + (coords.right - coords.left) / 2,
          anchorY: coords.top,
          visible: true,
        }
      : null)
  }

  const emitSelectionChangeAfterPointerUp = (view: EditorView) => {
    window.requestAnimationFrame(() => {
      emitSelectionChange(view)
    })
  }

  const finishPointerSelection = (
    view: EditorView,
    pointerId: number,
    { hideMenu = false, showMenu = true }: { hideMenu?: boolean, showMenu?: boolean } = {},
  ) => {
    if (selectionPointerId !== pointerId) {
      return false
    }

    releasePointerCaptureIfHeld(view, pointerId)
    if (capturedPointerId === pointerId) {
      capturedPointerId = null
    }

    pointerSelectionPending = false
    selectionPointerId = null

    if (hideMenu) {
      onSelectionChange?.(null)
      return true
    }

    if (showMenu) {
      emitSelectionChangeAfterPointerUp(view)
    }

    return true
  }

  const isCompositionInputUpdate = (update: ViewUpdate) => update.transactions.some((transaction) => {
    const userEvent = transaction.annotation(Transaction.userEvent)
    return typeof userEvent === 'string' && userEvent.startsWith('input.type.compose')
  })

  const cancelPendingCompositionFlush = () => {
    if (pendingCompositionFlushFrame) {
      window.cancelAnimationFrame(pendingCompositionFlushFrame)
      pendingCompositionFlushFrame = 0
    }
  }

  const flushPendingCompositionDocChange = () => {
    if (!pendingCompositionDocChange || !pendingCompositionView || isReadOnly()) {
      return
    }

    const pendingView = pendingCompositionView
    pendingCompositionDocChange = false
    pendingCompositionView = null
    onChange(readViewText(pendingView))
  }

  const schedulePendingCompositionFlush = (view: EditorView) => {
    pendingCompositionView = view
    if (!pendingCompositionDocChange || pendingCompositionFlushFrame) {
      return
    }

    pendingCompositionFlushFrame = window.requestAnimationFrame(() => {
      pendingCompositionFlushFrame = 0
      flushPendingCompositionDocChange()
    })
  }

  const syncPendingCompositionSnapshotBeforeChange = (update: ViewUpdate) => {
    if (!pendingCompositionDocChange || !textSnapshot) {
      return
    }

    const pendingView = pendingCompositionView
    pendingCompositionDocChange = false
    pendingCompositionView = null
    if (pendingView === update.view) {
      textSnapshot.value = update.startState.doc.toString()
    } else if (pendingView) {
      textSnapshot.value = pendingView.state.doc.toString()
    }
  }

  const setCompositionActive = (view: EditorView, nextValue: boolean) => {
    if (compositionActive === nextValue) {
      return
    }

    compositionActive = nextValue
    view.dom.classList.toggle('meo-ime-composing', nextValue)
    // IME marked text is exposed as a transient selection. Do not let the
    // selection-match highlighter scan or paint that preedit range.
    view.dispatch({
      effects: selectionMatchCompartment.reconfigure(nextValue ? [] : selectionMatchExtension),
    })
  }

  const extensions: Extension[] = [
    lineNumbersCompartment.of(createLineNumberExtensions(lineNumbersVisible, lineNumberStart)),
    ...gitDiffGutterBaselineExtensions({ deferDocChanges: true }),
    ...gitDiffGutterLiveRenderExtensions({
      mapLineFlag: side === 'original' ? mapDiffSplitOriginalGutterFlag : mapDiffSplitModifiedGutterFlag,
    }),
    activeLineGutterCompartment.of(createActiveLineGutterExtensions(lineNumbersVisible)),
    highlightActiveLine(),
    diffSplitNavigationHighlightField,
    EditorState.tabSize.of(4),
    indentUnit.of('  '),
    EditorView.lineWrapping,
    editableCompartment.of(createEditableExtension(editable, isReadOnly())),
    readOnlyCompartment.of(createReadOnlyExtension(editable, isReadOnly())),
    EditorState.transactionFilter.of((transaction) => (
      isReadOnly()
      && transaction.docChanged
      && !transaction.annotation(allowReadOnlyDocumentUpdate)
      && !transaction.annotation(externalDocumentSync)
        ? []
        : transaction
    )),
    EditorState.transactionExtender.of((transaction) => {
      const effects: StateEffect<unknown>[] = []
      const refreshLiveDecorations = shouldRefreshSplitLiveDecorationsAfterTaskMarkerChange(transaction)
      if (refreshLiveDecorations) {
        effects.push(refreshLiveDecorationsEffect.of(null))
      }
      if (
        refreshLiveDecorations
        || shouldRefreshSplitInlineChangeLayerAfterLiveMarkerLayoutChange(transaction, {
          liveDecorationsWillRefresh: refreshLiveDecorations,
        })
      ) {
        effects.push(refreshInlineChangeLayerEffect.of(null))
      }
      return effects.length ? { effects } : null
    }),
    EditorView.editorAttributes.of({
      class: 'meo-mode-live meo-diff-split-editor',
    }),
    ...liveModeExtensions({ deferDocChanges: true }),
  ]

  if (isInteractivePane) {
    extensions.push(
      drawSelection(),
      history(),
      indentOnInput(),
      bracketMatching(),
      selectionMatchCompartment.of(selectionMatchExtension),
      searchQueryField,
      searchMatchField,
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: (view) => {
            if (isReadOnly() || !editable) {
              return false
            }

            onSave?.(getCurrentText(view))
            return true
          },
        },
        { key: 'Tab', run: (view) => !isReadOnly() && (indentListByTwoSpaces(view) || indentMore(view)) },
        { key: 'Shift-Tab', run: (view) => !isReadOnly() && (outdentListByTwoSpaces(view) || indentLess(view)) },
        { key: 'Backspace', run: (view) => !isReadOnly() && handleBackspaceAtListContentStart(view) },
        { key: 'ArrowLeft', run: (view) => handleArrowLeftAtListContentStart(view) },
        { key: 'ArrowRight', run: (view) => handleArrowRightAtListLineStart(view) },
        {
          key: 'Enter',
          run: (view) => !isReadOnly() && (
            handleEnterOnEmptyListItem(view)
            || handleEnterAtListContentStart(view)
            || handleEnterContinueList(view)
            || handleEnterBeforeNestedList(view)
          ),
        },
        ...markdownKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
      ]),
    )
  }

  extensions.push(
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !isReadOnly()) {
        if (update.transactions.some((transaction) => transaction.annotation(externalDocumentSync))) {
          return
        }

        if (isCompositionInputUpdate(update)) {
          pendingCompositionDocChange = true
          pendingCompositionView = update.view
          // Keep preedit updates out of the string-snapshot path. The committed
          // text is read once on compositionend.
          return
        }

        cancelPendingCompositionFlush()
        syncPendingCompositionSnapshotBeforeChange(update)
        pendingCompositionDocChange = false
        pendingCompositionView = null
        const nextValue = readChangedText(update)

        const renumberChanges = shouldCollectOrderedListRenumberChanges(update)
          ? collectOrderedListRenumberChanges(update.state)
          : []
        if (renumberChanges.length) {
          update.view.dispatch({
            changes: renumberChanges,
            effects: refreshLiveDecorationsEffect.of(null),
            annotations: [
              Transaction.addToHistory.of(false),
              Transaction.userEvent.of('input.type'),
            ],
          })
          return
        }

        onChange(nextValue)
      }

      if (update.selectionSet && !isReadOnly() && !compositionActive) {
        if (!pointerSelectionPending) {
          emitSelectionChange(update.view)
        }
      }

      if (update.viewportChanged && reportViewportChanges) {
        onViewportChange?.()
      }
    }),
  )

  if (isInteractivePane) {
    extensions.push(
      ViewPlugin.fromClass(class {
        private readonly onWindowPointerUp = (event: PointerEvent) => {
          finishPointerSelection(this.view, event.pointerId)
        }

        private readonly onWindowPointerCancel = (event: PointerEvent) => {
          finishPointerSelection(this.view, event.pointerId, { hideMenu: true, showMenu: false })
        }

        constructor(private readonly view: EditorView) {
          window.addEventListener('pointerup', this.onWindowPointerUp, true)
          window.addEventListener('pointercancel', this.onWindowPointerCancel, true)
        }

        destroy() {
          cancelPendingCompositionFlush()
          flushPendingCompositionDocChange()
          window.removeEventListener('pointerup', this.onWindowPointerUp, true)
          window.removeEventListener('pointercancel', this.onWindowPointerCancel, true)
        }
      }),
      EditorView.domEventHandlers({
        pointerdown: (event, view) => {
          if (isReadOnly()) {
            return false
          }

          if (isPrimaryModifierPointerClick(event)) {
            const href = getLinkHrefAtPointer(event, view)
            if (!href) {
              return false
            }

            event.preventDefault()
            event.stopPropagation()
            onOpenLink?.(href)
            return true
          }

          if (!isPlainPrimaryPointerEvent(event)) {
            return false
          }

          const target = event.target
          if (!(target instanceof Node) || !view.contentDOM.contains(target)) {
            pointerSelectionPending = false
            selectionPointerId = null
            checkboxClick = null
            return false
          }

          const targetElement = target instanceof Element ? target : target.parentElement
          pointerSelectionPending = true
          selectionPointerId = event.pointerId
          onSelectionChange?.(null)

          if (targetElement?.closest('.meo-task-checkbox')) {
            checkboxClick = { pointerId: event.pointerId }
            return false
          }

          checkboxClick = null
          if (view.dom.setPointerCapture) {
            view.dom.setPointerCapture(event.pointerId)
            capturedPointerId = event.pointerId
          }

          return false
        },
        pointerup: (event, view) => {
          if (checkboxClick?.pointerId === event.pointerId) {
            checkboxClick = null
            finishPointerSelection(view, event.pointerId, { showMenu: false })
            return false
          }

          finishPointerSelection(view, event.pointerId)
          return false
        },
        pointercancel: (event, view) => {
          checkboxClick = null
          finishPointerSelection(view, event.pointerId, { hideMenu: true, showMenu: false })
          return false
        },
        compositionstart: (_event, view) => {
          if (!isReadOnly()) {
            setCompositionActive(view, true)
            onCompositionChange?.(true)
          }
          return false
        },
        compositionend: (_event, view) => {
          const shouldCompleteComposition = compositionActive
          if (!isReadOnly()) {
            schedulePendingCompositionFlush(view)
          }
          if (shouldCompleteComposition) {
            window.setTimeout(() => {
              setCompositionActive(view, false)
              onCompositionChange?.(false)
            }, 0)
          }
          return false
        },
      }),
    )
  }

  return extensions
}

function getTopVisiblePosition(view: EditorView | null, scrollContainer?: HTMLElement | null) {
  if (!view) {
    return null
  }

  const block = view.lineBlockAtHeight(scrollContainer?.scrollTop ?? view.scrollDOM.scrollTop)
  const line = view.state.doc.lineAt(block.from)

  return {
    line: line.number,
    lineOffset: Math.max(0, (scrollContainer?.scrollTop ?? view.scrollDOM.scrollTop) - block.top),
  }
}

function scrollPositionIntoView(view: EditorView, position: number, align = 'center', scrollContainer?: HTMLElement | null) {
  if (!scrollContainer) {
    view.dispatch({
      effects: EditorView.scrollIntoView(position, {
        y: align === 'top' ? 'start' : align === 'bottom' ? 'end' : 'center',
      }),
    })
    return
  }

  const block = view.lineBlockAt(position)
  const viewportHeight = Math.max(1, scrollContainer.clientHeight)
  const nextTop = align === 'top'
    ? block.top
    : align === 'bottom'
      ? block.bottom - viewportHeight
      : block.top - (viewportHeight - block.height) / 2
  scrollContainer.scrollTop = Math.max(0, nextTop)
}

function scrollToLine(view: EditorView, lineNumber: number, align = 'center', scrollContainer?: HTMLElement | null) {
  const normalizedLine = Math.min(Math.max(1, Math.floor(lineNumber)), view.state.doc.lines)
  const line = view.state.doc.line(normalizedLine)
  view.dispatch({
    selection: { anchor: line.from },
  })
  scrollPositionIntoView(view, line.from, align, scrollContainer)
  view.focus()
}

function revealLine(
  view: EditorView,
  lineNumber: number,
  {
    focusEditor = true,
    scrollContainer,
    selectLine = true,
  }: {
    focusEditor?: boolean
    scrollContainer?: HTMLElement | null
    selectLine?: boolean
  } = {},
) {
  const normalizedLine = Math.min(Math.max(1, Math.floor(lineNumber)), view.state.doc.lines)
  const line = view.state.doc.line(normalizedLine)
  if (selectLine) {
    view.dispatch({
      selection: { anchor: line.from },
    })
  }
  scrollPositionIntoView(view, line.from, 'center', scrollContainer)
  if (focusEditor) {
    view.focus()
  }
}

function clearDiffSplitNavigationHighlight(
  view: EditorView | null,
  timerRef: { current: number | null },
) {
  if (timerRef.current) {
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  if (!view) {
    return
  }

  try {
    view.dispatch({
      effects: setDiffSplitNavigationHighlightEffect.of(null),
    })
  } catch {
    // The view may be tearing down while a split navigation request is resolving.
  }
}

function applyDiffSplitNavigationHighlight(
  view: EditorView,
  lineNumber: number,
  timerRef: { current: number | null },
) {
  const normalizedLine = Math.min(Math.max(1, Math.floor(lineNumber)), view.state.doc.lines)
  clearDiffSplitNavigationHighlight(view, timerRef)
  view.dispatch({
    effects: setDiffSplitNavigationHighlightEffect.of({
      endLineNumber: normalizedLine,
      startLineNumber: normalizedLine,
    }),
  })

  timerRef.current = window.setTimeout(() => {
    timerRef.current = null
    try {
      view.dispatch({
        effects: setDiffSplitNavigationHighlightEffect.of(null),
      })
    } catch {
      // Ignore teardown races triggered by rapid mode or file switches.
    }
  }, 1600)
}

function restoreTopLine(view: EditorView, lineNumber: number, lineOffset = 0, scrollContainer?: HTMLElement | null) {
  const normalizedLine = Math.min(Math.max(1, Math.floor(lineNumber || 1)), view.state.doc.lines)
  const normalizedOffset = Number.isFinite(lineOffset) ? Math.max(0, Number(lineOffset)) : 0
  const line = view.state.doc.line(normalizedLine)
  const block = view.lineBlockAt(line.from)

  if (scrollContainer) {
    scrollContainer.scrollTop = Math.max(0, block.top + normalizedOffset)
  } else {
    view.scrollDOM.scrollTop = Math.max(0, block.top + normalizedOffset)
  }

  view.dispatch({
    selection: { anchor: line.from },
  })
}

function trimInlineSelection(view: EditorView, selection: InlineSelectionRange): InlineSelectionRange {
  if (selection.empty) {
    return selection
  }

  let from = Math.min(selection.from, selection.to)
  let to = Math.max(selection.from, selection.to)
  while (to > from && view.state.doc.sliceString(to - 1, to) === '\n') {
    to -= 1
  }
  return {
    anchor: from,
    empty: to <= from,
    from,
    head: to,
    to,
  }
}

function normalizeLiveInlineSelectionForListContent(
  state: EditorState,
  selection: InlineSelectionRange,
): InlineSelectionRange {
  if (selection.empty) {
    return selection
  }

  let from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (to <= from) {
    return selection
  }

  const startLine = state.doc.lineAt(from)
  const endLine = state.doc.lineAt(to - 1)
  if (startLine.number !== endLine.number) {
    return selection
  }

  const lineText = state.doc.sliceString(startLine.from, startLine.to)
  const marker = listMarkerData(lineText)
  if (!marker) {
    return selection
  }

  const contentFrom = startLine.from + marker.toOffset
  if (from >= contentFrom || to <= contentFrom) {
    return selection
  }

  from = contentFrom
  if (from >= to) {
    return selection
  }

  if (selection.anchor <= selection.head) {
    return { anchor: from, empty: false, from, head: to, to }
  }

  return { anchor: to, empty: false, from, head: from, to }
}

function insertInlineFenceForSelection(view: EditorView, selection: InlineSelectionRange, fence: string) {
  const normalizedSelection = trimInlineSelection(view, selection)
  const from = Math.min(normalizedSelection.from, normalizedSelection.to)
  const to = Math.max(normalizedSelection.from, normalizedSelection.to)
  const selectedText = view.state.doc.sliceString(from, to)
  const insert = `${fence}${selectedText}${fence}`
  view.dispatch({
    changes: { from, insert, to },
    selection: selectedText
      ? { anchor: from + insert.length }
      : { anchor: from + fence.length },
  })
}

function toggleInlineWrapper(view: EditorView, selection: InlineSelectionRange, openMarker: string, closeMarker = openMarker) {
  const normalizedSelection = trimInlineSelection(view, selection)
  const from = Math.min(normalizedSelection.from, normalizedSelection.to)
  let to = Math.max(normalizedSelection.from, normalizedSelection.to)

  if (to <= from) {
    const insert = `${openMarker}${closeMarker}`
    view.dispatch({
      changes: { from, insert, to },
      selection: { anchor: from + openMarker.length },
    })
    return
  }

  while (to > from && view.state.doc.sliceString(to - 1, to) === '\n') {
    to -= 1
  }

  const hasOpenMarker = from >= openMarker.length && view.state.doc.sliceString(from - openMarker.length, from) === openMarker
  const hasCloseMarker = view.state.doc.sliceString(to, to + closeMarker.length) === closeMarker
  if (hasOpenMarker && hasCloseMarker) {
    view.dispatch({
      changes: [
        { from: to, insert: '', to: to + closeMarker.length },
        { from: from - openMarker.length, insert: '', to: from },
      ],
      selection: {
        anchor: from - openMarker.length,
        head: to - openMarker.length,
      },
    })
    return
  }

  view.dispatch({
    changes: [
      { from: to, insert: closeMarker },
      { from, insert: openMarker },
    ],
    selection: {
      anchor: from + openMarker.length,
      head: to + openMarker.length,
    },
  })
}

function wrapSelection(view: EditorView, selection: InlineSelectionRange, before: string, after = before, cursorOffset = before.length) {
  const normalizedSelection = trimInlineSelection(view, selection)
  const from = Math.min(normalizedSelection.from, normalizedSelection.to)
  const to = Math.max(normalizedSelection.from, normalizedSelection.to)
  const selectedText = view.state.doc.sliceString(from, to)
  const insert = `${before}${selectedText}${after}`
  view.dispatch({
    changes: { from, insert, to },
    selection: selectedText
      ? { anchor: from + before.length, head: from + before.length + selectedText.length }
      : { anchor: from + cursorOffset },
  })
}

function getActiveTableInput(view: EditorView) {
  const active = document.activeElement
  if (!(active instanceof HTMLTextAreaElement)) {
    return null
  }
  if (!view.dom.contains(active)) {
    return null
  }
  return active.closest('.meo-md-html-table-wrap') ? active : null
}

function getTableInputSelectionState(input: HTMLTextAreaElement) {
  const rawStart = input.selectionStart ?? 0
  const rawEnd = input.selectionEnd ?? rawStart
  if (rawStart === rawEnd) {
    return null
  }

  const rect = input.getBoundingClientRect()
  return {
    anchorX: rect.left + Math.min(rect.width / 2, 48),
    anchorY: rect.top,
    visible: true,
  }
}

function updateActiveTableInput(
  input: HTMLTextAreaElement,
  nextValue: string,
  anchor: number,
  head = anchor,
  onSelectionChange?: (selectionState: { visible?: boolean, anchorX?: number, anchorY?: number } | null) => void,
) {
  input.value = nextValue
  input.focus({ preventScroll: true })
  input.setSelectionRange(
    Math.min(anchor, head),
    Math.max(anchor, head),
    anchor <= head ? 'forward' : 'backward',
  )
  input.dispatchEvent(new Event('input', { bubbles: true }))
  onSelectionChange?.(getTableInputSelectionState(input))
  return true
}

function editActiveTableInputWithSelection(input: HTMLTextAreaElement, transform: ActiveTableSelectionTransform) {
  const rawStart = input.selectionStart ?? 0
  const rawEnd = input.selectionEnd ?? rawStart
  return transform(input.value, Math.min(rawStart, rawEnd), Math.max(rawStart, rawEnd))
}

function trimTrailingNewlines(value: string, start: number, end: number) {
  let nextEnd = end
  while (nextEnd > start && value.slice(nextEnd - 1, nextEnd) === '\n') {
    nextEnd -= 1
  }
  return nextEnd
}

function wrapActiveTableInputSelection(
  input: HTMLTextAreaElement,
  openMarker: string,
  closeMarker = openMarker,
  options: { toggle?: boolean, selectWrapped?: boolean } = {},
  onSelectionChange?: (selectionState: { visible?: boolean, anchorX?: number, anchorY?: number } | null) => void,
) {
  const { selectWrapped = true, toggle = true } = options
  return editActiveTableInputWithSelection(input, (value, start, end) => {
    if (start === end) {
      const insert = `${openMarker}${closeMarker}`
      const nextValue = value.slice(0, start) + insert + value.slice(end)
      return updateActiveTableInput(input, nextValue, start + openMarker.length, undefined, onSelectionChange)
    }

    const trimmedEnd = trimTrailingNewlines(value, start, end)
    if (toggle) {
      const hasOpenMarker = start >= openMarker.length && value.slice(start - openMarker.length, start) === openMarker
      const hasCloseMarker = value.slice(trimmedEnd, trimmedEnd + closeMarker.length) === closeMarker
      if (hasOpenMarker && hasCloseMarker) {
        const nextValue = value.slice(0, start - openMarker.length)
          + value.slice(start, trimmedEnd)
          + value.slice(trimmedEnd + closeMarker.length)
        return updateActiveTableInput(
          input,
          nextValue,
          start - openMarker.length,
          trimmedEnd - openMarker.length,
          onSelectionChange,
        )
      }
    }

    const nextValue = value.slice(0, start)
      + openMarker
      + value.slice(start, trimmedEnd)
      + closeMarker
      + value.slice(trimmedEnd)
    if (!selectWrapped) {
      const cursor = start + openMarker.length + (trimmedEnd - start) + closeMarker.length
      return updateActiveTableInput(input, nextValue, cursor, undefined, onSelectionChange)
    }
    return updateActiveTableInput(input, nextValue, start + openMarker.length, trimmedEnd + openMarker.length, onSelectionChange)
  })
}

function insertFormatInActiveTableInput(
  input: HTMLTextAreaElement,
  action: MeoEditorInsertFormat,
  onSelectionChange?: (selectionState: { visible?: boolean, anchorX?: number, anchorY?: number } | null) => void,
) {
  switch (action) {
    case 'inlineCode':
      return wrapActiveTableInputSelection(input, '`', '`', { selectWrapped: false, toggle: false }, onSelectionChange)
    case 'kbd':
      return wrapActiveTableInputSelection(input, '<kbd>', '</kbd>', {}, onSelectionChange)
    case 'bold':
      return wrapActiveTableInputSelection(input, '**', '**', {}, onSelectionChange)
    case 'italic':
      return wrapActiveTableInputSelection(input, '*', '*', {}, onSelectionChange)
    case 'lineover':
    case 'strike':
      return wrapActiveTableInputSelection(input, '~~', '~~', {}, onSelectionChange)
    case 'link':
      return editActiveTableInputWithSelection(input, (value, start, end) => {
        if (start !== end) {
          const trimmedEnd = trimTrailingNewlines(value, start, end)
          const selectedText = value.slice(start, trimmedEnd)
          const insert = `[${selectedText}]()`
          const nextValue = value.slice(0, start) + insert + value.slice(trimmedEnd)
          return updateActiveTableInput(input, nextValue, start + insert.length - 1, undefined, onSelectionChange)
        }

        const insert = '[]()'
        const nextValue = value.slice(0, start) + insert + value.slice(end)
        return updateActiveTableInput(input, nextValue, start + 3, undefined, onSelectionChange)
      })
    case 'wikiLink':
      return editActiveTableInputWithSelection(input, (value, start, end) => {
        if (start !== end) {
          const trimmedEnd = trimTrailingNewlines(value, start, end)
          const selectedText = value.slice(start, trimmedEnd)
          const insert = `[[${selectedText}]]`
          const nextValue = value.slice(0, start) + insert + value.slice(trimmedEnd)
          return updateActiveTableInput(input, nextValue, start + insert.length, undefined, onSelectionChange)
        }

        const insert = '[[]]'
        const nextValue = value.slice(0, start) + insert + value.slice(end)
        return updateActiveTableInput(input, nextValue, start + 2, undefined, onSelectionChange)
      })
    default:
      return false
  }
}

function forEachSelectedLine(state: EditorState, callback: (line: ReturnType<EditorState['doc']['line']>) => void) {
  const selection = state.selection.main
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  const startLine = state.doc.lineAt(from)
  const endLine = state.doc.lineAt(Math.max(from, to - (to > from ? 1 : 0)))
  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
    callback(state.doc.line(lineNumber))
  }
}

function lineMarkerReplacementContext(state: EditorState, line: { from: number, to: number }): MarkerReplacementContext {
  const lineText = state.doc.sliceString(line.from, line.to)
  const existingMarker = existingListMarkerRegex.exec(lineText)
  const existingHeading = existingHeadingMarkerRegex.exec(lineText)
  const leadingWhitespace = existingMarker?.[1] ?? existingHeading?.[1] ?? /^(\s*)/.exec(lineText)?.[1] ?? ''
  const contentStart = line.from + leadingWhitespace.length
  let oldMarkerLen = 0
  if (existingMarker) {
    oldMarkerLen = existingMarker[0].length - leadingWhitespace.length
  } else if (existingHeading) {
    oldMarkerLen = existingHeading[0].length - leadingWhitespace.length
  }

  return {
    contentStart,
    isExistingTask: Boolean(existingMarker && existingTaskMarkerRegex.test(existingMarker[0])),
    oldMarkerLen,
  }
}

function buildListFormatChangesForSelection(state: EditorState, insert: string) {
  const changes: TextSyncChange[] = []
  forEachSelectedLine(state, (line) => {
    const { contentStart, oldMarkerLen } = lineMarkerReplacementContext(state, line)
    changes.push({ from: contentStart, insert, to: contentStart + oldMarkerLen })
  })
  return changes
}

function applyBlockMarker(view: EditorView, marker: string, options: { skipExistingTask?: boolean } = {}) {
  const { state } = view
  const selection = state.selection.main
  if (!selection.empty && (marker === '- ' || marker === '1. ')) {
    view.dispatch({ changes: buildListFormatChangesForSelection(state, marker) })
    return
  }

  const line = state.doc.lineAt(selection.from)
  const { contentStart, oldMarkerLen, isExistingTask } = lineMarkerReplacementContext(state, line)
  if (options.skipExistingTask && isExistingTask) {
    return
  }

  const cursorOffset = selection.from - (contentStart + oldMarkerLen)
  const nextCursor = contentStart + marker.length + Math.max(0, cursorOffset)
  view.dispatch({
    changes: { from: contentStart, insert: marker, to: contentStart + oldMarkerLen },
    selection: { anchor: nextCursor },
  })
}

function insertQuote(view: EditorView) {
  const { state } = view
  const selection = state.selection.main
  const line = state.doc.lineAt(selection.from)
  const lineText = state.doc.sliceString(line.from, line.to)
  const existingQuote = /^(\s*)(>\s*)/.exec(lineText)
  if (existingQuote) {
    return
  }

  const leadingWhitespace = /^(\s*)/.exec(lineText)?.[1] ?? ''
  const contentStart = line.from + leadingWhitespace.length
  const cursorOffset = selection.from - contentStart
  view.dispatch({
    changes: { from: contentStart, insert: '> ' },
    selection: { anchor: contentStart + 2 + Math.max(0, cursorOffset) },
  })
}

function insertHr(view: EditorView) {
  const selection = view.state.selection.main
  const line = view.state.doc.lineAt(selection.from)
  const lineText = view.state.doc.sliceString(line.from, line.to)
  const trimmed = lineText.trim()
  if (!trimmed) {
    view.dispatch({
      changes: { from: line.from, insert: '---', to: line.to },
      selection: { anchor: line.from + 3 },
    })
    return
  }

  view.dispatch({
    changes: { from: line.to, insert: '\n---' },
    selection: { anchor: line.to + 4 },
  })
}

function insertSimpleFormat(view: EditorView, action: MeoEditorInsertFormat, options?: unknown) {
  const selection = view.state.selection.main
  let cachedInlineSelection: InlineSelectionRange | null = null
  const inlineSelection = () => {
    if (!cachedInlineSelection) {
      cachedInlineSelection = normalizeLiveInlineSelectionForListContent(view.state, selection)
    }
    return cachedInlineSelection
  }
  const optionRecord = typeof options === 'object' && options !== null ? options as Record<string, unknown> : {}

  switch (action) {
    case 'heading': {
      const rawLevel = typeof options === 'number' ? options : optionRecord.level
      const level = Math.min(6, Math.max(1, typeof rawLevel === 'number' ? rawLevel : 1))
      applyBlockMarker(view, `${'#'.repeat(level)} `)
      return
    }
    case 'bulletList':
      applyBlockMarker(view, '- ')
      return
    case 'numberedList':
      applyBlockMarker(view, '1. ')
      return
    case 'task':
      applyBlockMarker(view, '- [ ] ', { skipExistingTask: true })
      return
    case 'quote':
      insertQuote(view)
      return
    case 'hr':
      insertHr(view)
      return
    case 'codeBlock':
      insertCodeBlock(view, selection)
      return
    case 'table':
      insertTable(
        view,
        selection,
        typeof optionRecord.cols === 'number' ? optionRecord.cols : 3,
        typeof optionRecord.rows === 'number' ? optionRecord.rows : 3,
      )
      return
    case 'link':
      wrapSelection(view, inlineSelection(), '[', ']()', inlineSelection().empty ? 1 : undefined)
      return
    case 'wikiLink':
      wrapSelection(view, inlineSelection(), '[[', ']]')
      return
    case 'image':
      wrapSelection(view, inlineSelection(), '![', ']()', inlineSelection().empty ? 2 : undefined)
      return
    case 'bold':
      toggleInlineWrapper(view, inlineSelection(), '**')
      return
    case 'italic':
      toggleInlineWrapper(view, inlineSelection(), '*')
      return
    case 'lineover':
    case 'strike':
      toggleInlineWrapper(view, inlineSelection(), '~~')
      return
    case 'inlineCode':
      insertInlineFenceForSelection(view, inlineSelection(), '`')
      return
    case 'kbd':
      toggleInlineWrapper(view, inlineSelection(), '<kbd>', '</kbd>')
      return
    default:
      return
  }
}

export function createMeoDiffSplitController({
  baseline,
  diffGutterVisible,
  editable = true,
  fallbackOriginalLabel,
  fallbackOriginalText,
  gitChangeContext,
  lineNumbersVisible,
  onChange,
  onApplyGitDiffSelection,
  onCompositionChange,
  onOpenLink,
  onSave,
  onSelectionChange,
  onViewportChange,
  parent,
  text,
}: MeoDiffSplitControllerOptions): MeoDiffSplitController {
  let currentBaseline = baseline
  let currentFallbackOriginal = {
    label: fallbackOriginalLabel,
    text: fallbackOriginalText,
  }
  let currentGitChangeContext = gitChangeContext
  let currentText = text
  let currentDiffGutterVisible = diffGutterVisible !== false
  let currentLineNumbersVisible = lineNumbersVisible
  let applyingHunkAction = false
  let destroyed = false
  let applyingExternal = false
  let isComposing = false
  let mergeView: MergeView | null = null
  let lastRenderedState: DiffSplitResolvedState | null = null
  let preferredGitDiffScope: GitChangeScope | null = null
  let deferredFrameSyncUntilCompositionEnd = false
  let pendingFrameSync = false
  let cleanupMergeViewDomListeners: (() => void) | null = null
  let cleanupReadOnlyWidgetLock: (() => void) | null = null
  let mergeScrollArea: ReturnType<typeof mountMeoBaseScrollArea> | null = null
  let diffOverviewRuler: ReturnType<typeof createGitDiffOverviewRulerController> | null = null
  let diffOverviewSegmentsCache: GitDiffOverviewSegment[] | null = null
  let diffScrollPastEndObserver: ResizeObserver | null = null
  let diffScrollPastEndFrame = 0
  let pendingReadOnlyWidgetLockFrame = 0
  let pendingScrollFrame = 0
  let pendingDeferredDiffRefreshFrame = 0
  let pendingDeferredDiffRefreshTimer = 0
  let syncedOriginalGitBaseText: string | null = null
  let syncedModifiedGitBaseText: string | null = null
  let appliedModifiedReadOnly: boolean | null = null
  const pendingReadOnlyWidgetRoots = new Set<Element>()
  const originalNavigationHighlightTimerRef = { current: null as number | null }
  const modifiedNavigationHighlightTimerRef = { current: null as number | null }
  const originalLineNumbersCompartment = new Compartment()
  const modifiedLineNumbersCompartment = new Compartment()
  const originalActiveLineGutterCompartment = new Compartment()
  const modifiedActiveLineGutterCompartment = new Compartment()
  const originalEditableCompartment = new Compartment()
  const modifiedEditableCompartment = new Compartment()
  const originalReadOnlyCompartment = new Compartment()
  const modifiedReadOnlyCompartment = new Compartment()
  const originalTextSnapshot: TextSnapshot = { value: '' }
  const modifiedTextSnapshot: TextSnapshot = { value: '' }
  const host = document.createElement('div')
  host.className = 'meo-diff-split-host'

  const header = document.createElement('div')
  header.className = 'meo-diff-split-header'

  const originalLabel = document.createElement('div')
  originalLabel.className = 'meo-diff-split-label'

  const modifiedLabel = document.createElement('div')
  modifiedLabel.className = 'meo-diff-split-label'
  modifiedLabel.textContent = 'Current document'

  const body = document.createElement('div')
  body.className = 'meo-diff-split-body'

  host.append(header, body)
  parent.appendChild(host)

  const invalidateDiffOverviewSegments = () => {
    if (mergeView?.hasPendingChunkRefresh()) {
      return
    }
    diffOverviewSegmentsCache = null
  }

  const getDiffOverviewSegments = (): GitDiffOverviewSegment[] => {
    if (diffOverviewSegmentsCache) {
      return diffOverviewSegmentsCache
    }

    if (!mergeView) {
      return []
    }

    const currentMergeView = mergeView
    if (currentMergeView.hasPendingChunkRefresh()) {
      return diffOverviewSegmentsCache ?? []
    }

    const modifiedDoc = currentMergeView.b.state.doc
    const totalLines = Math.max(1, modifiedDoc.lines)
    const chunks = currentMergeView.chunks as readonly CodeMirrorDiffChunk[]

    diffOverviewSegmentsCache = chunks.map((chunk) => {
      const selection = createSelectionFromCodeMirrorChunk(currentMergeView.a.state.doc, modifiedDoc, chunk)
      const modifiedLineCount = Math.max(0, selection.modifiedLineCount)
      const originalLineCount = Math.max(0, selection.originalLineCount)
      const fromLine = clampNumber(
        modifiedLineCount === 0 ? Math.max(1, selection.modifiedStartLine) : selection.modifiedStartLine,
        1,
        totalLines,
      )
      const toLine = clampNumber(
        modifiedLineCount === 0 ? fromLine : fromLine + modifiedLineCount - 1,
        fromLine,
        totalLines,
      )

      return {
        added: originalLineCount === 0 && modifiedLineCount > 0,
        deleted: modifiedLineCount === 0 && originalLineCount > 0,
        fromLine,
        modified: originalLineCount > 0 && modifiedLineCount > 0,
        toLine,
      }
    })
    return diffOverviewSegmentsCache
  }

  const ensureDiffOverviewRuler = () => {
    if (!mergeView || diffOverviewRuler) {
      diffOverviewRuler?.refresh()
      return
    }

    diffOverviewRuler = createGitDiffOverviewRulerController({
      getMode: () => 'diff-split',
      getScrollElement: () => mergeView?.dom,
      getSegments: getDiffOverviewSegments,
      getTrackHeight: () => body.clientHeight,
      hostClassName: 'meo-diff-split-overview-ruler',
      hostParent: body,
      isGitChangesVisible: () => currentDiffGutterVisible,
      observeElements: () => [
        body,
        mergeView?.dom,
        mergeView?.b.dom,
        mergeView?.b.contentDOM,
      ],
      view: mergeView.b,
    })
  }

  const resetDiffOverviewRender = () => {
    ensureDiffOverviewRuler()
    diffOverviewRuler?.refresh()
  }

  const destroyDiffOverview = () => {
    diffOverviewRuler?.destroy()
    diffOverviewRuler = null
    invalidateDiffOverviewSegments()
  }

  const cancelPendingScrollSync = () => {
    if (pendingScrollFrame) {
      window.cancelAnimationFrame(pendingScrollFrame)
      pendingScrollFrame = 0
    }
  }

  const cancelPendingDeferredDiffRefresh = () => {
    if (pendingDeferredDiffRefreshTimer) {
      window.clearTimeout(pendingDeferredDiffRefreshTimer)
      pendingDeferredDiffRefreshTimer = 0
    }
    if (pendingDeferredDiffRefreshFrame) {
      window.cancelAnimationFrame(pendingDeferredDiffRefreshFrame)
      pendingDeferredDiffRefreshFrame = 0
    }
  }

  const syncSplitGutterLineFlagsFromChunks = () => {
    if (!mergeView) {
      return
    }

    const chunks = mergeView.chunks as readonly CodeMirrorDiffChunk[]
    const originalDoc = mergeView.a.state.doc
    const modifiedDoc = mergeView.b.state.doc
    setGitDiffLineFlags(
      mergeView.a,
      buildDiffSplitGutterFlagsFromChunks(originalDoc, modifiedDoc, chunks, 'original'),
    )
    setGitDiffLineFlags(
      mergeView.b,
      buildDiffSplitGutterFlagsFromChunks(originalDoc, modifiedDoc, chunks, 'modified'),
    )
  }

  const refreshDiffArtifactsNow = () => {
    cancelPendingDeferredDiffRefresh()
    if (destroyed || !mergeView || isComposing) {
      return
    }

    syncDiffSplitGitBaselines(getOriginalState(), { deferLineFlags: true })
    mergeView.refreshChunks()
    syncSplitGutterLineFlagsFromChunks()
    invalidateDiffOverviewSegments()
    resetDiffOverviewRender()
  }

  const refreshDeferredDiffArtifactsBeforeChunkAction = () => {
    if (!mergeView?.hasPendingChunkRefresh()) {
      return true
    }

    if (isComposing) {
      return false
    }

    refreshDiffArtifactsNow()
    return !mergeView?.hasPendingChunkRefresh()
  }

  const scheduleDeferredDiffRefresh = (delayMs = SPLIT_DIFF_REFRESH_IDLE_DELAY_MS) => {
    if (pendingDeferredDiffRefreshTimer) {
      window.clearTimeout(pendingDeferredDiffRefreshTimer)
      pendingDeferredDiffRefreshTimer = 0
    }

    pendingDeferredDiffRefreshTimer = window.setTimeout(() => {
      pendingDeferredDiffRefreshTimer = 0
      if (pendingDeferredDiffRefreshFrame) {
        return
      }

      pendingDeferredDiffRefreshFrame = window.requestAnimationFrame(() => {
        pendingDeferredDiffRefreshFrame = 0
        refreshDiffArtifactsNow()
      })
    }, Math.max(0, delayMs))
  }

  const cancelPendingReadOnlyWidgetLock = () => {
    if (pendingReadOnlyWidgetLockFrame) {
      window.cancelAnimationFrame(pendingReadOnlyWidgetLockFrame)
      pendingReadOnlyWidgetLockFrame = 0
    }
    pendingReadOnlyWidgetRoots.clear()
  }

  const syncDiffScrollPastEndPadding = () => {
    if (!mergeView) {
      return
    }

    const scrollContainer = mergeView.dom
    const syncViewPadding = (view: EditorView) => {
      const height = scrollContainer.clientHeight
        - view.defaultLineHeight
        - view.documentPadding.top
        - 0.5
      view.dom.style.setProperty(
        '--meo-diff-split-scroll-past-end-padding',
        `${Math.max(0, height)}px`,
      )
    }

    syncViewPadding(mergeView.a)
    syncViewPadding(mergeView.b)
  }

  const scheduleDiffScrollPastEndPaddingSync = () => {
    if (diffScrollPastEndFrame) {
      return
    }

    diffScrollPastEndFrame = window.requestAnimationFrame(() => {
      diffScrollPastEndFrame = 0
      syncDiffScrollPastEndPadding()
    })
  }

  const destroyDiffScrollPastEndObserver = () => {
    diffScrollPastEndObserver?.disconnect()
    diffScrollPastEndObserver = null
    if (diffScrollPastEndFrame) {
      window.cancelAnimationFrame(diffScrollPastEndFrame)
      diffScrollPastEndFrame = 0
    }
    mergeView?.a.dom.style.removeProperty('--meo-diff-split-scroll-past-end-padding')
    mergeView?.b.dom.style.removeProperty('--meo-diff-split-scroll-past-end-padding')
  }

  const destroyMergeView = () => {
    cancelPendingScrollSync()
    clearDiffSplitNavigationHighlight(mergeView?.a ?? null, originalNavigationHighlightTimerRef)
    clearDiffSplitNavigationHighlight(mergeView?.b ?? null, modifiedNavigationHighlightTimerRef)
    invalidateDiffOverviewSegments()
    syncedOriginalGitBaseText = null
    syncedModifiedGitBaseText = null
    destroyDiffScrollPastEndObserver()
    cancelPendingDeferredDiffRefresh()
    cancelPendingReadOnlyWidgetLock()
    cleanupReadOnlyWidgetLock?.()
    cleanupReadOnlyWidgetLock = null
    cleanupMergeViewDomListeners?.()
    cleanupMergeViewDomListeners = null
    mergeScrollArea?.destroy()
    mergeScrollArea = null
    destroyDiffOverview()
    mergeView?.destroy()
    mergeView = null
    appliedModifiedReadOnly = null
  }

  const syncDiffGutterVisibility = () => {
    mergeView?.a.dom.classList.toggle('meo-git-gutter-hidden', !currentDiffGutterVisible)
    mergeView?.b.dom.classList.toggle('meo-git-gutter-hidden', !currentDiffGutterVisible)
  }

  const syncModifiedEditability = (readOnly: boolean) => {
    if (!mergeView || appliedModifiedReadOnly === readOnly) {
      return
    }

    appliedModifiedReadOnly = readOnly
    mergeView.b.dispatch({
      effects: [
        modifiedEditableCompartment.reconfigure(createEditableExtension(editable, readOnly)),
        modifiedReadOnlyCompartment.reconfigure(createReadOnlyExtension(editable, readOnly)),
      ],
    })
  }

  const syncDiffSplitGitBaselines = (
    originalState: DiffSplitResolvedState,
    options: { deferLineFlags?: boolean, force?: boolean } = {},
  ) => {
    const changed = {
      modified: false,
      original: false,
    }
    if (!mergeView) {
      return changed
    }

    if (options.force || syncedOriginalGitBaseText !== originalState.modifiedText) {
      syncedOriginalGitBaseText = originalState.modifiedText
      changed.original = true
      setGitBaseline(mergeView.a, {
        available: true,
        baseText: originalState.modifiedText,
        headOid: null,
        indexText: null,
        tracked: true,
      }, { deferLineFlags: options.deferLineFlags === true })
    }

    if (options.force || syncedModifiedGitBaseText !== originalState.text) {
      syncedModifiedGitBaseText = originalState.text
      changed.modified = true
      setGitBaseline(mergeView.b, {
        available: true,
        baseText: originalState.text,
        headOid: null,
        indexText: null,
        tracked: true,
      }, { deferLineFlags: options.deferLineFlags === true })
    }

    return changed
  }

  const syncTextSnapshotToView = (
    view: EditorView,
    snapshot: TextSnapshot,
    nextText: string,
    annotations: Annotation<unknown> | readonly Annotation<unknown>[],
  ) => {
    if (snapshot.value.length !== view.state.doc.length) {
      view.dispatch({
        annotations,
        changes: {
          from: 0,
          insert: nextText,
          to: view.state.doc.length,
        },
      })
      snapshot.value = nextText
      return true
    }

    const syncChange = findSyncChange(snapshot.value, nextText)
    if (!syncChange) {
      return false
    }

    view.dispatch({
      annotations,
      changes: syncChange,
    })
    snapshot.value = nextText
    return true
  }

  const scheduleReadOnlyWidgetLock = (rootElement: Element) => {
    pendingReadOnlyWidgetRoots.add(rootElement)
    if (pendingReadOnlyWidgetLockFrame) {
      return
    }

    pendingReadOnlyWidgetLockFrame = window.requestAnimationFrame(() => {
      pendingReadOnlyWidgetLockFrame = 0
      const roots = Array.from(pendingReadOnlyWidgetRoots)
      pendingReadOnlyWidgetRoots.clear()
      if (destroyed) {
        return
      }

      for (const rootElement of roots) {
        if (rootElement.isConnected) {
          lockReadOnlyWidgets(rootElement)
        }
      }
    })
  }

  const getOriginalState = () => resolveOriginalText(
    currentBaseline,
    currentFallbackOriginal,
    currentText,
    currentGitChangeContext,
    preferredGitDiffScope,
  )

  const syncLabels = (originalState = getOriginalState()) => {
    originalLabel.textContent = originalState.label
    originalLabel.title = originalState.isFallback && originalState.reason
      ? `Using saved document because Git baseline is unavailable: ${originalState.reason}`
      : `${originalState.label} vs ${originalState.modifiedLabel}`
    modifiedLabel.textContent = originalState.modifiedLabel
    modifiedLabel.title = `${originalState.label} vs ${originalState.modifiedLabel}`
  }

  const getHunkActions = (originalState = getOriginalState()): GitDiffBlockAction[] => {
    if (originalState.actionScope === 'unstaged') {
      return ['stage', 'discard']
    }

    if (originalState.actionScope === 'staged') {
      return ['unstage']
    }

    return []
  }

  const getRevertControls = (originalState: DiffSplitResolvedState) => (
    editable && originalState.actionChange && onApplyGitDiffSelection ? 'a-to-b' : undefined
  )

  const getChunkForActionControl = (control: HTMLElement) => {
    if (!mergeView) {
      return null
    }

    const hadPendingChunkRefresh = mergeView.hasPendingChunkRefresh()
    if (!refreshDeferredDiffArtifactsBeforeChunkAction() || hadPendingChunkRefresh) {
      return null
    }

    const controlsRoot = control.closest<HTMLElement>('.meo-diff-hunk-actions')
    const chunkIndex = Number.parseInt(controlsRoot?.dataset.chunk ?? '', 10)
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      return null
    }

    return (mergeView.chunks[chunkIndex] as CodeMirrorDiffChunk | undefined) ?? null
  }

  const applyHunkAction = async (
    control: HTMLElement,
    action: GitDiffBlockAction,
  ) => {
    const originalState = getOriginalState()
    const chunk = getChunkForActionControl(control)
    if (
      applyingHunkAction
      || !chunk
      || !mergeView
      || !originalState.actionChange
      || !onApplyGitDiffSelection
    ) {
      return
    }

    applyingHunkAction = true
    mergeView.reconfigure({
      renderRevertControl: createHunkActionControls,
    })
    try {
      await onApplyGitDiffSelection(
        originalState.actionChange,
        createSelectionFromCodeMirrorChunk(mergeView.a.state.doc, mergeView.b.state.doc, chunk),
        action,
      )
    } finally {
      applyingHunkAction = false
      mergeView?.reconfigure({
        renderRevertControl: createHunkActionControls,
      })
    }
  }

  const handleHunkActionEvent = (
    event: MouseEvent | KeyboardEvent,
    action: GitDiffBlockAction,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    void applyHunkAction(event.currentTarget as HTMLElement, action)
  }

  const createHunkActionButton = (action: GitDiffBlockAction) => {
    const button = document.createElement('button')
    const label = applyingHunkAction ? 'Wait for the current Git block action to finish.' : getHunkActionLabel(action)
    button.type = 'button'
    button.className = 'meo-diff-hunk-action'
    button.dataset.action = action
    button.disabled = applyingHunkAction
    button.setAttribute('aria-label', label)
    button.setAttribute('aria-disabled', applyingHunkAction ? 'true' : 'false')
    button.innerHTML = getHunkActionIcon(action)
    button.onmousedown = (event) => {
      handleHunkActionEvent(event, action)
    }
    button.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        handleHunkActionEvent(event, action)
      }
    }
    return button
  }

  const createHunkActionControls = () => {
    const container = document.createElement('div')
    container.className = 'meo-diff-hunk-actions'
    container.classList.toggle('is-busy', applyingHunkAction)
    container.setAttribute('aria-label', 'Git block actions')
    container.onmousedown = (event) => {
      event.preventDefault()
      event.stopPropagation()
    }

    for (const action of getHunkActions()) {
      container.appendChild(createHunkActionButton(action))
    }

    return container
  }

  const scheduleResolvedFrameSync = () => {
    if (pendingFrameSync) {
      return
    }

    pendingFrameSync = true
    queueMicrotask(() => {
      pendingFrameSync = false
      if (destroyed) {
        return
      }

      const nextState = getOriginalState()
      if (lastRenderedState && !hasResolvedViewFrameChanged(lastRenderedState, nextState)) {
        lastRenderedState = nextState
        syncLabels(nextState)
        return
      }

      syncResolvedDocuments()
    })
  }

  const requestResolvedFrameSync = () => {
    if (isComposing) {
      deferredFrameSyncUntilCompositionEnd = true
      return
    }

    scheduleResolvedFrameSync()
  }

  const handleCompositionChange = (nextValue: boolean) => {
    isComposing = nextValue
    onCompositionChange?.(nextValue)
    if (nextValue) {
      cancelPendingDeferredDiffRefresh()
    }
    if (!nextValue && deferredFrameSyncUntilCompositionEnd) {
      deferredFrameSyncUntilCompositionEnd = false
      scheduleResolvedFrameSync()
    }
    if (!nextValue) {
      scheduleDeferredDiffRefresh(SPLIT_DIFF_REFRESH_AFTER_COMPOSITION_MS)
    }
  }

  const render = () => {
    if (destroyed) {
      return
    }

    destroyMergeView()
    body.replaceChildren()

    const originalState = getOriginalState()
    lastRenderedState = originalState
    originalTextSnapshot.value = originalState.text
    modifiedTextSnapshot.value = originalState.modifiedText
    syncLabels(originalState)
    header.replaceChildren(originalLabel, modifiedLabel)

    mergeView = new MergeView({
      a: {
        doc: originalState.text,
        extensions: createDiffExtensions({
          activeLineGutterCompartment: originalActiveLineGutterCompartment,
          editable: false,
          editableCompartment: originalEditableCompartment,
          interactive: false,
          lineNumbersCompartment: originalLineNumbersCompartment,
          lineNumbersVisible: currentLineNumbersVisible,
          onChange: () => undefined,
          readOnlyCompartment: originalReadOnlyCompartment,
          readOnly: true,
          side: 'original',
          textSnapshot: originalTextSnapshot,
        }),
      },
      b: {
        doc: originalState.modifiedText,
        extensions: createDiffExtensions({
          activeLineGutterCompartment: modifiedActiveLineGutterCompartment,
          editable,
          editableCompartment: modifiedEditableCompartment,
          lineNumbersCompartment: modifiedLineNumbersCompartment,
          lineNumbersVisible: currentLineNumbersVisible,
          onChange: (nextValue) => {
            if (applyingExternal) {
              return
            }
            const previousState = lastRenderedState ?? getOriginalState()
            currentText = nextValue
            if (canUseTextOnlyResolvedUpdate(previousState, currentGitChangeContext)) {
              lastRenderedState = {
                ...previousState,
                modifiedText: nextValue,
              }
              scheduleDeferredDiffRefresh()
              invalidateDiffOverviewSegments()
              onChange(nextValue)
              return
            }

            const nextState = getOriginalState()
            if (hasResolvedViewFrameChanged(previousState, nextState)) {
              requestResolvedFrameSync()
            } else {
              lastRenderedState = nextState
              scheduleDeferredDiffRefresh()
            }
            invalidateDiffOverviewSegments()
            onChange(nextValue)
          },
          onCompositionChange: handleCompositionChange,
          onOpenLink,
          onSave,
          onSelectionChange,
          onViewportChange,
          readOnlyCompartment: modifiedReadOnlyCompartment,
          reportViewportChanges: false,
          readOnly: () => getOriginalState().modifiedReadOnly,
          side: 'modified',
          textSnapshot: modifiedTextSnapshot,
        }),
      },
      diffConfig: getDiffConfig(editable),
      deferChunkUpdates: shouldDeferSplitMergeChunkUpdate,
      gutter: false,
      highlightChanges: true,
      outerScrollViewportMargin: 8000,
      outerScrollViewportRetention: 32000,
      parent: body,
      renderRevertControl: createHunkActionControls,
      revertControls: getRevertControls(originalState),
    })

    mergeView.dom.classList.add('meo-diff-split-merge-view')
    appliedModifiedReadOnly = originalState.modifiedReadOnly
    syncDiffSplitGitBaselines(originalState, { deferLineFlags: true, force: true })
    syncSplitGutterLineFlagsFromChunks()
    syncDiffGutterVisibility()
    mergeScrollArea = mountMeoBaseScrollArea({
      className: 'meo-diff-split-base-scroll-area',
      hostParent: body,
      viewport: mergeView.dom,
    })
    diffScrollPastEndObserver = new ResizeObserver(scheduleDiffScrollPastEndPaddingSync)
    diffScrollPastEndObserver.observe(mergeView.dom)
    lockReadOnlyWidgets(mergeView.a.dom)
    const readOnlyWidgetObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) {
            scheduleReadOnlyWidgetLock(node)
          }
        }
      }
    })
    readOnlyWidgetObserver.observe(mergeView.a.dom, {
      childList: true,
      subtree: true,
    })
    cleanupReadOnlyWidgetLock = () => {
      readOnlyWidgetObserver.disconnect()
      cancelPendingReadOnlyWidgetLock()
    }
    const handleMergeScroll = () => {
      if (pendingScrollFrame) {
        return
      }

      pendingScrollFrame = window.requestAnimationFrame(() => {
        pendingScrollFrame = 0
        if (destroyed || !mergeView) {
          return
        }
        onSelectionChange?.(null)
        onViewportChange?.()
      })
    }
    const handleTableInteraction = (event: Event) => {
      const active = Boolean((event as CustomEvent<{ active?: boolean }>).detail?.active)
      mergeView?.b.dom.classList.toggle('meo-table-interaction-active', active)
    }
    const handleTableOpenLink = (event: Event) => {
      const href = (event as CustomEvent<{ href?: unknown }>).detail?.href
      if (typeof href === 'string' && href) {
        onOpenLink?.(href)
      }
    }
    const handleTableSelectionChange = () => {
      const activeElement = document.activeElement
      if (!(activeElement instanceof HTMLTextAreaElement) || !mergeView?.b.dom.contains(activeElement)) {
        onSelectionChange?.(null)
        return
      }

      const rawStart = activeElement.selectionStart ?? 0
      const rawEnd = activeElement.selectionEnd ?? rawStart
      if (rawStart === rawEnd) {
        onSelectionChange?.(null)
        return
      }

      const rect = activeElement.getBoundingClientRect()
      onSelectionChange?.({
        anchorX: rect.left + Math.min(rect.width / 2, 48),
        anchorY: rect.top,
        visible: true,
      })
    }
    mergeView.dom.addEventListener('scroll', handleMergeScroll, { passive: true })
    mergeView.b.dom.addEventListener('meo-table-interaction', handleTableInteraction)
    mergeView.b.dom.addEventListener('meo-open-link', handleTableOpenLink)
    mergeView.b.dom.addEventListener('meo-table-selection-change', handleTableSelectionChange)
    cleanupMergeViewDomListeners = () => {
      mergeView?.dom.removeEventListener('scroll', handleMergeScroll)
      mergeView?.b.dom.removeEventListener('meo-table-interaction', handleTableInteraction)
      mergeView?.b.dom.removeEventListener('meo-open-link', handleTableOpenLink)
      mergeView?.b.dom.removeEventListener('meo-table-selection-change', handleTableSelectionChange)
    }
    forceParsing(mergeView.a, mergeView.a.state.doc.length, 500)
    forceParsing(mergeView.b, mergeView.b.state.doc.length, 500)
    expandAllCollapsibleSections(mergeView.a)
    expandAllCollapsibleSections(mergeView.b)
    syncDiffScrollPastEndPadding()
    mergeScrollArea.refresh()
    resetDiffOverviewRender()
  }

  render()

  const getEditableView = () => {
    if (!mergeView) {
      throw new Error('Diff split view is not mounted.')
    }
    return mergeView.b
  }

  const getEditableTextValue = () => (
    mergeView ? modifiedTextSnapshot.value : currentText
  )

  const getRequestedLineForScope = (request: MeoDiffSplitGitNavigationRequest) => {
    const normalizedLine = Math.max(1, Math.floor(request.lineNumber))
    if (
      request.scope !== 'staged'
      || typeof currentBaseline?.indexText !== 'string'
      || normalizeLineEndings(currentText) === normalizeLineEndings(currentBaseline.indexText)
    ) {
      return normalizedLine
    }

    return mapCurrentLineToIndexLine(currentBaseline.indexText, currentText, normalizedLine)
  }

  const resolveGitNavigationTarget = (request: MeoDiffSplitGitNavigationRequest) => {
    if (!mergeView) {
      return null
    }

    if (!refreshDeferredDiffArtifactsBeforeChunkAction()) {
      return null
    }

    const originalState = getOriginalState()
    if (originalState.actionScope !== request.scope) {
      return null
    }

    const requestedLineNumber = getRequestedLineForScope(request)
    const preferredSide: DiffNavigationSide = 'modified'
    const target = findBestNavigationTarget(
      mergeView.a.state.doc,
      mergeView.b.state.doc,
      mergeView.chunks as readonly CodeMirrorDiffChunk[],
      requestedLineNumber,
      preferredSide,
    )

    if (!target || target.distance !== 0) {
      return null
    }

    return target
  }

  const revealGitNavigationTarget = (request: MeoDiffSplitGitNavigationRequest) => {
    const target = resolveGitNavigationTarget(request)
    if (!target || !mergeView) {
      return false
    }

    const view = target.target.side === 'original' ? mergeView.a : mergeView.b
    const activeTimerRef = target.target.side === 'original'
      ? originalNavigationHighlightTimerRef
      : modifiedNavigationHighlightTimerRef
    const inactiveTimerRef = target.target.side === 'original'
      ? modifiedNavigationHighlightTimerRef
      : originalNavigationHighlightTimerRef
    const inactiveView = target.target.side === 'original' ? mergeView.b : mergeView.a

    revealLine(view, target.target.lineNumber, {
      focusEditor: target.target.focusEditor,
      scrollContainer: mergeView.dom,
      selectLine: target.target.selectLine,
    })
    applyDiffSplitNavigationHighlight(view, target.target.lineNumber, activeTimerRef)
    clearDiffSplitNavigationHighlight(inactiveView, inactiveTimerRef)
    return true
  }

  const syncResolvedDocuments = () => {
    const originalState = getOriginalState()
    lastRenderedState = originalState
    syncLabels(originalState)
    syncModifiedEditability(originalState.modifiedReadOnly)

    const originalView = mergeView?.a
    const modifiedView = mergeView?.b
    if (!originalView || !modifiedView) {
      return
    }

    if (originalTextSnapshot.value !== originalState.text) {
      invalidateDiffOverviewSegments()
      syncTextSnapshotToView(
        originalView,
        originalTextSnapshot,
        originalState.text,
        allowReadOnlyDocumentUpdate.of(true),
      )
    }

    if (modifiedTextSnapshot.value !== originalState.modifiedText) {
      invalidateDiffOverviewSegments()
      syncTextSnapshotToView(
        modifiedView,
        modifiedTextSnapshot,
        originalState.modifiedText,
        [
          externalDocumentSync.of(true),
          Transaction.addToHistory.of(false),
        ],
      )
    }
    mergeView?.reconfigure({
      diffConfig: getDiffConfig(editable),
      renderRevertControl: createHunkActionControls,
      revertControls: getRevertControls(originalState),
    })
    scheduleDeferredDiffRefresh()
  }

  const findMatch = (
    query: string,
    backward = false,
    options: SearchOptions & { focusEditor?: boolean } = {},
  ): SearchNavigationResult => {
    const view = getEditableView()
    if (!query) {
      return { current: 0, found: false, total: 0 }
    }

    const textValue = getEditableTextValue()
    const matches = findSearchMatchRanges(textValue, query, options)
    const total = matches.length
    if (!total) {
      return { current: 0, found: false, total: 0 }
    }

    const selection = view.state.selection.main
    const cursor = backward ? Math.min(selection.from, selection.to) : Math.max(selection.from, selection.to)
    let matchIndex = -1
    if (backward) {
      for (let index = matches.length - 1; index >= 0; index -= 1) {
        if (matches[index].end <= cursor) {
          matchIndex = index
          break
        }
      }
      if (matchIndex < 0) {
        matchIndex = matches.length - 1
      }
    } else {
      for (let index = 0; index < matches.length; index += 1) {
        if (matches[index].start >= cursor) {
          matchIndex = index
          break
        }
      }
      if (matchIndex < 0) {
        matchIndex = 0
      }
    }

    const match = matches[matchIndex]
    view.dispatch({
      selection: EditorSelection.range(match.start, match.end),
    })
    scrollPositionIntoView(view, match.start, 'center', mergeView?.dom ?? null)
    if (options.focusEditor !== false) {
      view.focus()
    }
    return { current: matchIndex + 1, found: true, total }
  }

  return {
    countMatches(query, options = {}) {
      return countSearchMatches(getEditableTextValue(), query, options)
    },
    destroy() {
      if (destroyed) {
        return
      }

      destroyed = true
      handleCompositionChange(false)
      destroyMergeView()
      host.remove()
    },
    findNext(query, options = {}) {
      return findMatch(query, false, options)
    },
    findPrevious(query, options = {}) {
      return findMatch(query, true, options)
    },
    focus() {
      const activeTableInput = mergeView?.b ? getActiveTableInput(mergeView.b) : null
      if (activeTableInput) {
        activeTableInput.focus({ preventScroll: true })
        return
      }
      mergeView?.b.focus()
    },
    getHeadings() {
      return extractHeadings(getEditableView().state)
    },
    getText() {
      if (getOriginalState().modifiedReadOnly) {
        return currentText
      }
      return mergeView ? modifiedTextSnapshot.value : currentText
    },
    getTopVisiblePosition() {
      return getTopVisiblePosition(mergeView?.b ?? null, mergeView?.dom ?? null)
    },
    hasFocus() {
      return mergeView?.b.hasFocus === true
    },
    insertFormat(action, options) {
      const view = getEditableView()
      const activeTableInput = getActiveTableInput(view)
      if (activeTableInput && insertFormatInActiveTableInput(activeTableInput, action, onSelectionChange)) {
        return
      }

      insertSimpleFormat(view, action, options)
      view.focus()
    },
    moveHeadingSection(sourceHeadingFrom, targetHeadingFrom, placement) {
      if (placement !== 'before' && placement !== 'after') {
        return false
      }

      const view = getEditableView()
      const sections = extractHeadingSections(view.state)
      const source = sections.find((heading) => heading.from === sourceHeadingFrom)
      const target = sections.find((heading) => heading.from === targetHeadingFrom)
      if (!source || !target) {
        return false
      }

      const insertionPoint = placement === 'before' ? target.sectionFrom : target.sectionTo
      if (insertionPoint > source.sectionFrom && insertionPoint < source.sectionTo) {
        return false
      }

      const textValue = getEditableTextValue()
      const movedText = textValue.slice(source.sectionFrom, source.sectionTo)
      if (!movedText) {
        return false
      }

      const textWithoutSource = textValue.slice(0, source.sectionFrom) + textValue.slice(source.sectionTo)
      const sourceLength = source.sectionTo - source.sectionFrom
      const adjustedInsertionPoint = insertionPoint >= source.sectionTo ? insertionPoint - sourceLength : insertionPoint
      const nextText = `${textWithoutSource.slice(0, adjustedInsertionPoint)}${movedText}${textWithoutSource.slice(adjustedInsertionPoint)}`
      if (nextText === textValue) {
        return false
      }

      view.dispatch({
        changes: { from: 0, insert: nextText, to: textValue.length },
        selection: { anchor: adjustedInsertionPoint },
      })
      scrollPositionIntoView(view, adjustedInsertionPoint, 'top', mergeView?.dom ?? null)
      return true
    },
    nextChange() {
      if (!refreshDeferredDiffArtifactsBeforeChunkAction()) {
        return false
      }
      const found = goToNextChunk(getEditableView())
      if (found) {
        scrollPositionIntoView(getEditableView(), getEditableView().state.selection.main.head, 'center', mergeView?.dom ?? null)
      }
      return found
    },
    previousChange() {
      if (!refreshDeferredDiffArtifactsBeforeChunkAction()) {
        return false
      }
      const found = goToPreviousChunk(getEditableView())
      if (found) {
        scrollPositionIntoView(getEditableView(), getEditableView().state.selection.main.head, 'center', mergeView?.dom ?? null)
      }
      return found
    },
    revealGitChangeLine(request) {
      if (destroyed || !mergeView) {
        return false
      }

      const previousScope = preferredGitDiffScope
      preferredGitDiffScope = request.scope
      syncResolvedDocuments()

      if (!resolveGitNavigationTarget(request)) {
        preferredGitDiffScope = previousScope
        syncResolvedDocuments()
        return false
      }

      window.requestAnimationFrame(() => {
        if (destroyed) {
          return
        }
        revealGitNavigationTarget(request)
      })
      return true
    },
    refreshLayout() {
      mergeView?.a.requestMeasure()
      mergeView?.b.requestMeasure()
      if (mergeView) {
        forceParsing(mergeView.a, mergeView.a.state.doc.length, 500)
        forceParsing(mergeView.b, mergeView.b.state.doc.length, 500)
      }
      syncDiffScrollPastEndPadding()
      mergeScrollArea?.refresh()
      resetDiffOverviewRender()
    },
    refreshDecorations() {
      mergeView?.a.dispatch({})
      mergeView?.b.dispatch({})
    },
    replaceAll(query, replacement, options = {}) {
      if (!query) {
        return { replaced: 0, total: 0 }
      }

      const view = getEditableView()
      const textValue = getEditableTextValue()
      const matches = findSearchMatchRanges(textValue, query, options)
      const replaced = matches.length
      if (!replaced) {
        return { replaced: 0, total: 0 }
      }

      const nextText = replaceMatchRanges(textValue, matches, replacement)
      view.dispatch({
        changes: { from: 0, insert: nextText, to: textValue.length },
        selection: { anchor: 0 },
      })
      return { replaced, total: countSearchMatches(nextText, query, options) }
    },
    replaceCurrent(query, replacement, options = {}) {
      if (!query) {
        return { current: 0, found: false, replaced: false, total: 0 }
      }

      const view = getEditableView()
      const textValue = getEditableTextValue()
      const selection = view.state.selection.main
      const from = Math.min(selection.from, selection.to)
      const to = Math.max(selection.from, selection.to)
      const matches = findSearchMatchRanges(textValue, query, options)
      const matchIndex = findSelectedSearchMatchIndex(matches, from, to)
      if (matchIndex < 0) {
        return { replaced: false, ...findMatch(query, false, options) }
      }

      view.dispatch({
        changes: { from, insert: replacement, to },
        selection: { anchor: from, head: from + replacement.length },
      })
      const nextMatch = findMatch(query, false, options)
      return nextMatch.found
        ? { replaced: true, ...nextMatch }
        : { current: 0, found: false, replaced: true, total: countSearchMatches(getEditableTextValue(), query, options) }
    },
    restoreTopLine(lineNumber, lineOffset = 0) {
      restoreTopLine(getEditableView(), lineNumber, lineOffset, mergeView?.dom ?? null)
    },
    scrollToLine(lineNumber, align = 'center') {
      scrollToLine(getEditableView(), lineNumber, align, mergeView?.dom ?? null)
    },
    selectAll() {
      const view = getEditableView()
      view.dispatch({
        selection: {
          anchor: 0,
          head: view.state.doc.length,
        },
      })
      return true
    },
    setBaseline(nextBaseline) {
      currentBaseline = nextBaseline
      syncResolvedDocuments()
    },
    setFallbackOriginal(fallback) {
      currentFallbackOriginal = fallback
      if (!currentBaseline || typeof currentBaseline.baseText !== 'string') {
        syncResolvedDocuments()
      }
    },
    setGitChangeContext(context) {
      currentGitChangeContext = context
      syncResolvedDocuments()
    },
    setDiffGutterVisible(visible) {
      currentDiffGutterVisible = visible !== false
      syncDiffGutterVisibility()
      resetDiffOverviewRender()
    },
    setLineNumbersVisible(visible) {
      currentLineNumbersVisible = visible !== false
      const lineNumberExtensions = createLineNumberExtensions(currentLineNumbersVisible)
      const activeLineGutterExtensions = createActiveLineGutterExtensions(currentLineNumbersVisible)
      mergeView?.a.dispatch({
        effects: [
          originalLineNumbersCompartment.reconfigure(lineNumberExtensions),
          originalActiveLineGutterCompartment.reconfigure(activeLineGutterExtensions),
        ],
      })
      mergeView?.b.dispatch({
        effects: [
          modifiedLineNumbersCompartment.reconfigure(lineNumberExtensions),
          modifiedActiveLineGutterCompartment.reconfigure(activeLineGutterExtensions),
        ],
      })
      mergeView?.reconfigure({})
    },
    setSearchQuery(query, options = {}) {
      const view = getEditableView()
      const nextQuery = createSearchQueryState(query, options)
      const currentQuery = view.state.field(searchQueryField)
      if (
        currentQuery.text === nextQuery.text
        && currentQuery.wholeWord === nextQuery.wholeWord
        && currentQuery.caseSensitive === nextQuery.caseSensitive
      ) {
        if (nextQuery.text) {
          view.dispatch({
            effects: refreshSearchMatchesEffect.of(null),
          })
        }
        return
      }
      view.dispatch({
        effects: setSearchQueryEffect.of(nextQuery),
      })
    },
    setText(nextText) {
      const previousState = lastRenderedState ?? getOriginalState()
      currentText = nextText
      const originalState = getOriginalState()
      if (hasResolvedViewFrameChanged(previousState, originalState)) {
        invalidateDiffOverviewSegments()
        syncResolvedDocuments()
        return
      }

      lastRenderedState = originalState
      syncLabels(originalState)
      const baselineChanges = syncDiffSplitGitBaselines(originalState, { deferLineFlags: true })
      invalidateDiffOverviewSegments()

      const view = mergeView?.b
      if (!view) {
        return
      }

      const previousText = modifiedTextSnapshot.value
      const syncChange = findSyncChange(previousText, originalState.modifiedText)
      if (!syncChange) {
        if (baselineChanges.original || baselineChanges.modified) {
          if (mergeView?.hasPendingChunkRefresh()) {
            scheduleDeferredDiffRefresh()
          } else {
            syncSplitGutterLineFlagsFromChunks()
          }
        }
        return
      }

      const { anchor, head } = view.state.selection.main
      const newLength = originalState.modifiedText.length
      const mappedAnchor = Math.min(Math.max(0, mapPositionThroughChange(anchor, syncChange)), newLength)
      const mappedHead = Math.min(Math.max(0, mapPositionThroughChange(head, syncChange)), newLength)

      applyingExternal = true
      try {
        view.dispatch({
          annotations: [
            externalDocumentSync.of(true),
            Transaction.addToHistory.of(false),
          ],
          changes: syncChange,
          selection: { anchor: mappedAnchor, head: mappedHead },
        })
        modifiedTextSnapshot.value = originalState.modifiedText
      } finally {
        applyingExternal = false
      }
      if (mergeView?.hasPendingChunkRefresh()) {
        scheduleDeferredDiffRefresh()
      } else {
        syncSplitGutterLineFlagsFromChunks()
      }
      resetDiffOverviewRender()
    },
    undo() {
      return undo(getEditableView())
    },
    redo() {
      return redo(getEditableView())
    },
    get view() {
      return getEditableView()
    },
  }
}
