import { getChunks, getOriginalDoc, type MergeView } from '@codemirror/merge'
import { Compartment, EditorSelection, EditorState, RangeSetBuilder, StateEffect, StateField, Text, Transaction } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { Columns2, Rows2, createElement } from 'lucide'
import type { GitBaselinePayload, GitChangeItem, GitChangeKind, GitChangeScope, GitDiffBlockAction, GitDiffSelection } from '@/features/git/types'
import {
  createSelectionFromCodeMirrorChunk,
  resolveChunkNavigationMatch,
  type CodeMirrorDiffChunk,
} from '@/features/editor/lib/git-diff-navigation'
import {
  buildDiffSplitGutterFlagsFromChunks,
  createMeoDiffSplitMergeView,
  createMeoDiffUnifiedEditorView,
  createTextDocFromContent,
  getDiffConfig,
  getHunkActionIcon,
  getHunkActionLabel,
  lockReadOnlyWidgets,
  mapUnifiedDiffWidgetGutterFlag,
  mapCurrentLineToIndexLine,
  reconfigureMeoDiffSplitLineNumbers,
  reconfigureMeoDiffUnifiedLineNumbers,
  renderUnifiedDeletedContent,
  resolveOriginalText,
  shouldDeferSplitMergeChunkUpdate,
  type DiffSplitResolvedState,
  type TextSnapshot,
} from '@/features/editor/lib/meo-native-diff-split'
import {
  buildCodeMirrorChunksFromVsCodeDiff,
  buildSourceToTargetLineMap,
} from '@/vendor/meo/shared/gitDiffLineFlags'
import {
  setGitBaseline,
  setGitDiffLineFlags,
} from '@/vendor/meo/webview/helpers/gitDiffGutter'

type InlineHunkRequest = {
  anchor: number
  id: string
  scope: GitChangeScope
}

export type InlineDiffViewMode = 'split' | 'unified'

type InlineHunkDescriptor = {
  actionChange: GitChangeItem | null
  actionBusy: boolean
  actionScope: GitChangeScope | null
  changeKind: GitChangeKind
  key: string
  lineNumbersVisible: boolean
  modifiedLabel: string
  modifiedLineStart: number
  modifiedReadOnly: boolean
  modifiedText: string
  originalLabel: string
  originalLineStart: number
  originalText: string
  replaceFrom: number
  replaceTo: number
  requestId: string
  scope: GitChangeScope
  selection: GitDiffSelection
}

type InlineLineRange = {
  endLineExclusive: number
  startLine: number
}

type InlineChunkEntry = {
  chunk: CodeMirrorDiffChunk
  selection: GitDiffSelection
}

type InlineChunkMatch = {
  chunk: CodeMirrorDiffChunk
  displaySelection: GitDiffSelection
  selection: GitDiffSelection
}

type InlineModifiedSelectionPoint = {
  column: number
  lineOffset: number
}

type InlineModifiedSelectionTarget = {
  anchor: InlineModifiedSelectionPoint
  head: InlineModifiedSelectionPoint
}

type InlineModifiedSelectionDescriptor = Pick<InlineHunkDescriptor, 'modifiedText' | 'replaceFrom' | 'replaceTo'>

type InlineOuterSelectionTarget = {
  anchor: number
  head: number
  source: 'inline' | 'outer'
}

type InlineDiffControllerOptions = {
  baseline: GitBaselinePayload | null
  diffGutterVisible: boolean
  editable?: boolean
  fallbackOriginalLabel: string
  fallbackOriginalText: string
  gitChangeContext: {
    stagedChange: GitChangeItem | null
    unstagedChange: GitChangeItem | null
  }
  lineNumbersVisible: boolean
  onApplyGitDiffSelection?: (change: GitChangeItem, selection: GitDiffSelection, action: GitDiffBlockAction) => Promise<void>
  onCompositionChange?: (isComposing: boolean) => void
  onOpenLink?: (href: string) => void
  onSave?: (nextValue: string) => void
  onSelectionChange?: (selectionState: { visible?: boolean, anchorX?: number, anchorY?: number } | null) => void
  onViewportChange?: () => void
  text: string
  view: EditorView
}

export type MeoLiveInlineDiffController = {
  destroy: () => void
  refreshLayout: () => void
  setBaseline: (baseline: GitBaselinePayload | null) => void
  setCompositionActive: (isComposing: boolean) => void
  setDiffGutterVisible: (visible: boolean) => void
  setFallbackOriginal: (fallback: { label: string, text: string }) => void
  setGitChangeContext: (context: { stagedChange: GitChangeItem | null, unstagedChange: GitChangeItem | null }) => void
  setInlineDiffViewMode: (mode: InlineDiffViewMode) => void
  setLineNumbersVisible: (visible: boolean) => void
  setText: (text: string) => void
  toggleHunkForLine: (request: { lineNumber?: number, scope: GitChangeScope }) => boolean
}

const setInlineHunksEffect = StateEffect.define<InlineHunkDescriptor[]>()
const INLINE_DIFF_SYNC_DELAY_MS = 120
const INLINE_DIFF_SYNC_AFTER_COMPOSITION_MS = 80

function normalizeLineEndings(text: string) {
  return text.replace(/\r\n?/g, '\n')
}

function getNavigateIcon(direction: 'next' | 'previous') {
  return direction === 'next'
    ? '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>'
    : '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10l4-4 4 4"/></svg>'
}

function getNextInlineDiffViewMode(mode: InlineDiffViewMode): InlineDiffViewMode {
  return mode === 'unified' ? 'split' : 'unified'
}

function getInlineDiffViewModeToggleIconName(mode: InlineDiffViewMode): InlineDiffViewMode {
  return getNextInlineDiffViewMode(mode)
}

function createInlineDiffViewModeToggleIcon(mode: InlineDiffViewMode) {
  const IconComponent = getInlineDiffViewModeToggleIconName(mode) === 'unified'
    ? Rows2
    : Columns2
  return createElement(IconComponent, { width: 14, height: 14 })
}

function getInlineDiffViewModeToggleLabel(mode: InlineDiffViewMode) {
  return mode === 'unified'
    ? 'Switch to inline split'
    : 'Switch to inline unified'
}

function lineRangeText(doc: Text, startLine: number, lineCount: number) {
  if (lineCount <= 0 || doc.lines <= 0) {
    return ''
  }

  const start = Math.max(1, Math.min(doc.lines, Math.floor(startLine)))
  const end = Math.max(start, Math.min(doc.lines, start + Math.floor(lineCount) - 1))
  return doc.sliceString(doc.line(start).from, doc.line(end).to)
}

function lineRangeOffsets(doc: Text, startLine: number, lineCount: number, fallbackOffset: number) {
  if (lineCount <= 0) {
    const pos = Math.max(0, Math.min(doc.length, Math.floor(fallbackOffset)))
    return { from: pos, to: pos }
  }

  const start = Math.max(1, Math.min(doc.lines, Math.floor(startLine)))
  const end = Math.max(start, Math.min(doc.lines, start + Math.floor(lineCount) - 1))
  return {
    from: doc.line(start).from,
    to: doc.line(end).to,
  }
}

function lineRangeLineCount(range: InlineLineRange) {
  return Math.max(0, range.endLineExclusive - range.startLine)
}

function selectionLineRange(selection: GitDiffSelection, side: 'modified' | 'original'): InlineLineRange {
  const startLine = side === 'original' ? selection.originalStartLine : selection.modifiedStartLine
  const lineCount = side === 'original' ? selection.originalLineCount : selection.modifiedLineCount
  const normalizedStartLine = Math.max(1, Math.floor(startLine || 1))
  return {
    endLineExclusive: normalizedStartLine + Math.max(0, Math.floor(lineCount)),
    startLine: normalizedStartLine,
  }
}

function selectionFromLineRanges(
  originalRange: InlineLineRange,
  modifiedRange: InlineLineRange,
): GitDiffSelection {
  return {
    modifiedLineCount: lineRangeLineCount(modifiedRange),
    modifiedStartLine: lineRangeLineCount(modifiedRange) <= 0
      ? Math.max(0, modifiedRange.startLine)
      : modifiedRange.startLine,
    originalLineCount: lineRangeLineCount(originalRange),
    originalStartLine: lineRangeLineCount(originalRange) <= 0
      ? Math.max(0, originalRange.startLine)
      : originalRange.startLine,
  }
}

function mergeLineRanges(left: InlineLineRange, right: InlineLineRange): InlineLineRange {
  return {
    endLineExclusive: Math.max(left.endLineExclusive, right.endLineExclusive),
    startLine: Math.min(left.startLine, right.startLine),
  }
}

function mergeDiffSelections(selections: readonly [GitDiffSelection, ...GitDiffSelection[]]): GitDiffSelection {
  const [first, ...rest] = selections
  let originalRange = selectionLineRange(first, 'original')
  let modifiedRange = selectionLineRange(first, 'modified')

  for (const selection of rest) {
    originalRange = mergeLineRanges(originalRange, selectionLineRange(selection, 'original'))
    modifiedRange = mergeLineRanges(modifiedRange, selectionLineRange(selection, 'modified'))
  }

  return selectionFromLineRanges(originalRange, modifiedRange)
}

function lineRangesTouchOrOverlap(left: InlineLineRange, right: InlineLineRange) {
  return left.startLine <= right.endLineExclusive && right.startLine <= left.endLineExclusive
}

function selectionsTouchOrOverlap(left: GitDiffSelection, right: GitDiffSelection) {
  return lineRangesTouchOrOverlap(selectionLineRange(left, 'modified'), selectionLineRange(right, 'modified'))
    || lineRangesTouchOrOverlap(selectionLineRange(left, 'original'), selectionLineRange(right, 'original'))
}

function lineRangeContainsLine(range: InlineLineRange, lineNumber: number) {
  return lineNumber >= range.startLine && lineNumber < range.endLineExclusive
}

function hasLineRangeContent(range: InlineLineRange) {
  return lineRangeLineCount(range) > 0
}

function projectModifiedRangeToOriginalRange(
  originalDoc: Text,
  modifiedDoc: Text,
  selection: GitDiffSelection,
): InlineLineRange {
  const fallbackOriginalRange = selectionLineRange(selection, 'original')
  const modifiedRange = selectionLineRange(selection, 'modified')
  if (!hasLineRangeContent(modifiedRange)) {
    return fallbackOriginalRange
  }

  const originalToModifiedLineMap = buildSourceToTargetLineMap(originalDoc, modifiedDoc)
  let firstOriginalLine = Number.POSITIVE_INFINITY
  let lastOriginalLine = 0

  for (let originalLine = 1; originalLine < originalToModifiedLineMap.length; originalLine += 1) {
    const mappedModifiedLine = originalToModifiedLineMap[originalLine]
    if (
      typeof mappedModifiedLine !== 'number'
      || !Number.isInteger(mappedModifiedLine)
      || !lineRangeContainsLine(modifiedRange, mappedModifiedLine)
    ) {
      continue
    }

    firstOriginalLine = Math.min(firstOriginalLine, originalLine)
    lastOriginalLine = Math.max(lastOriginalLine, originalLine)
  }

  const projectedOriginalRange = Number.isFinite(firstOriginalLine)
    ? {
        endLineExclusive: lastOriginalLine + 1,
        startLine: firstOriginalLine,
      }
    : null

  if (!projectedOriginalRange) {
    return fallbackOriginalRange
  }

  return hasLineRangeContent(fallbackOriginalRange)
    ? mergeLineRanges(projectedOriginalRange, fallbackOriginalRange)
    : projectedOriginalRange
}

function createInlineDisplaySelection(
  originalDoc: Text,
  modifiedDoc: Text,
  selection: GitDiffSelection,
): GitDiffSelection {
  return selectionFromLineRanges(
    projectModifiedRangeToOriginalRange(originalDoc, modifiedDoc, selection),
    selectionLineRange(selection, 'modified'),
  )
}

function getDistanceToLineRange(lineNumber: number, range: InlineLineRange) {
  const startLine = Math.max(1, range.startLine)
  const endLine = Math.max(startLine, range.endLineExclusive - 1)

  if (lineNumber < startLine) {
    return startLine - lineNumber
  }
  if (lineNumber > endLine) {
    return lineNumber - endLine
  }
  return 0
}

function getDescriptorRenderKey(descriptor: InlineHunkDescriptor) {
  return [
    descriptor.key,
    descriptor.changeKind,
    descriptor.originalText,
    descriptor.modifiedText,
    descriptor.originalLabel,
    descriptor.modifiedLabel,
    descriptor.originalLineStart,
    descriptor.modifiedLineStart,
    descriptor.lineNumbersVisible ? 'ln' : 'no-ln',
    descriptor.modifiedReadOnly ? 'ro' : 'rw',
    descriptor.actionBusy ? 'busy' : 'idle',
    descriptor.actionScope ?? '',
    descriptor.actionChange ? `${descriptor.actionChange.scope}:${descriptor.actionChange.path}:${descriptor.actionChange.statusCode}` : '',
    descriptor.selection.originalStartLine,
    descriptor.selection.originalLineCount,
    descriptor.selection.modifiedStartLine,
    descriptor.selection.modifiedLineCount,
  ].join('\0')
}

function inferInlineHunkChangeKind(
  actionChange: GitChangeItem | null,
  selection: GitDiffSelection,
): GitChangeKind {
  if (actionChange) {
    return actionChange.kind
  }

  if (selection.originalLineCount <= 0 && selection.modifiedLineCount > 0) {
    return 'added'
  }

  if (selection.modifiedLineCount <= 0 && selection.originalLineCount > 0) {
    return 'deleted'
  }

  return 'modified'
}

function getHunkActions(descriptor: InlineHunkDescriptor): GitDiffBlockAction[] {
  if (!descriptor.actionChange) {
    return []
  }

  if (descriptor.actionScope === 'unstaged') {
    return ['stage', 'discard']
  }

  if (descriptor.actionScope === 'staged') {
    return ['unstage']
  }

  return []
}

function createInlineChunkEntries(
  originalDoc: Text,
  modifiedDoc: Text,
  chunks: readonly CodeMirrorDiffChunk[],
): InlineChunkEntry[] {
  return chunks.map((chunk) => {
    const selection = createSelectionFromCodeMirrorChunk(originalDoc, modifiedDoc, chunk)
    return {
      chunk,
      selection,
    }
  })
}

function findSeedInlineChunkEntry(
  originalDoc: Text,
  modifiedDoc: Text,
  entries: readonly InlineChunkEntry[],
  requestedLineNumber: number,
) {
  let best: { distance: number, entry: InlineChunkEntry, targetSide: 'modified' | 'original' } | null = null

  for (const entry of entries) {
    const match = resolveChunkNavigationMatch(
      originalDoc,
      modifiedDoc,
      entry.chunk,
      requestedLineNumber,
      'modified',
    )
    const displayDistance = getDistanceToLineRange(
      requestedLineNumber,
      selectionLineRange(entry.selection, 'modified'),
    )
    const distance = Math.min(match.distance, displayDistance)
    if (
      !best
      || distance < best.distance
      || (
        distance === best.distance
        && match.target.side === 'modified'
        && best.targetSide !== 'modified'
      )
    ) {
      best = {
        distance,
        entry,
        targetSide: match.target.side,
      }
    }
  }

  return best?.distance === 0 ? best.entry : null
}

function findInlineChunkMatch(
  originalDoc: Text,
  modifiedDoc: Text,
  chunks: readonly CodeMirrorDiffChunk[],
  requestedLineNumber: number,
): InlineChunkMatch | null {
  const entries = createInlineChunkEntries(originalDoc, modifiedDoc, chunks)
  const seed = findSeedInlineChunkEntry(originalDoc, modifiedDoc, entries, requestedLineNumber)
  if (!seed) {
    return null
  }

  const selectedEntries = new Set<InlineChunkEntry>([seed])
  let selection = seed.selection
  let changed = true

  while (changed) {
    changed = false
    for (const entry of entries) {
      if (selectedEntries.has(entry)) {
        continue
      }
      if (
        !selectionsTouchOrOverlap(selection, entry.selection)
      ) {
        continue
      }

      selectedEntries.add(entry)
      selection = mergeDiffSelections([selection, entry.selection])
      changed = true
    }
  }

  return {
    chunk: seed.chunk,
    displaySelection: createInlineDisplaySelection(originalDoc, modifiedDoc, selection),
    selection,
  }
}

function buildDescriptorKey(scope: GitChangeScope, selection: GitDiffSelection) {
  return [
    scope,
    selection.originalStartLine,
    selection.originalLineCount,
    selection.modifiedStartLine,
    selection.modifiedLineCount,
  ].join(':')
}

function getInlineMergeDiffConfig() {
  return getDiffConfig(false)
}

function mapIndexLineToCurrentLine(indexText: string, currentText: string, indexLineNumber: number) {
  const indexDoc = createTextDocFromContent(indexText)
  const currentDoc = createTextDocFromContent(currentText)
  const indexToCurrentLineMap = buildSourceToTargetLineMap(indexDoc, currentDoc)
  const mapped = indexToCurrentLineMap[Math.max(1, Math.floor(indexLineNumber))]
  return Number.isInteger(mapped) && typeof mapped === 'number'
    ? mapped
    : indexLineNumber
}

function createModifiedSelectionPoint(
  doc: Text,
  descriptor: InlineModifiedSelectionDescriptor,
  position: number,
): InlineModifiedSelectionPoint | null {
  const from = Math.max(0, Math.min(doc.length, Math.floor(descriptor.replaceFrom)))
  const to = Math.max(from, Math.min(doc.length, Math.floor(descriptor.replaceTo)))
  const clampedPosition = Math.max(0, Math.min(doc.length, Math.floor(position)))
  if (clampedPosition < from || clampedPosition > to) {
    return null
  }

  const modifiedDoc = createTextDocFromContent(descriptor.modifiedText)
  if (modifiedDoc.lines <= 0) {
    return null
  }

  const replaceStartLine = doc.lineAt(from).number
  const line = doc.lineAt(clampedPosition)
  const lineOffset = line.number - replaceStartLine
  if (lineOffset < 0 || lineOffset >= modifiedDoc.lines) {
    return null
  }

  return {
    column: clampedPosition - line.from,
    lineOffset,
  }
}

function createModifiedSelectionTarget(
  doc: Text,
  descriptor: InlineModifiedSelectionDescriptor,
  selection: { anchor: number, head: number },
): InlineModifiedSelectionTarget | null {
  const anchor = createModifiedSelectionPoint(doc, descriptor, selection.anchor)
  const head = createModifiedSelectionPoint(doc, descriptor, selection.head)
  if (!anchor || !head) {
    return null
  }

  return { anchor, head }
}

function resolveModifiedSelectionPoint(doc: Text, point: InlineModifiedSelectionPoint) {
  if (doc.lines <= 0) {
    return 0
  }

  const lineNumber = Math.max(1, Math.min(doc.lines, Math.floor(point.lineOffset) + 1))
  const line = doc.line(lineNumber)
  const column = Math.max(0, Math.floor(point.column))
  return Math.max(line.from, Math.min(line.to, line.from + column))
}

function resolveModifiedSelectionTargetOffsets(
  doc: Text,
  target: InlineModifiedSelectionTarget,
) {
  return {
    anchor: resolveModifiedSelectionPoint(doc, target.anchor),
    head: resolveModifiedSelectionPoint(doc, target.head),
  }
}

function resolveModifiedEditorSelection(
  doc: Text,
  target: InlineModifiedSelectionTarget,
) {
  const { anchor, head } = resolveModifiedSelectionTargetOffsets(doc, target)
  return EditorSelection.single(anchor, head)
}

function createOuterSelectionTargetFromInlineSelection(
  replaceFrom: number,
  modifiedText: string,
  selection: { anchor: number, head: number },
): InlineOuterSelectionTarget {
  const modifiedDoc = createTextDocFromContent(modifiedText)
  const from = Math.max(0, Math.floor(replaceFrom))
  const clampInlinePosition = (position: number) => Math.max(0, Math.min(modifiedDoc.length, Math.floor(position)))
  return {
    anchor: from + clampInlinePosition(selection.anchor),
    head: from + clampInlinePosition(selection.head),
    source: 'inline',
  }
}

function createOuterSelectionTargetFromOuterSelection(
  doc: Text,
  selection: { anchor: number, head: number },
): InlineOuterSelectionTarget {
  const clampPosition = (position: number) => Math.max(0, Math.min(doc.length, Math.floor(position)))
  return {
    anchor: clampPosition(selection.anchor),
    head: clampPosition(selection.head),
    source: 'outer',
  }
}

function mapOuterSelectionTarget(
  target: InlineOuterSelectionTarget,
  changes: Transaction['changes'],
): InlineOuterSelectionTarget {
  return {
    ...target,
    anchor: changes.mapPos(target.anchor, 1),
    head: changes.mapPos(target.head, 1),
  }
}

function resolveOuterEditorSelection(doc: Text, target: InlineOuterSelectionTarget) {
  const clampPosition = (position: number) => Math.max(0, Math.min(doc.length, Math.floor(position)))
  return EditorSelection.single(clampPosition(target.anchor), clampPosition(target.head))
}

function buildInlineDecorations(
  state: EditorState,
  descriptors: readonly InlineHunkDescriptor[],
  controller: MeoLiveInlineDiffControllerImpl,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const sorted = [...descriptors].sort((left, right) => left.replaceFrom - right.replaceFrom || left.replaceTo - right.replaceTo)
  let lastTo = -1

  for (const descriptor of sorted) {
    const from = Math.max(0, Math.min(state.doc.length, descriptor.replaceFrom))
    const to = Math.max(from, Math.min(state.doc.length, descriptor.replaceTo))
    if (from < lastTo) {
      continue
    }

    const widget = new InlineDiffWidget(descriptor, controller)
    if (from === to) {
      builder.add(from, from, Decoration.widget({ block: true, side: 1, widget }))
    } else {
      builder.add(from, to, Decoration.replace({ block: true, widget }))
    }
    lastTo = to
  }

  return builder.finish()
}

class InlineDiffWidget extends WidgetType {
  readonly isMeoLiveInlineDiffWidget = true

  constructor(
    private readonly descriptor: InlineHunkDescriptor,
    private readonly controller: MeoLiveInlineDiffControllerImpl,
  ) {
    super()
  }

  eq(other: WidgetType): boolean {
    return other instanceof InlineDiffWidget
      && getDescriptorRenderKey(other.descriptor) === getDescriptorRenderKey(this.descriptor)
  }

  toDOM(): HTMLElement {
    return this.controller.mountWidget(this.descriptor)
  }

  updateDOM(dom: HTMLElement): boolean {
    this.controller.updateWidget(dom, this.descriptor)
    return true
  }

  override get estimatedHeight(): number {
    const lineCount = Math.max(
      1,
      this.descriptor.originalText.split('\n').length,
      this.descriptor.modifiedText.split('\n').length,
    )
    return Math.min(520, Math.max(104, (lineCount + 3) * 24))
  }

  ignoreEvent(): boolean {
    return true
  }

  destroy(dom: HTMLElement): void {
    this.controller.destroyWidget(dom)
  }
}

class InlineDiffWidgetView {
  private applyingExternal = false
  private readonly body: HTMLElement
  private readonly componentRoot: HTMLElement
  private descriptor: InlineHunkDescriptor
  private readonly header: HTMLElement
  private currentViewMode: InlineDiffViewMode
  private mergeView: MergeView | null = null
  private unifiedView: EditorView | null = null
  private readonly modifiedActiveLineGutterCompartment = new Compartment()
  private readonly modifiedEditableCompartment = new Compartment()
  private readonly modifiedLineNumbersCompartment = new Compartment()
  private readonly modifiedReadOnlyCompartment = new Compartment()
  private readonly originalActiveLineGutterCompartment = new Compartment()
  private readonly originalEditableCompartment = new Compartment()
  private readonly originalLineNumbersCompartment = new Compartment()
  private readonly originalReadOnlyCompartment = new Compartment()
  private readonly unifiedActiveLineGutterCompartment = new Compartment()
  private readonly unifiedEditableCompartment = new Compartment()
  private readonly unifiedLineNumbersCompartment = new Compartment()
  private readonly unifiedReadOnlyCompartment = new Compartment()
  private readonly originalTextSnapshot: TextSnapshot
  private readonly modifiedTextSnapshot: TextSnapshot
  private cleanupReadOnlyWidgetLock: (() => void) | null = null
  private pendingModifiedSelectionFocusFrame = 0
  private pendingOuterGutterMeasureFrame = 0
  private pendingReadOnlyWidgetLockFrame = 0
  private readonly pendingReadOnlyWidgetRoots = new Set<Element>()

  constructor(
    descriptor: InlineHunkDescriptor,
    private readonly controller: MeoLiveInlineDiffControllerImpl,
  ) {
    this.descriptor = descriptor
    this.currentViewMode = controller.inlineDiffViewMode
    this.originalTextSnapshot = { value: descriptor.originalText }
    this.modifiedTextSnapshot = { value: descriptor.modifiedText }

    this.componentRoot = document.createElement('div')
    this.componentRoot.className = 'meo-live-inline-diff'
    this.componentRoot.dataset.changeKind = descriptor.changeKind
    this.componentRoot.dataset.scope = descriptor.scope
    this.componentRoot.dataset.lineNumbers = descriptor.lineNumbersVisible ? 'visible' : 'hidden'
    this.componentRoot.dataset.viewMode = this.currentViewMode

    this.header = document.createElement('div')
    this.header.className = 'meo-live-inline-diff-header'

    this.body = document.createElement('div')
    this.body.className = 'meo-diff-split-body meo-live-inline-diff-body'

    this.componentRoot.append(this.header, this.body)
    this.renderHeader()
    this.createCurrentView()
    this.installInlineRowHandlers()
    this.scheduleOuterGutterMeasure()
  }

  get root() {
    return this.componentRoot
  }

  destroy() {
    this.cleanupReadOnlyWidgetLock?.()
    this.cleanupReadOnlyWidgetLock = null
    this.cancelPendingModifiedSelectionFocus()
    this.cancelOuterGutterMeasure()
    this.componentRoot.removeEventListener('mousedown', this.handleInlineRowMouseDown, true)
    this.destroyCurrentView()
    this.componentRoot.remove()
  }

  refreshLayout() {
    this.mergeView?.a.requestMeasure()
    this.mergeView?.b.requestMeasure()
    this.unifiedView?.requestMeasure()
    this.syncDiffGutterVisibility()
    this.syncDiffArtifacts()
    this.scheduleOuterGutterMeasure()
  }

  focusModifiedSelection(target: InlineModifiedSelectionTarget) {
    if (this.pendingModifiedSelectionFocusFrame) {
      window.cancelAnimationFrame(this.pendingModifiedSelectionFocusFrame)
    }

    this.pendingModifiedSelectionFocusFrame = window.requestAnimationFrame(() => {
      this.pendingModifiedSelectionFocusFrame = 0
      if (
        !this.componentRoot.isConnected
        || this.descriptor.modifiedReadOnly
        || !this.controller.editable
      ) {
        return
      }

      // Live mode reveals Markdown source markers only while the editor is
      // focused, so focus before setting the selection to avoid stale caret
      // coordinates from the unfocused, marker-hidden layout.
      const modifiedView = this.getModifiedView()
      if (!modifiedView) {
        return
      }

      modifiedView.focus()
      const selection = resolveModifiedEditorSelection(modifiedView.state.doc, target)
      modifiedView.dispatch({
        effects: EditorView.scrollIntoView(selection.main.head, { x: 'nearest', y: 'nearest' }),
        selection,
      })
      modifiedView.focus()
    })
  }

  updateDescriptor(nextDescriptor: InlineHunkDescriptor) {
    const previousDescriptor = this.descriptor
    this.descriptor = nextDescriptor
    this.componentRoot.dataset.changeKind = nextDescriptor.changeKind
    this.componentRoot.dataset.scope = nextDescriptor.scope
    this.componentRoot.dataset.lineNumbers = nextDescriptor.lineNumbersVisible ? 'visible' : 'hidden'

    const chromeChanged = (
      previousDescriptor.originalLabel !== nextDescriptor.originalLabel
      || previousDescriptor.modifiedLabel !== nextDescriptor.modifiedLabel
      || previousDescriptor.originalLineStart !== nextDescriptor.originalLineStart
      || previousDescriptor.modifiedLineStart !== nextDescriptor.modifiedLineStart
      || previousDescriptor.lineNumbersVisible !== nextDescriptor.lineNumbersVisible
      || previousDescriptor.modifiedReadOnly !== nextDescriptor.modifiedReadOnly
      || previousDescriptor.changeKind !== nextDescriptor.changeKind
      || previousDescriptor.actionBusy !== nextDescriptor.actionBusy
      || previousDescriptor.actionScope !== nextDescriptor.actionScope
      || previousDescriptor.actionChange !== nextDescriptor.actionChange
    )
    if (chromeChanged) {
      this.renderHeader()
    }

    const currentDocuments = this.getCurrentDocuments()
    const documentsMatch = currentDocuments?.originalText === nextDescriptor.originalText
      && currentDocuments.modifiedText === nextDescriptor.modifiedText

    if (!documentsMatch) {
      this.recreateCurrentView()
      this.scheduleOuterGutterMeasure()
      return
    }

    if (chromeChanged) {
      this.syncLineNumberOffsets()
      this.syncModifiedEditability()
      this.mergeView?.reconfigure({
        diffConfig: getInlineMergeDiffConfig(),
        revertControls: undefined,
      })
    }

    this.syncDiffArtifacts()
    this.scheduleOuterGutterMeasure()
  }

  private cancelPendingModifiedSelectionFocus() {
    if (!this.pendingModifiedSelectionFocusFrame) {
      return
    }
    window.cancelAnimationFrame(this.pendingModifiedSelectionFocusFrame)
    this.pendingModifiedSelectionFocusFrame = 0
  }

  private installInlineRowHandlers() {
    this.componentRoot.addEventListener('mousedown', this.handleInlineRowMouseDown, true)
  }

  private readonly handleInlineRowMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) {
      return
    }

    const target = event.target instanceof Element ? event.target : null
    const gitGutter = target?.closest('.cm-gutter.meo-git-gutter')
    if (!gitGutter || !this.componentRoot.contains(gitGutter)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    this.controller.collapseInlineHunk(this.descriptor.requestId)
  }

  private cancelOuterGutterMeasure() {
    if (!this.pendingOuterGutterMeasureFrame) {
      return
    }
    window.cancelAnimationFrame(this.pendingOuterGutterMeasureFrame)
    this.pendingOuterGutterMeasureFrame = 0
  }

  private scheduleOuterGutterMeasure() {
    if (this.pendingOuterGutterMeasureFrame) {
      return
    }
    this.pendingOuterGutterMeasureFrame = window.requestAnimationFrame(() => {
      this.pendingOuterGutterMeasureFrame = 0
      this.syncOuterGutterOffset()
    })
  }

  private syncOuterGutterOffset() {
    if (!this.componentRoot.isConnected) {
      this.scheduleOuterGutterMeasure()
      return
    }

    const outerGutters = Array.from(
      this.controller.view.dom.querySelectorAll<HTMLElement>('.cm-gutters'),
    ).find((element) => !this.componentRoot.contains(element))
    if (!outerGutters) {
      this.componentRoot.style.removeProperty('--meo-live-inline-outer-gutter-width')
      return
    }

    const guttersRect = outerGutters.getBoundingClientRect()
    const contentRect = this.controller.view.contentDOM.getBoundingClientRect()
    if (!guttersRect.width || !contentRect.width) {
      this.scheduleOuterGutterMeasure()
      return
    }

    const offset = Math.max(0, Math.ceil(contentRect.left - guttersRect.left))
    this.componentRoot.style.setProperty('--meo-live-inline-outer-gutter-width', `${offset}px`)
  }

  setViewMode(mode: InlineDiffViewMode) {
    if (this.currentViewMode === mode) {
      return
    }

    const previousView = this.getModifiedView()
    const previousSelection = previousView?.state.selection.main ?? null
    const shouldRestoreFocus = previousView?.hasFocus === true
    this.syncDescriptorDocumentsFromCurrentView()
    this.currentViewMode = mode
    this.componentRoot.dataset.viewMode = mode
    this.renderHeader()
    this.recreateCurrentView()

    const nextView = this.getModifiedView()
    if (nextView && previousSelection) {
      const anchor = Math.max(0, Math.min(nextView.state.doc.length, previousSelection.anchor))
      const head = Math.max(0, Math.min(nextView.state.doc.length, previousSelection.head))
      const selection = EditorSelection.single(anchor, head)
      nextView.dispatch({
        effects: EditorView.scrollIntoView(selection.main.head, { x: 'nearest', y: 'nearest' }),
        selection,
      })
      if (shouldRestoreFocus) {
        nextView.focus()
      }
    }
  }

  private syncDescriptorDocumentsFromCurrentView() {
    const currentDocuments = this.getCurrentDocuments()
    if (!currentDocuments) {
      return
    }

    this.descriptor = {
      ...this.descriptor,
      modifiedText: currentDocuments.modifiedText,
      originalText: currentDocuments.originalText,
    }
    this.modifiedTextSnapshot.value = currentDocuments.modifiedText
    this.originalTextSnapshot.value = currentDocuments.originalText
  }

  private getModifiedView() {
    return this.mergeView?.b ?? this.unifiedView
  }

  private getCurrentDocuments() {
    if (this.mergeView) {
      return {
        modifiedText: this.mergeView.b.state.doc.toString(),
        originalText: this.mergeView.a.state.doc.toString(),
      }
    }

    if (this.unifiedView) {
      return {
        modifiedText: this.unifiedView.state.doc.toString(),
        originalText: getOriginalDoc(this.unifiedView.state).toString(),
      }
    }

    return null
  }

  private syncViewModeClass() {
    this.body.classList.toggle('meo-diff-view-split', this.currentViewMode === 'split')
    this.body.classList.toggle('meo-diff-view-unified', this.currentViewMode === 'unified')
  }

  private createCurrentView() {
    this.syncViewModeClass()
    if (this.currentViewMode === 'unified') {
      this.unifiedView = this.createUnifiedView()
    } else {
      this.mergeView = this.createSplitView()
      this.installReadOnlyWidgetLock()
    }
    this.syncDiffGutterVisibility()
    this.syncDiffArtifacts()
  }

  private destroyCurrentView() {
    this.cleanupReadOnlyWidgetLock?.()
    this.cleanupReadOnlyWidgetLock = null
    this.cancelPendingReadOnlyWidgetLock()
    this.mergeView?.destroy()
    this.mergeView = null
    this.unifiedView?.destroy()
    this.unifiedView = null
    this.body.replaceChildren()
  }

  private createSplitView() {
    return createMeoDiffSplitMergeView({
      a: {
        doc: this.descriptor.originalText,
        activeLineGutterCompartment: this.originalActiveLineGutterCompartment,
        editable: false,
        editableCompartment: this.originalEditableCompartment,
        interactive: false,
        lineNumberStart: this.descriptor.originalLineStart,
        lineNumbersCompartment: this.originalLineNumbersCompartment,
        lineNumbersVisible: this.descriptor.lineNumbersVisible,
        onChange: () => undefined,
        readOnly: true,
        readOnlyCompartment: this.originalReadOnlyCompartment,
        side: 'original',
        textSnapshot: this.originalTextSnapshot,
      },
      b: {
        doc: this.descriptor.modifiedText,
        activeLineGutterCompartment: this.modifiedActiveLineGutterCompartment,
        editable: this.controller.editable,
        editableCompartment: this.modifiedEditableCompartment,
        lineNumberStart: this.descriptor.modifiedLineStart,
        lineNumbersCompartment: this.modifiedLineNumbersCompartment,
        lineNumbersVisible: this.descriptor.lineNumbersVisible,
        onChange: (nextValue) => {
          if (this.applyingExternal) {
            return
          }
          this.modifiedTextSnapshot.value = nextValue
          const selection = this.mergeView?.b.state.selection.main
          this.controller.applyInlineModifiedText(this.descriptor.requestId, nextValue, selection)
        },
        onCompositionChange: this.controller.onCompositionChange,
        onOpenLink: this.controller.onOpenLink,
        onSave: (nextValue) => {
          if (!this.descriptor.modifiedReadOnly) {
            this.modifiedTextSnapshot.value = nextValue
            const selection = this.mergeView?.b.state.selection.main
            this.controller.applyInlineModifiedText(this.descriptor.requestId, nextValue, selection)
          }
          this.controller.saveCurrentText()
        },
        onSelectionChange: this.controller.onSelectionChange,
        onViewportChange: this.controller.onViewportChange,
        readOnly: () => this.descriptor.modifiedReadOnly,
        readOnlyCompartment: this.modifiedReadOnlyCompartment,
        reportViewportChanges: false,
        side: 'modified',
        textSnapshot: this.modifiedTextSnapshot,
      },
      diffConfig: getInlineMergeDiffConfig(),
      deferChunkUpdates: shouldDeferSplitMergeChunkUpdate,
      gutter: false,
      highlightChanges: true,
      parent: this.body,
      revertControls: undefined,
      trailingSpacer: 'fakeLines',
    })
  }

  private createUnifiedView() {
    return createMeoDiffUnifiedEditorView({
      doc: this.descriptor.modifiedText,
      pane: {
        activeLineGutterCompartment: this.unifiedActiveLineGutterCompartment,
        diffGutterWidgetLineFlagMapper: mapUnifiedDiffWidgetGutterFlag,
        editable: this.controller.editable,
        editableCompartment: this.unifiedEditableCompartment,
        lineNumbersCompartment: this.unifiedLineNumbersCompartment,
        lineNumbersVisible: this.descriptor.lineNumbersVisible,
        onChange: (nextValue) => {
          if (this.applyingExternal) {
            return
          }
          this.modifiedTextSnapshot.value = nextValue
          const selection = this.unifiedView?.state.selection.main
          this.controller.applyInlineModifiedText(this.descriptor.requestId, nextValue, selection)
        },
        onCompositionChange: this.controller.onCompositionChange,
        onOpenLink: this.controller.onOpenLink,
        onSave: (nextValue) => {
          if (!this.descriptor.modifiedReadOnly) {
            this.modifiedTextSnapshot.value = nextValue
            const selection = this.unifiedView?.state.selection.main
            this.controller.applyInlineModifiedText(this.descriptor.requestId, nextValue, selection)
          }
          this.controller.saveCurrentText()
        },
        onSelectionChange: this.controller.onSelectionChange,
        onViewportChange: this.controller.onViewportChange,
        readOnly: () => this.descriptor.modifiedReadOnly,
        readOnlyCompartment: this.unifiedReadOnlyCompartment,
        reportViewportChanges: false,
        side: 'modified',
        textSnapshot: this.modifiedTextSnapshot,
      },
      lineNumberOptions: {
        display: 'single',
        modifiedLineStart: this.descriptor.modifiedLineStart,
        originalLineStart: this.descriptor.originalLineStart,
      },
      allowInlineDiffs: false,
      className: 'meo-diff-unified-editor',
      diffConfig: getInlineMergeDiffConfig(),
      gutter: false,
      highlightChanges: true,
      mergeControls: undefined,
      original: this.descriptor.originalText,
      parent: this.body,
      renderDeletedContent: renderUnifiedDeletedContent,
      syntaxHighlightDeletions: true,
    })
  }

  private recreateCurrentView() {
    this.applyingExternal = true
    try {
      this.destroyCurrentView()
      this.originalTextSnapshot.value = this.descriptor.originalText
      this.modifiedTextSnapshot.value = this.descriptor.modifiedText
      this.createCurrentView()
    } finally {
      this.applyingExternal = false
    }
  }

  private syncLineNumberOffsets() {
    if (this.mergeView) {
      reconfigureMeoDiffSplitLineNumbers({
        lineNumbersVisible: this.descriptor.lineNumbersVisible,
        mergeView: this.mergeView,
        modifiedLineNumbersCompartment: this.modifiedLineNumbersCompartment,
        modifiedLineStart: this.descriptor.modifiedLineStart,
        originalLineNumbersCompartment: this.originalLineNumbersCompartment,
        originalLineStart: this.descriptor.originalLineStart,
      })
      return
    }

    if (this.unifiedView) {
      reconfigureMeoDiffUnifiedLineNumbers({
        lineNumbersCompartment: this.unifiedLineNumbersCompartment,
        lineNumbersVisible: this.descriptor.lineNumbersVisible,
        lineNumberOptions: {
          display: 'single',
          modifiedLineStart: this.descriptor.modifiedLineStart,
          originalLineStart: this.descriptor.originalLineStart,
        },
        view: this.unifiedView,
      })
    }
  }

  private syncModifiedEditability() {
    const modifiedView = this.getModifiedView()
    const editableCompartment = this.mergeView
      ? this.modifiedEditableCompartment
      : this.unifiedEditableCompartment
    const readOnlyCompartment = this.mergeView
      ? this.modifiedReadOnlyCompartment
      : this.unifiedReadOnlyCompartment
    modifiedView?.dispatch({
      effects: [
        editableCompartment.reconfigure(EditorView.editable.of(
          this.controller.editable && !this.descriptor.modifiedReadOnly,
        )),
        readOnlyCompartment.reconfigure(EditorState.readOnly.of(
          this.descriptor.modifiedReadOnly || !this.controller.editable,
        )),
      ],
    })
  }

  private cancelPendingReadOnlyWidgetLock() {
    if (this.pendingReadOnlyWidgetLockFrame) {
      window.cancelAnimationFrame(this.pendingReadOnlyWidgetLockFrame)
      this.pendingReadOnlyWidgetLockFrame = 0
    }
    this.pendingReadOnlyWidgetRoots.clear()
  }

  private scheduleReadOnlyWidgetLock(rootElement: Element) {
    this.pendingReadOnlyWidgetRoots.add(rootElement)
    if (this.pendingReadOnlyWidgetLockFrame) {
      return
    }

    this.pendingReadOnlyWidgetLockFrame = window.requestAnimationFrame(() => {
      this.pendingReadOnlyWidgetLockFrame = 0
      const roots = Array.from(this.pendingReadOnlyWidgetRoots)
      this.pendingReadOnlyWidgetRoots.clear()

      for (const candidate of roots) {
        if (candidate.isConnected) {
          lockReadOnlyWidgets(candidate)
        }
      }
    })
  }

  private installReadOnlyWidgetLock() {
    if (!this.mergeView) {
      return
    }

    lockReadOnlyWidgets(this.mergeView.a.dom)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) {
            this.scheduleReadOnlyWidgetLock(node)
          }
        }
      }
    })
    observer.observe(this.mergeView.a.dom, {
      childList: true,
      subtree: true,
    })
    this.cleanupReadOnlyWidgetLock = () => {
      observer.disconnect()
      this.cancelPendingReadOnlyWidgetLock()
    }
  }

  private syncDiffArtifacts() {
    if (this.mergeView) {
      this.mergeView.refreshChunks()
      const originalDoc = this.mergeView.a.state.doc
      const modifiedDoc = this.mergeView.b.state.doc
      const chunks = this.mergeView.chunks as readonly CodeMirrorDiffChunk[]
      setGitBaseline(this.mergeView.a, {
        available: true,
        baseText: this.descriptor.modifiedText,
        headOid: null,
        indexText: null,
        tracked: true,
      }, { deferLineFlags: true })
      setGitBaseline(this.mergeView.b, {
        available: true,
        baseText: this.descriptor.originalText,
        headOid: null,
        indexText: null,
        tracked: true,
      }, { deferLineFlags: true })
      setGitDiffLineFlags(
        this.mergeView.a,
        buildDiffSplitGutterFlagsFromChunks(originalDoc, modifiedDoc, chunks, 'original'),
      )
      setGitDiffLineFlags(
        this.mergeView.b,
        buildDiffSplitGutterFlagsFromChunks(originalDoc, modifiedDoc, chunks, 'modified'),
      )
      return
    }

    if (!this.unifiedView) {
      return
    }

    const originalDoc = getOriginalDoc(this.unifiedView.state)
    const modifiedDoc = this.unifiedView.state.doc
    const chunks = (getChunks(this.unifiedView.state)?.chunks ?? []) as readonly CodeMirrorDiffChunk[]
    setGitBaseline(this.unifiedView, {
      available: true,
      baseText: this.descriptor.originalText,
      headOid: null,
      indexText: null,
      tracked: true,
    }, { deferLineFlags: true })
    setGitDiffLineFlags(
      this.unifiedView,
      buildDiffSplitGutterFlagsFromChunks(originalDoc, modifiedDoc, chunks, 'modified'),
    )
  }

  syncDiffGutterVisibility() {
    this.mergeView?.a.dom.classList.toggle('meo-git-gutter-hidden', !this.controller.diffGutterVisible)
    this.mergeView?.b.dom.classList.toggle('meo-git-gutter-hidden', !this.controller.diffGutterVisible)
    this.unifiedView?.dom.classList.toggle('meo-git-gutter-hidden', !this.controller.diffGutterVisible)
    this.syncGitGutterCollapseHints()
  }

  private syncGitGutterCollapseHints() {
    for (const gutter of this.componentRoot.querySelectorAll<HTMLElement>('.cm-gutter.meo-git-gutter')) {
      gutter.title = 'Collapse inline diff'
      gutter.setAttribute('aria-label', 'Collapse inline diff')
    }
  }

  private renderHeader() {
    this.header.replaceChildren()

    const controls = document.createElement('div')
    controls.className = 'meo-live-inline-diff-controls meo-diff-floating-hunk-toolbar'
    controls.onmousedown = (event) => {
      event.preventDefault()
      event.stopPropagation()
    }

    const actions = this.createHunkActionControls()
    if (actions.hasChildNodes()) {
      controls.appendChild(actions)
    }

    const nav = document.createElement('div')
    nav.className = 'meo-live-inline-diff-nav'
    nav.append(
      this.createViewModeToggleButton(),
      this.createNavButton('previous'),
      this.createNavButton('next'),
    )

    controls.append(nav)
    this.header.appendChild(controls)
  }

  private createNavButton(direction: 'next' | 'previous') {
    const button = document.createElement('button')
    const title = direction === 'next' ? 'Next change' : 'Previous change'
    button.type = 'button'
    button.className = 'meo-live-inline-diff-nav-button'
    button.setAttribute('aria-label', title)
    button.title = title
    button.innerHTML = getNavigateIcon(direction)
    button.onmousedown = (event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    button.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.controller.navigateFromInlineHunk(this.descriptor.requestId, direction)
    }
    return button
  }

  private createViewModeToggleButton() {
    const button = document.createElement('button')
    const label = getInlineDiffViewModeToggleLabel(this.currentViewMode)
    const targetMode = getNextInlineDiffViewMode(this.currentViewMode)
    button.type = 'button'
    button.className = 'meo-live-inline-diff-nav-button meo-live-inline-diff-view-toggle'
    button.dataset.targetMode = targetMode
    button.setAttribute('aria-label', label)
    button.title = label
    button.appendChild(createInlineDiffViewModeToggleIcon(this.currentViewMode))
    button.onmousedown = (event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    button.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.controller.setInlineDiffViewMode(targetMode)
    }
    return button
  }

  private createHunkActionControls() {
    const container = document.createElement('div')
    container.className = 'meo-diff-hunk-actions meo-live-inline-diff-hunk-actions'
    container.setAttribute('aria-label', 'Git block actions')
    container.onmousedown = (event) => {
      event.preventDefault()
      event.stopPropagation()
    }

    for (const action of getHunkActions(this.descriptor)) {
      container.appendChild(this.createHunkActionButton(action))
    }

    return container
  }

  private createHunkActionButton(action: GitDiffBlockAction) {
    const button = document.createElement('button')
    const label = this.descriptor.actionBusy
      ? 'Wait for the current Git block action to finish.'
      : getHunkActionLabel(action)
    button.type = 'button'
    button.className = 'meo-diff-hunk-action'
    button.dataset.action = action
    button.disabled = this.descriptor.actionBusy
    button.setAttribute('aria-label', label)
    button.title = label
    button.innerHTML = getHunkActionIcon(action)
    button.onmousedown = (event) => {
      event.preventDefault()
      event.stopPropagation()
      void this.controller.applyHunkAction(this.descriptor.requestId, action)
    }
    button.onkeydown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      void this.controller.applyHunkAction(this.descriptor.requestId, action)
    }
    return button
  }
}

class MeoLiveInlineDiffControllerImpl implements MeoLiveInlineDiffController {
  readonly editable: boolean
  readonly onCompositionChange?: (isComposing: boolean) => void
  readonly onOpenLink?: (href: string) => void
  readonly onSave?: (nextValue: string) => void
  readonly onSelectionChange?: (selectionState: { visible?: boolean, anchorX?: number, anchorY?: number } | null) => void
  readonly onViewportChange?: () => void

  private currentBaseline: GitBaselinePayload | null
  private currentFallbackOriginal: { label: string, text: string }
  private currentGitChangeContext: InlineDiffControllerOptions['gitChangeContext']
  private currentText: string
  private descriptorsByRequestId = new Map<string, InlineHunkDescriptor>()
  private compositionActive = false
  private destroyed = false
  private extensionInstalled = false
  private nextRequestId = 1
  private pendingActiveOuterSelection: InlineOuterSelectionTarget | null = null
  private pendingModifiedSelectionCleanupFrame = 0
  private pendingModifiedSelectionGeneration = 0
  private readonly pendingModifiedSelectionTargets = new Map<string, {
    generation: number
    target: InlineModifiedSelectionTarget
  }>()
  private pendingOuterSelectionRestore: {
    generation: number
    target: InlineOuterSelectionTarget
  } | null = null
  private pendingSyncAfterComposition = false
  private pendingSyncFrame = 0
  private pendingSyncTimer = 0
  private readonly requests: InlineHunkRequest[] = []
  private readonly widgets = new WeakMap<HTMLElement, InlineDiffWidgetView>()
  inlineDiffViewMode: InlineDiffViewMode = 'split'
  isApplyingHunkAction = false
  diffGutterVisible: boolean
  lineNumbersVisible: boolean

  constructor(private readonly options: InlineDiffControllerOptions) {
    this.currentBaseline = options.baseline
    this.currentFallbackOriginal = {
      label: options.fallbackOriginalLabel,
      text: options.fallbackOriginalText,
    }
    this.currentGitChangeContext = options.gitChangeContext
    this.currentText = options.text
    this.editable = options.editable !== false
    this.diffGutterVisible = options.diffGutterVisible !== false
    this.lineNumbersVisible = options.lineNumbersVisible
    this.onCompositionChange = options.onCompositionChange
    this.onOpenLink = options.onOpenLink
    this.onSave = options.onSave
    this.onSelectionChange = options.onSelectionChange
    this.onViewportChange = options.onViewportChange
    this.installExtension()
  }

  get view() {
    return this.options.view
  }

  destroy() {
    if (this.destroyed) {
      return
    }

    this.destroyed = true
    this.cancelScheduledSync()
    this.cancelPendingModifiedSelectionCleanup()
    this.pendingActiveOuterSelection = null
    this.pendingModifiedSelectionTargets.clear()
    this.pendingOuterSelectionRestore = null
    this.pendingSyncAfterComposition = false
    this.requests.length = 0
    this.descriptorsByRequestId.clear()
    this.dispatchDescriptors([])
  }

  refreshLayout() {
    for (const component of this.getMountedComponents()) {
      component.refreshLayout()
    }
  }

  setBaseline(baseline: GitBaselinePayload | null) {
    this.currentBaseline = baseline
    this.syncIfActive()
  }

  setDiffGutterVisible(visible: boolean) {
    this.diffGutterVisible = visible !== false
    for (const component of this.getMountedComponents()) {
      component.syncDiffGutterVisibility()
    }
  }

  setFallbackOriginal(fallback: { label: string, text: string }) {
    this.currentFallbackOriginal = fallback
    this.syncIfActive()
  }

  setGitChangeContext(context: InlineDiffControllerOptions['gitChangeContext']) {
    this.currentGitChangeContext = context
    this.syncIfActive()
  }

  setLineNumbersVisible(visible: boolean) {
    this.lineNumbersVisible = visible !== false
    this.syncIfActive()
  }

  setInlineDiffViewMode(mode: InlineDiffViewMode) {
    const nextMode = mode === 'unified' ? 'unified' : 'split'
    if (this.inlineDiffViewMode === nextMode) {
      return
    }

    this.inlineDiffViewMode = nextMode
    for (const component of this.getMountedComponents()) {
      component.setViewMode(nextMode)
    }
  }

  setText(text: string) {
    this.currentText = text
    this.syncIfActive()
  }

  toggleHunkForLine(request: { lineNumber?: number, scope: GitChangeScope }) {
    if (this.destroyed || typeof request.lineNumber !== 'number' || !Number.isFinite(request.lineNumber)) {
      return false
    }

    this.currentText = this.view.state.doc.toString()
    const lineNumber = Math.max(1, Math.min(this.view.state.doc.lines, Math.floor(request.lineNumber)))
    const line = this.view.state.doc.line(lineNumber)
    const probeRequest: InlineHunkRequest = {
      anchor: line.from,
      id: `probe:${this.nextRequestId}`,
      scope: request.scope,
    }
    const descriptor = this.createDescriptorForRequest(probeRequest)
    if (!descriptor) {
      return false
    }

    const existingIndex = this.requests.findIndex((candidate) => {
      const existing = this.descriptorsByRequestId.get(candidate.id)
      return existing?.key === descriptor.key
    })

    if (existingIndex >= 0) {
      this.requests.splice(existingIndex, 1)
    } else {
      this.requests.push({
        anchor: line.from,
        id: `inline-hunk-${this.nextRequestId++}`,
        scope: request.scope,
      })
    }
    this.syncNow()
    return true
  }

  collapseInlineHunk(requestId: string) {
    if (this.destroyed) {
      return false
    }

    const index = this.requests.findIndex((request) => request.id === requestId)
    if (index < 0) {
      return false
    }

    this.requests.splice(index, 1)
    this.descriptorsByRequestId.delete(requestId)
    this.syncNow()
    return true
  }

  mountWidget(descriptor: InlineHunkDescriptor) {
    const component = new InlineDiffWidgetView(descriptor, this)
    this.widgets.set(component.root, component)
    this.restorePendingModifiedSelection(component, descriptor.requestId)
    return component.root
  }

  updateWidget(dom: HTMLElement, descriptor: InlineHunkDescriptor) {
    const component = this.widgets.get(dom)
    if (!component) {
      return
    }
    component.updateDescriptor(descriptor)
    this.restorePendingModifiedSelection(component, descriptor.requestId)
  }

  destroyWidget(dom: HTMLElement) {
    const component = this.widgets.get(dom)
    component?.destroy()
    this.widgets.delete(dom)
  }

  private restorePendingModifiedSelection(component: InlineDiffWidgetView, requestId: string) {
    const entry = this.pendingModifiedSelectionTargets.get(requestId)
    if (!entry || entry.generation !== this.pendingModifiedSelectionGeneration) {
      return
    }

    this.pendingModifiedSelectionTargets.delete(requestId)
    component.focusModifiedSelection(entry.target)
  }

  applyInlineModifiedText(
    requestId: string,
    nextText: string,
    selection?: { anchor: number, head: number } | null,
  ) {
    const descriptor = this.descriptorsByRequestId.get(requestId)
    if (!descriptor || descriptor.modifiedReadOnly || this.destroyed) {
      return
    }

    const from = Math.max(0, Math.min(this.view.state.doc.length, descriptor.replaceFrom))
    const to = Math.max(from, Math.min(this.view.state.doc.length, descriptor.replaceTo))
    this.view.dispatch({
      annotations: Transaction.userEvent.of('input.type'),
      changes: {
        from,
        insert: nextText,
        to,
      },
    })
    if (selection) {
      this.pendingActiveOuterSelection = createOuterSelectionTargetFromInlineSelection(from, nextText, selection)
    }
    this.currentText = this.view.state.doc.toString()

    const nextDescriptor = {
      ...descriptor,
      modifiedText: nextText,
      replaceFrom: from,
      replaceTo: from + nextText.length,
    }
    this.descriptorsByRequestId.set(requestId, nextDescriptor)
    const request = this.requests.find((candidate) => candidate.id === requestId)
    if (request) {
      request.anchor = from
    }
    this.scheduleSync(INLINE_DIFF_SYNC_DELAY_MS)
  }

  saveCurrentText() {
    if (this.destroyed) {
      return
    }
    this.options.onSave?.(this.view.state.doc.toString())
  }

  canApplyHunkAction(descriptor: InlineHunkDescriptor) {
    return Boolean(descriptor.actionChange && this.options.onApplyGitDiffSelection)
  }

  async applyHunkAction(requestId: string, action: GitDiffBlockAction) {
    const descriptor = this.descriptorsByRequestId.get(requestId)
    if (
      !descriptor
      || this.isApplyingHunkAction
      || !descriptor.actionChange
      || !this.options.onApplyGitDiffSelection
    ) {
      return
    }

    this.isApplyingHunkAction = true
    this.syncNow()
    try {
      await this.options.onApplyGitDiffSelection(
        descriptor.actionChange,
        descriptor.selection,
        action,
      )
    } finally {
      this.isApplyingHunkAction = false
      this.scheduleSync(0)
    }
  }

  navigateFromInlineHunk(requestId: string, direction: 'next' | 'previous') {
    const descriptor = this.descriptorsByRequestId.get(requestId)
    if (!descriptor) {
      return
    }

    const adjacent = direction === 'next'
      ? this.findAdjacentDescriptor(descriptor, 1)
      : this.findAdjacentDescriptor(descriptor, -1)
    const target = adjacent ?? this.findAdjacentGlobalHunk(descriptor, direction)
    if (!target) {
      return
    }

    const lineNumber = Math.max(1, Math.min(this.view.state.doc.lines, target.modifiedLineStart))
    const line = this.view.state.doc.line(lineNumber)
    this.view.dispatch({
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
      selection: { anchor: line.from },
    })
    this.view.focus()
  }

  handleViewUpdate(update: ViewUpdate) {
    if (this.destroyed) {
      return
    }

    if (!update.docChanged) {
      return
    }

    this.currentText = update.state.doc.toString()
    for (const transaction of update.transactions) {
      if (!transaction.docChanged) {
        continue
      }
      for (const request of this.requests) {
        request.anchor = transaction.changes.mapPos(request.anchor, 1)
      }
      if (this.pendingActiveOuterSelection) {
        this.pendingActiveOuterSelection = mapOuterSelectionTarget(this.pendingActiveOuterSelection, transaction.changes)
      }
      if (this.pendingOuterSelectionRestore) {
        this.pendingOuterSelectionRestore = {
          ...this.pendingOuterSelectionRestore,
          target: mapOuterSelectionTarget(this.pendingOuterSelectionRestore.target, transaction.changes),
        }
      }
    }
    if (!this.hasActiveInlineHunks()) {
      return
    }
    this.scheduleSync(INLINE_DIFF_SYNC_DELAY_MS)
  }

  private installExtension() {
    if (this.extensionInstalled) {
      return
    }

    this.extensionInstalled = true
    const controller = this
    const inlineField = StateField.define<DecorationSet>({
      create() {
        return Decoration.none
      },
      update(value, transaction) {
        for (const effect of transaction.effects) {
          if (effect.is(setInlineHunksEffect)) {
            return buildInlineDecorations(transaction.state, effect.value, controller)
          }
        }
        return value.map(transaction.changes)
      },
      provide(field) {
        return EditorView.decorations.from(field)
      },
    })

    this.view.dispatch({
      effects: StateEffect.appendConfig.of([
        inlineField,
        EditorView.updateListener.of((update) => this.handleViewUpdate(update)),
        EditorView.domEventHandlers({
          compositionstart: () => {
            controller.setCompositionActive(true)
            return false
          },
          compositionend: () => {
            controller.setCompositionActive(false)
            return false
          },
        }),
      ]),
    })
  }

  private dispatchDescriptors(descriptors: InlineHunkDescriptor[]) {
    if (this.destroyed && descriptors.length) {
      return
    }
    this.view.dispatch({
      effects: setInlineHunksEffect.of(descriptors),
    })
  }

  private capturePendingModifiedSelectionTargets(descriptors: readonly InlineHunkDescriptor[]) {
    this.pendingModifiedSelectionGeneration += 1
    const generation = this.pendingModifiedSelectionGeneration
    this.pendingModifiedSelectionTargets.clear()
    this.pendingOuterSelectionRestore = null
    this.cancelPendingModifiedSelectionCleanup()

    const pendingInlineSelection = this.pendingActiveOuterSelection
    this.pendingActiveOuterSelection = null
    const selection = pendingInlineSelection
      ?? (this.hasOuterEditorSelectionFocus()
        ? createOuterSelectionTargetFromOuterSelection(this.view.state.doc, this.view.state.selection.main)
        : null)

    if (!selection) {
      return
    }

    const doc = this.view.state.doc
    for (const descriptor of descriptors) {
      if (descriptor.modifiedReadOnly) {
        continue
      }

      const target = createModifiedSelectionTarget(doc, descriptor, selection)
      if (!target) {
        continue
      }

      this.pendingModifiedSelectionTargets.set(descriptor.requestId, {
        generation,
        target,
      })
      break
    }

    if (!this.pendingModifiedSelectionTargets.size && selection.source === 'inline') {
      this.pendingOuterSelectionRestore = {
        generation,
        target: selection,
      }
    }

    if (!this.pendingModifiedSelectionTargets.size && !this.pendingOuterSelectionRestore) {
      return
    }

    this.pendingModifiedSelectionCleanupFrame = window.requestAnimationFrame(() => {
      this.pendingModifiedSelectionCleanupFrame = 0
      if (this.pendingModifiedSelectionGeneration === generation) {
        this.pendingModifiedSelectionTargets.clear()
        this.pendingOuterSelectionRestore = null
      }
    })
  }

  private restorePendingOuterSelection() {
    const entry = this.pendingOuterSelectionRestore
    if (!entry || entry.generation !== this.pendingModifiedSelectionGeneration) {
      return
    }

    this.pendingOuterSelectionRestore = null
    const selection = resolveOuterEditorSelection(this.view.state.doc, entry.target)
    this.view.dispatch({
      effects: EditorView.scrollIntoView(selection.main.head, { x: 'nearest', y: 'nearest' }),
      selection,
    })
    this.view.focus()
  }

  private cancelPendingModifiedSelectionCleanup() {
    if (!this.pendingModifiedSelectionCleanupFrame) {
      return
    }
    window.cancelAnimationFrame(this.pendingModifiedSelectionCleanupFrame)
    this.pendingModifiedSelectionCleanupFrame = 0
  }

  private hasOuterEditorSelectionFocus() {
    const activeElement = this.view.root.activeElement
    if (!(activeElement instanceof Element)) {
      return this.view.hasFocus
    }

    return this.view.contentDOM.contains(activeElement)
      && !activeElement.closest('.meo-live-inline-diff')
  }

  private hasActiveInlineHunks() {
    return this.requests.length > 0 || this.descriptorsByRequestId.size > 0
  }

  private syncIfActive() {
    if (this.hasActiveInlineHunks()) {
      if (this.compositionActive) {
        this.pendingSyncAfterComposition = true
        return
      }
      this.syncNow()
    }
  }

  private cancelScheduledSync() {
    if (this.pendingSyncTimer) {
      window.clearTimeout(this.pendingSyncTimer)
      this.pendingSyncTimer = 0
    }
    if (this.pendingSyncFrame) {
      window.cancelAnimationFrame(this.pendingSyncFrame)
      this.pendingSyncFrame = 0
    }
  }

  private scheduleSync(delayMs: number) {
    if (this.destroyed) {
      return
    }
    if (!this.hasActiveInlineHunks()) {
      return
    }
    if (this.compositionActive) {
      this.pendingSyncAfterComposition = true
      this.cancelScheduledSync()
      return
    }

    if (this.pendingSyncTimer) {
      window.clearTimeout(this.pendingSyncTimer)
      this.pendingSyncTimer = 0
    }

    this.pendingSyncTimer = window.setTimeout(() => {
      this.pendingSyncTimer = 0
      if (this.pendingSyncFrame) {
        return
      }
      this.pendingSyncFrame = window.requestAnimationFrame(() => {
        this.pendingSyncFrame = 0
        this.syncNow()
      })
    }, Math.max(0, delayMs))
  }

  private syncNow() {
    if (this.destroyed) {
      return
    }

    this.cancelScheduledSync()
    this.currentText = this.view.state.doc.toString()
    if (this.compositionActive) {
      this.pendingSyncAfterComposition = true
      return
    }

    const descriptors: InlineHunkDescriptor[] = []
    const nextRequests: InlineHunkRequest[] = []
    const nextDescriptorsByRequestId = new Map<string, InlineHunkDescriptor>()
    const usedKeys = new Set<string>()

    for (const request of this.requests) {
      const descriptor = this.createDescriptorForRequest(request)
      if (!descriptor || usedKeys.has(descriptor.key)) {
        continue
      }
      usedKeys.add(descriptor.key)
      request.anchor = descriptor.replaceFrom
      nextRequests.push(request)
      descriptors.push(descriptor)
      nextDescriptorsByRequestId.set(request.id, descriptor)
    }

    this.capturePendingModifiedSelectionTargets(descriptors)
    this.requests.length = 0
    this.requests.push(...nextRequests)
    this.descriptorsByRequestId = nextDescriptorsByRequestId
    this.dispatchDescriptors(descriptors)
    this.restorePendingOuterSelection()
  }

  setCompositionActive(nextValue: boolean) {
    if (this.destroyed || this.compositionActive === nextValue) {
      return
    }

    this.compositionActive = nextValue
    if (nextValue) {
      if (this.hasActiveInlineHunks()) {
        this.pendingSyncAfterComposition = true
      }
      this.cancelScheduledSync()
      return
    }

    if (!this.pendingSyncAfterComposition) {
      return
    }
    this.pendingSyncAfterComposition = false
    this.scheduleSync(INLINE_DIFF_SYNC_AFTER_COMPOSITION_MS)
  }

  private createDescriptorForRequest(request: InlineHunkRequest): InlineHunkDescriptor | null {
    const currentDoc = this.view.state.doc
    if (currentDoc.length !== this.currentText.length) {
      this.currentText = currentDoc.toString()
    }

    const currentLine = currentDoc.lineAt(Math.max(0, Math.min(currentDoc.length, request.anchor))).number
    const resolvedState = resolveOriginalText(
      this.currentBaseline,
      this.currentFallbackOriginal,
      this.currentText,
      this.currentGitChangeContext,
      request.scope,
    )
    if (resolvedState.actionScope && resolvedState.actionScope !== request.scope) {
      return null
    }

    const originalDoc = createTextDocFromContent(resolvedState.text)
    const modifiedDoc = createTextDocFromContent(resolvedState.modifiedText)
    const requestedLineNumber = this.getRequestedLineForScope(request.scope, currentLine)
    const chunks = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc) as readonly CodeMirrorDiffChunk[]
    const found = findInlineChunkMatch(originalDoc, modifiedDoc, chunks, requestedLineNumber)
    if (!found) {
      return null
    }

    const selection = found.selection
    const displaySelection = found.displaySelection
    const originalLineStart = Math.max(1, displaySelection.originalStartLine)
    const modifiedLineStart = Math.max(1, displaySelection.modifiedStartLine)
    const originalText = lineRangeText(originalDoc, originalLineStart, displaySelection.originalLineCount)
    const modifiedText = lineRangeText(modifiedDoc, modifiedLineStart, displaySelection.modifiedLineCount)
    const replaceLineStart = this.resolveCurrentReplaceStartLine(resolvedState, displaySelection, currentLine)
    const fallbackOffset = resolvedState.modifiedText === this.currentText
      ? found.chunk.fromB
      : request.anchor
    const replaceOffsets = lineRangeOffsets(
      currentDoc,
      replaceLineStart,
      displaySelection.modifiedLineCount,
      fallbackOffset,
    )

    return {
      actionChange: resolvedState.actionChange,
      actionBusy: this.isApplyingHunkAction,
      actionScope: resolvedState.actionScope,
      changeKind: inferInlineHunkChangeKind(resolvedState.actionChange, selection),
      key: buildDescriptorKey(request.scope, displaySelection),
      lineNumbersVisible: this.lineNumbersVisible,
      modifiedLabel: resolvedState.modifiedLabel,
      modifiedLineStart,
      modifiedReadOnly: resolvedState.modifiedReadOnly,
      modifiedText,
      originalLabel: resolvedState.label,
      originalLineStart,
      originalText,
      replaceFrom: replaceOffsets.from,
      replaceTo: replaceOffsets.to,
      requestId: request.id,
      scope: request.scope,
      selection,
    }
  }

  private getRequestedLineForScope(scope: GitChangeScope, currentLine: number) {
    if (
      scope !== 'staged'
      || typeof this.currentBaseline?.indexText !== 'string'
      || normalizeLineEndings(this.currentText) === normalizeLineEndings(this.currentBaseline.indexText)
    ) {
      return currentLine
    }

    return mapCurrentLineToIndexLine(this.currentBaseline.indexText, this.currentText, currentLine)
  }

  private resolveCurrentReplaceStartLine(
    resolvedState: DiffSplitResolvedState,
    selection: GitDiffSelection,
    fallbackLine: number,
  ) {
    if (
      resolvedState.modifiedText === this.currentText
      || selection.modifiedLineCount <= 0
    ) {
      return Math.max(1, selection.modifiedStartLine || fallbackLine)
    }

    if (typeof this.currentBaseline?.indexText === 'string') {
      return Math.max(1, mapIndexLineToCurrentLine(
        this.currentBaseline.indexText,
        this.currentText,
        selection.modifiedStartLine,
      ))
    }

    return Math.max(1, fallbackLine)
  }

  private findAdjacentDescriptor(descriptor: InlineHunkDescriptor, direction: 1 | -1) {
    const descriptors = Array.from(this.descriptorsByRequestId.values())
      .sort((left, right) => left.replaceFrom - right.replaceFrom)
    const index = descriptors.findIndex((candidate) => candidate.requestId === descriptor.requestId)
    if (index < 0) {
      return null
    }

    return descriptors[index + direction] ?? null
  }

  private findAdjacentGlobalHunk(descriptor: InlineHunkDescriptor, direction: 'next' | 'previous') {
    const resolvedState = resolveOriginalText(
      this.currentBaseline,
      this.currentFallbackOriginal,
      this.currentText,
      this.currentGitChangeContext,
      descriptor.scope,
    )
    const originalDoc = createTextDocFromContent(resolvedState.text)
    const modifiedDoc = createTextDocFromContent(resolvedState.modifiedText)
    const chunks = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc) as readonly CodeMirrorDiffChunk[]
    const selections = chunks
      .map((chunk) => createSelectionFromCodeMirrorChunk(originalDoc, modifiedDoc, chunk))
      .map((selection) => ({
        modifiedLineStart: Math.max(1, selection.modifiedStartLine),
      }))
      .sort((left, right) => left.modifiedLineStart - right.modifiedLineStart)
    if (!selections.length) {
      return null
    }

    if (direction === 'next') {
      return selections.find((selection) => selection.modifiedLineStart > descriptor.modifiedLineStart) ?? selections[0]
    }

    for (let index = selections.length - 1; index >= 0; index -= 1) {
      if (selections[index].modifiedLineStart < descriptor.modifiedLineStart) {
        return selections[index]
      }
    }
    return selections[selections.length - 1]
  }

  private getMountedComponents() {
    return Array.from(this.view.dom.querySelectorAll<HTMLElement>('.meo-live-inline-diff'))
      .map((element) => this.widgets.get(element))
      .filter((component): component is InlineDiffWidgetView => Boolean(component))
  }
}

export function createMeoLiveInlineDiffController(options: InlineDiffControllerOptions): MeoLiveInlineDiffController {
  return new MeoLiveInlineDiffControllerImpl(options)
}

export const __meoLiveInlineDiffTestHooks = {
  createOuterSelectionTargetFromInlineSelection,
  createInlineDisplaySelection,
  createModifiedSelectionTarget,
  findInlineChunkMatch,
  getInlineDiffViewModeToggleIconName,
  getInlineDiffViewModeToggleLabel,
  getNextInlineDiffViewMode,
  mergeDiffSelections,
  resolveModifiedSelectionTargetOffsets,
  resolveOuterEditorSelection,
} as const
