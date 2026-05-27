import {EditorView} from "@codemirror/view"
import {EditorStateConfig, Transaction, EditorState, StateEffect, Prec, Compartment, ChangeSet} from "@codemirror/state"
import {Chunk, chunkActualRange, defaultDiffConfig, type ChunkSide} from "./chunk"
import {DiffConfig} from "./diff"
import {deferredChunkUpdate, setChunks, ChunkField, mergeConfig} from "./merge"
import {chunkTouchesViewport, decorateChunks, inlineChangeLayer, updateSpacers, Spacers, adjustSpacers, collapseUnchanged, changeGutter, type SpacerViewportOverride, type TrailingSpacerMode} from "./deco"
import {baseTheme, externalTheme} from "./theme"

/// Configuration options to `MergeView` that can be provided both
/// initially and to [`reconfigure`](#merge.MergeView.reconfigure).
export interface MergeConfig {
  /// Controls whether editor A or editor B is shown first. Defaults
  /// to `"a-b"`.
  orientation?: "a-b" | "b-a",
  /// Controls whether revert controls are shown between changed
  /// chunks.
  revertControls?: "a-to-b" | "b-to-a"
  /// When given, this function is called to render the button to
  /// revert a chunk.
  renderRevertControl?: () => HTMLElement,
  /// By default, the merge view will mark inserted and deleted text
  /// in changed chunks. Set this to false to turn that off.
  highlightChanges?: boolean,
  /// Controls whether a gutter marker is shown next to changed lines.
  gutter?: boolean,
  /// When given, long stretches of unchanged text are collapsed.
  /// `margin` gives the number of lines to leave visible after/before
  /// a change (default is 3), and `minSize` gives the minimum amount
  /// of collapsible lines that need to be present (defaults to 4).
  collapseUnchanged?: {margin?: number, minSize?: number},
  /// Pass options to the diff algorithm. By default, the merge view
  /// sets [`scanLimit`](#merge.DiffConfig.scanLimit) to 500.
  diffConfig?: DiffConfig
  /// When this returns true for a document-changing transaction, the
  /// document is updated immediately while diff chunks and chunk
  /// decorations stay frozen until `refreshChunks` is called.
  deferChunkUpdates?: (transactions: readonly Transaction[], target: "a" | "b") => boolean
  /// Keep the child editor viewports in sync with the merge view's
  /// outer scroll container. This avoids blank frames when the outer
  /// scroller moves faster than CodeMirror's normal viewport redraw.
  outerScrollViewportSync?: boolean
  /// Extra vertical pixels rendered before and after the merge view's
  /// visible area when syncing child editor viewports.
  outerScrollViewportMargin?: number
  /// Maximum vertical pixel span retained around recently visited merge
  /// view content. Higher values reduce redraw flashes at the cost of DOM.
  outerScrollViewportRetention?: number
  /// When set, this side is treated as the source of truth for the outer
  /// scroll viewport. The other side derives its logical viewport by mapping
  /// this side's visible range through the diff chunks.
  outerScrollPrimarySide?: "a" | "b"
  /// Controls whether the merge view may add a spacer at the document
  /// end to equalize editor heights. Defaults to `"all"`. Use
  /// `"fakeLines"` to keep semantic inserted/deleted empty rows while
  /// suppressing plain end padding.
  trailingSpacer?: TrailingSpacerMode
  /// Marks document sides that are semantically empty in a sliced merge
  /// view. This lets MergeView keep zero-width chunk/spacer behavior
  /// without exposing CodeMirror's unavoidable one-line empty document.
  emptySides?: Partial<Record<"a" | "b", boolean>>
}

/// Configuration options given to the [`MergeView`](#merge.MergeView)
/// constructor.
export interface DirectMergeConfig extends MergeConfig {
  /// Configuration for the first editor (the left one in a
  /// left-to-right context).
  a: EditorStateConfig
  /// Configuration for the second editor.
  b: EditorStateConfig
  /// Parent element to append the view to.
  parent?: Element | DocumentFragment
  /// An optional root. Only necessary if the view is mounted in a
  /// shadow root or a document other than the global `document`
  /// object.
  root?: Document | ShadowRoot
}

const collapseCompartment = new Compartment, configCompartment = new Compartment
const QueryTypeByPos = 0, QueryTypeByHeight = 1

type MergeScrollTarget = {
  range: { head: number },
  y: string,
}

type MergeEditorViewState = {
  editorHeight: number,
  heightMap: {
    lineAt: (value: number, type: number, oracle: unknown, top: number, offset: number) => {
      bottom: number,
      from: number,
      to: number,
      top: number,
    },
  },
  heightOracle: unknown,
  inView: boolean,
  pixelViewport: { top: number, bottom: number },
  state: EditorState,
  visibleBottom: number,
  visibleTop: number,
  getViewport: (bias: number, scrollTarget: MergeScrollTarget | null) => { from: number, to: number },
  viewportIsAppropriate: (viewport: { from: number, to: number }, bias?: number) => boolean,
}

type OuterScrollViewportPolicy = {
  hasRetainedRange: boolean,
  originalGetViewport: MergeEditorViewState["getViewport"],
  originalViewportIsAppropriate: MergeEditorViewState["viewportIsAppropriate"],
  retainedBottom: number,
  retainedTop: number,
  viewState: MergeEditorViewState,
}

type DocumentRange = { from: number, to: number }
type HeightRange = { bottom: number, top: number }
type MergeSide = ChunkSide

function chunkSideRange(chunk: Chunk, side: MergeSide): DocumentRange {
  let {from, to} = chunkActualRange(chunk, side)
  return {from, to}
}

function rangeTouches(from: number, to: number, rangeFrom: number, rangeTo: number) {
  return from == to
    ? rangeFrom <= from && from <= rangeTo
    : rangeFrom == rangeTo
      ? from <= rangeFrom && rangeFrom <= to
      : from < rangeTo && to > rangeFrom
}

function addRange(target: { from: number, to: number, touched: boolean }, from: number, to: number, max: number) {
  let rangeFrom = Math.max(0, Math.min(max, Math.min(from, to)))
  let rangeTo = Math.max(0, Math.min(max, Math.max(from, to)))
  if (!target.touched) {
    target.from = rangeFrom
    target.to = rangeTo
    target.touched = true
  } else {
    target.from = Math.min(target.from, rangeFrom)
    target.to = Math.max(target.to, rangeTo)
  }
}

function addExpandedChunkSideRange(
  target: { from: number, to: number, touched: boolean },
  chunk: Chunk,
  side: MergeSide,
  docLength: number,
) {
  let range = chunkSideRange(chunk, side)
  addRange(target, range.from, range.to, docLength)
}

function mapPointInsideChunk(
  chunk: Chunk,
  pos: number,
  sourceSide: MergeSide,
  targetDocLength: number,
) {
  let chunkFromSource = sourceSide == "a" ? chunk.fromA : chunk.fromB
  let chunkToSource = sourceSide == "a" ? chunk.toA : chunk.toB
  let chunkFromTarget = sourceSide == "a" ? chunk.fromB : chunk.fromA
  let chunkToTarget = sourceSide == "a" ? chunk.toB : chunk.toA
  let sourceSize = chunkToSource - chunkFromSource
  if (sourceSize <= 0) return Math.max(0, Math.min(targetDocLength, chunkFromTarget))
  let ratio = Math.max(0, Math.min(1, (pos - chunkFromSource) / sourceSize))
  return Math.max(0, Math.min(targetDocLength, chunkFromTarget + Math.round((chunkToTarget - chunkFromTarget) * ratio)))
}

function mapMergePoint(
  chunks: readonly Chunk[],
  pos: number,
  sourceSide: MergeSide,
  targetDocLength: number,
) {
  let sourcePos = 0, targetPos = 0
  for (let chunk of chunks) {
    let chunkFromSource = sourceSide == "a" ? chunk.fromA : chunk.fromB
    let chunkToSource = sourceSide == "a" ? chunk.toA : chunk.toB
    let chunkFromTarget = sourceSide == "a" ? chunk.fromB : chunk.fromA
    let chunkToTarget = sourceSide == "a" ? chunk.toB : chunk.toA
    if (pos < chunkFromSource)
      return Math.max(0, Math.min(targetDocLength, targetPos + pos - sourcePos))
    if (pos <= chunkToSource) {
      let sourceSize = chunkToSource - chunkFromSource
      if (sourceSize <= 0) return Math.max(0, Math.min(targetDocLength, chunkFromTarget))
      let ratio = Math.max(0, Math.min(1, (pos - chunkFromSource) / sourceSize))
      return Math.max(0, Math.min(targetDocLength, chunkFromTarget + Math.round((chunkToTarget - chunkFromTarget) * ratio)))
    }
    sourcePos = chunkToSource
    targetPos = chunkToTarget
  }
  return Math.max(0, Math.min(targetDocLength, targetPos + pos - sourcePos))
}

export function mapRangeBetweenMergeSides(
  chunks: readonly Chunk[],
  range: DocumentRange,
  sourceSide: MergeSide,
  targetDocLength: number,
): DocumentRange {
  let result = {from: targetDocLength, to: 0, touched: false}
  let sourcePos = 0, targetPos = 0
  for (let chunk of chunks) {
    let chunkFromSource = sourceSide == "a" ? chunk.fromA : chunk.fromB
    let chunkToSource = sourceSide == "a" ? chunk.toA : chunk.toB
    let chunkFromTarget = sourceSide == "a" ? chunk.fromB : chunk.fromA
    let chunkToTarget = sourceSide == "a" ? chunk.toB : chunk.toA

    let unchangedFrom = Math.max(range.from, sourcePos)
    let unchangedTo = Math.min(range.to, chunkFromSource)
    if (rangeTouches(unchangedFrom, unchangedTo, sourcePos, chunkFromSource))
      addRange(result, targetPos + unchangedFrom - sourcePos, targetPos + unchangedTo - sourcePos, targetDocLength)

    if (rangeTouches(chunkFromSource, chunkToSource, range.from, range.to)) {
      let chunkRangeFrom = Math.max(range.from, chunkFromSource)
      let chunkRangeTo = Math.min(range.to, chunkToSource)
      addRange(
        result,
        mapPointInsideChunk(chunk, chunkRangeFrom, sourceSide, targetDocLength),
        mapPointInsideChunk(chunk, chunkRangeTo, sourceSide, targetDocLength),
        targetDocLength,
      )
      let sourceActualRange = chunkSideRange(chunk, sourceSide)
      if (rangeTouches(sourceActualRange.from, sourceActualRange.to, range.from, range.to))
        addExpandedChunkSideRange(result, chunk, sourceSide == "a" ? "b" : "a", targetDocLength)
    }

    sourcePos = chunkToSource
    targetPos = chunkToTarget
  }

  let unchangedFrom = Math.max(range.from, sourcePos)
  let unchangedTo = Math.min(range.to, Number.MAX_SAFE_INTEGER)
  if (unchangedTo >= unchangedFrom)
    addRange(result, targetPos + unchangedFrom - sourcePos, targetPos + unchangedTo - sourcePos, targetDocLength)

  if (!result.touched) {
    let from = mapMergePoint(chunks, range.from, sourceSide, targetDocLength)
    let to = mapMergePoint(chunks, range.to, sourceSide, targetDocLength)
    return {from: Math.min(from, to), to: Math.max(from, to)}
  }
  return {from: result.from, to: result.to}
}

function heightRangeForDocumentRange(viewState: MergeEditorViewState, range: DocumentRange): HeightRange {
  let map = viewState.heightMap, oracle = viewState.heightOracle
  let fromBlock = map.lineAt(range.from, QueryTypeByPos, oracle, 0, 0)
  let toBlock = map.lineAt(range.to, QueryTypeByPos, oracle, 0, 0)
  return {
    bottom: Math.max(fromBlock.bottom, toBlock.bottom),
    top: Math.min(fromBlock.top, toBlock.top),
  }
}

export function sharedViewportIsAppropriate(
  current: DocumentRange,
  expected: DocumentRange,
  currentHeight: HeightRange,
  expectedHeight: HeightRange,
  margin: number,
) {
  return current.from <= expected.from &&
    current.to >= expected.to &&
    currentHeight.top >= expectedHeight.top - margin &&
    currentHeight.bottom <= expectedHeight.bottom + margin
}

/// A merge view manages two editors side-by-side, highlighting the
/// difference between them and vertically aligning unchanged lines.
/// If you want one of the editors to be read-only, you have to
/// configure that in its extensions.
///
/// By default, views are not scrollable. Style them (`.cm-mergeView`)
/// with a height and `overflow: auto` to make them scrollable.
export class MergeView {
  /// The first editor.
  a: EditorView
  /// The second editor.
  b: EditorView

  /// The outer DOM element holding the view.
  dom: HTMLElement
  private editorDOM: HTMLElement
  private revertDOM: HTMLElement | null = null
  private revertToA = false
  private revertToLeft = false
  private renderRevert: (() => HTMLElement) | undefined
  private diffConf: DiffConfig | undefined
  private outerScrollViewportSync = true
  private outerScrollViewportMargin = 1000
  private outerScrollViewportRetention = 1000
  private outerScrollPrimarySide: MergeSide | null = null
  private deferChunkUpdates: MergeConfig["deferChunkUpdates"]
  private trailingSpacer: TrailingSpacerMode = "all"
  private emptySides: Partial<Record<"a" | "b", boolean>> = {}
  private chunksStale = false

  /// The current set of changed chunks.
  chunks: readonly Chunk[]

  private measuring = -1
  private readonly outerScrollViewportPolicies = new WeakMap<EditorView, OuterScrollViewportPolicy>()
  private readonly onOuterScroll = () => this.syncOuterScrollViewports()

  /// Create a new merge view.
  constructor(config: DirectMergeConfig) {
    this.diffConf = config.diffConfig || defaultDiffConfig
    this.deferChunkUpdates = config.deferChunkUpdates
    this.outerScrollViewportSync = config.outerScrollViewportSync !== false
    this.outerScrollViewportMargin = Math.max(1000, config.outerScrollViewportMargin ?? 1000)
    this.outerScrollViewportRetention = Math.max(
      this.outerScrollViewportMargin,
      config.outerScrollViewportRetention ?? this.outerScrollViewportMargin,
    )
    this.outerScrollPrimarySide = config.outerScrollPrimarySide ?? null
    this.trailingSpacer = config.trailingSpacer ?? "all"
    this.emptySides = config.emptySides ?? {}

    let sharedExtensions = [
      Prec.low(decorateChunks),
      inlineChangeLayer,
      baseTheme,
      externalTheme,
      Spacers,
      EditorView.updateListener.of(update => {
        if (!this.chunksStale && this.measuring < 0 && (update.heightChanged || update.viewportChanged) &&
            !update.transactions.some(tr => tr.effects.some(e => e.is(adjustSpacers))))
          this.measure()
      }),
    ]

    let configA = [mergeConfig.of({
      side: "a",
      emptySide: this.emptySides.a === true,
      sibling: () => this.b,
      highlightChanges: config.highlightChanges !== false,
      markGutter: config.gutter !== false
    })]
    if (config.gutter !== false) configA.push(changeGutter)
    let stateA = EditorState.create({
      doc: config.a.doc,
      selection: config.a.selection,
      extensions: [
        config.a.extensions || [],
        EditorView.editorAttributes.of({class: "cm-merge-a"}),
        configCompartment.of(configA),
        sharedExtensions
      ]
    })

    let configB = [mergeConfig.of({
      side: "b",
      emptySide: this.emptySides.b === true,
      sibling: () => this.a,
      highlightChanges: config.highlightChanges !== false,
      markGutter: config.gutter !== false
    })]
    if (config.gutter !== false) configB.push(changeGutter)
    let stateB = EditorState.create({
      doc: config.b.doc,
      selection: config.b.selection,
      extensions: [
        config.b.extensions || [],
        EditorView.editorAttributes.of({class: "cm-merge-b"}),
        configCompartment.of(configB),
        sharedExtensions
      ]
    })
    this.chunks = Chunk.build(stateA.doc, stateB.doc, this.diffConf)
    let add = [
      ChunkField.init(() => this.chunks),
      collapseCompartment.of(config.collapseUnchanged ? collapseUnchanged(config.collapseUnchanged) : [])
    ]
    stateA = stateA.update({effects: StateEffect.appendConfig.of(add)}).state
    stateB = stateB.update({effects: StateEffect.appendConfig.of(add)}).state

    this.dom = document.createElement("div")
    this.dom.className = "cm-mergeView"
    this.editorDOM = this.dom.appendChild(document.createElement("div"))
    this.editorDOM.className = "cm-mergeViewEditors"
    let orientation = config.orientation || "a-b"
    let wrapA = document.createElement("div")
    wrapA.className = "cm-mergeViewEditor"
    let wrapB = document.createElement("div")
    wrapB.className = "cm-mergeViewEditor"
    this.editorDOM.appendChild(orientation == "a-b" ? wrapA : wrapB)
    this.editorDOM.appendChild(orientation == "a-b" ? wrapB : wrapA)
    this.a = new EditorView({
      state: stateA,
      parent: wrapA,
      root: config.root,
      dispatchTransactions: trs => this.dispatch(trs, this.a)
    })
    this.b = new EditorView({
      state: stateB,
      parent: wrapB,
      root: config.root,
      dispatchTransactions: trs => this.dispatch(trs, this.b)
    })
    this.syncEmptySideClasses()
    this.ensureEditorViewportPolicy(this.a)
    this.ensureEditorViewportPolicy(this.b)
    this.setupRevertControls(!!config.revertControls, config.revertControls == "b-to-a", config.renderRevertControl)
    if (config.parent) config.parent.appendChild(this.dom)
    this.syncOuterScrollListener()
    this.scheduleMeasure()
  }

  private syncEmptySideClasses() {
    this.a?.dom.classList.toggle("cm-merge-emptySide", this.emptySides.a === true)
    this.b?.dom.classList.toggle("cm-merge-emptySide", this.emptySides.b === true)
  }

  private dispatch(trs: readonly Transaction[], target: EditorView) {
    if (trs.some(tr => tr.docChanged)) {
      let last = trs[trs.length - 1]
      let changes = trs.reduce((chs, tr) => chs.compose(tr.changes), ChangeSet.empty(trs[0].startState.doc.length))
      let targetSide: "a" | "b" = target == this.a ? "a" : "b"
      if (this.deferChunkUpdates?.(trs, targetSide)) {
        this.chunksStale = true
        target.update([...trs, last.state.update({annotations: deferredChunkUpdate.of(true)})])
        return
      }
      this.chunks = this.chunksStale
        ? target == this.a ? Chunk.build(last.newDoc, this.b.state.doc, this.diffConf)
          : Chunk.build(this.a.state.doc, last.newDoc, this.diffConf)
        : target == this.a ? Chunk.updateA(this.chunks, last.newDoc, this.b.state.doc, changes, this.diffConf)
          : Chunk.updateB(this.chunks, this.a.state.doc, last.newDoc, changes, this.diffConf)
      this.chunksStale = false
      target.update([...trs, last.state.update({effects: setChunks.of(this.chunks)})])
      let other = target == this.a ? this.b : this.a
      other.update([other.state.update({effects: setChunks.of(this.chunks)})])
      this.scheduleMeasure()
    } else {
      target.update(trs)
    }
  }

  refreshChunks() {
    this.chunks = Chunk.build(this.a.state.doc, this.b.state.doc, this.diffConf)
    this.chunksStale = false
    this.a.update([this.a.state.update({effects: setChunks.of(this.chunks)})])
    this.b.update([this.b.state.update({effects: setChunks.of(this.chunks)})])
    this.scheduleMeasure()
  }

  hasPendingChunkRefresh() {
    return this.chunksStale
  }

  /// Reconfigure an existing merge view.
  reconfigure(config: MergeConfig) {
    if ("diffConfig" in config) {
      this.diffConf = config.diffConfig
    }
    if ("deferChunkUpdates" in config) {
      this.deferChunkUpdates = config.deferChunkUpdates
    }
    if ("outerScrollViewportSync" in config) {
      this.outerScrollViewportSync = config.outerScrollViewportSync !== false
      this.syncOuterScrollListener()
    }
    if ("outerScrollViewportMargin" in config) {
      this.outerScrollViewportMargin = Math.max(1000, config.outerScrollViewportMargin ?? 1000)
      this.outerScrollViewportRetention = Math.max(this.outerScrollViewportRetention, this.outerScrollViewportMargin)
    }
    if ("outerScrollViewportRetention" in config) {
      this.outerScrollViewportRetention = Math.max(
        this.outerScrollViewportMargin,
        config.outerScrollViewportRetention ?? this.outerScrollViewportMargin,
      )
    }
    if ("outerScrollPrimarySide" in config) {
      this.outerScrollPrimarySide = config.outerScrollPrimarySide ?? null
    }
    if ("trailingSpacer" in config) {
      this.trailingSpacer = config.trailingSpacer ?? "all"
    }
    if ("emptySides" in config) {
      this.emptySides = config.emptySides ?? {}
      this.syncEmptySideClasses()
    }
    if ("orientation" in config) {
      let aB = config.orientation != "b-a"
      if (aB != (this.editorDOM.firstChild == this.a.dom.parentNode)) {
        let domA = this.a.dom.parentNode as HTMLElement, domB = this.b.dom.parentNode as HTMLElement
        domA.remove()
        domB.remove()
        this.editorDOM.insertBefore(aB ? domA : domB, this.editorDOM.firstChild)
        this.editorDOM.appendChild(aB ? domB : domA)
        this.revertToLeft = !this.revertToLeft
        if (this.revertDOM) this.revertDOM.textContent = ""
      }
    }
    if ("revertControls" in config || "renderRevertControl" in config) {
      let controls = !!this.revertDOM, toA = this.revertToA, render = this.renderRevert
      if ("revertControls" in config) {
        controls = !!config.revertControls
        toA = config.revertControls == "b-to-a"
      }
      if ("renderRevertControl" in config) render = config.renderRevertControl
      this.setupRevertControls(controls, toA, render)
    }
    let highlight = "highlightChanges" in config, gutter = "gutter" in config, collapse = "collapseUnchanged" in config, emptySides = "emptySides" in config
    if (highlight || gutter || collapse || emptySides) {
      let effectsA: StateEffect<unknown>[] = [], effectsB: StateEffect<unknown>[] = []
      if (highlight || gutter || emptySides) {
        let currentConfig = this.a.state.facet(mergeConfig)
        let markGutter = gutter ? config.gutter !== false : currentConfig.markGutter
        let highlightChanges = highlight ? config.highlightChanges !== false : currentConfig.highlightChanges
        effectsA.push(configCompartment.reconfigure([
          mergeConfig.of({
            side: "a",
            emptySide: this.emptySides.a === true,
            sibling: () => this.b,
            highlightChanges,
            markGutter
          }),
          markGutter ? changeGutter : []
        ]))
        effectsB.push(configCompartment.reconfigure([
          mergeConfig.of({
            side: "b",
            emptySide: this.emptySides.b === true,
            sibling: () => this.a,
            highlightChanges,
            markGutter
          }),
          markGutter ? changeGutter : []
        ]))
      }
      if (collapse) {
        let effect = collapseCompartment.reconfigure(
          config.collapseUnchanged ? collapseUnchanged(config.collapseUnchanged) : [])
        effectsA.push(effect)
        effectsB.push(effect)
      }
      this.a.dispatch({effects: effectsA})
      this.b.dispatch({effects: effectsB})
    }
    this.scheduleMeasure()
  }

  private syncOuterScrollListener() {
    this.dom.removeEventListener("scroll", this.onOuterScroll)
    if (this.outerScrollViewportSync) {
      this.dom.addEventListener("scroll", this.onOuterScroll, {passive: true})
    }
  }

  private syncOuterScrollViewports() {
    if (!this.outerScrollViewportSync) return
    this.ensureOuterScrollViewport(this.a)
    this.ensureOuterScrollViewport(this.b)
  }

  refreshLayout() {
    this.syncOuterScrollViewports()
    this.measureEditorViewport(this.a)
    this.measureEditorViewport(this.b)
    this.scheduleMeasure()
  }

  private ensureOuterScrollViewport(view: EditorView) {
    let retained = this.updateRetainedOuterScrollViewport(view)
    let policy = this.ensureEditorViewportPolicy(view)
    let blocks = view.viewportLineBlocks
    let visibleTop = this.dom.scrollTop, visibleBottom = visibleTop + this.dom.clientHeight
    let first = blocks[0], last = blocks[blocks.length - 1]
    if (policy && !policy.viewState.viewportIsAppropriate(view.viewport, 0)) {
      this.measureEditorViewport(view)
      return
    }
    if (!first || !last || first.top > visibleTop || last.bottom < visibleBottom) {
      this.measureEditorViewport(view)
      return
    }

    if (retained && (first.top > retained.top || last.bottom < retained.bottom))
      view.requestMeasure()
  }

  private measureEditorViewport(view: EditorView) {
    // CodeMirror's own scroll observer measures synchronously. The merge view
    // scrolls outside the panes, so use the same path only after coverage misses.
    let measurable = view as EditorView & {measure?: (flush?: boolean) => void}
    if (typeof measurable.measure == "function") measurable.measure(false)
    else view.requestMeasure()
  }

  private ensureEditorViewportPolicy(view: EditorView) {
    // MergeView scrolls outside the child editors. CodeMirror's default
    // viewport policy only overscans around each editor's own scrollDOM, so
    // widen it here to match the outer scroller and avoid blank virtual gaps.
    let viewState = (view as EditorView & {viewState?: MergeEditorViewState}).viewState
    if (!viewState) return null
    let policy = this.outerScrollViewportPolicies.get(view)
    if (policy?.viewState == viewState) return policy

    let nextPolicy: OuterScrollViewportPolicy = {
      hasRetainedRange: false,
      originalGetViewport: viewState.getViewport,
      originalViewportIsAppropriate: viewState.viewportIsAppropriate,
      retainedBottom: 0,
      retainedTop: 0,
      viewState,
    }
    this.outerScrollViewportPolicies.set(view, nextPolicy)
    let mergeView = this

    viewState.getViewport = function(bias: number, scrollTarget: MergeScrollTarget | null) {
      if (!mergeView.outerScrollViewportSync)
        return nextPolicy.originalGetViewport.call(this, bias, scrollTarget)

      return mergeView.resolveOuterScrollViewport(view, nextPolicy, bias, scrollTarget)
    }

    viewState.viewportIsAppropriate = function({from, to}: {from: number, to: number}, bias = 0) {
      if (!mergeView.outerScrollViewportSync)
        return nextPolicy.originalViewportIsAppropriate.call(this, {from, to}, bias)

      if (!this.inView) return true
      let sharedViewport = mergeView.mappedPrimaryOuterScrollViewport(view, bias)
      if (sharedViewport)
        return sharedViewportIsAppropriate(
          {from, to},
          sharedViewport,
          heightRangeForDocumentRange(this, {from, to}),
          heightRangeForDocumentRange(this, sharedViewport),
          mergeView.resolveOuterScrollViewportMargin(),
        )

      let margin = mergeView.resolveOuterScrollViewportMargin()
      let retained = mergeView.updateRetainedOuterScrollViewport(view)
      let {top} = this.heightMap.lineAt(from, QueryTypeByPos, this.heightOracle, 0, 0)
      let {bottom} = this.heightMap.lineAt(to, QueryTypeByPos, this.heightOracle, 0, 0)
      let requiredTop = retained?.top ?? this.visibleTop
      let requiredBottom = retained?.bottom ?? this.visibleBottom
      let coverMargin = Math.max(10, Math.min(Math.abs(bias), Math.min(250, margin / 4)))
      return (from == 0 || top <= requiredTop + coverMargin) &&
        (to == this.state.doc.length || bottom >= requiredBottom - coverMargin) &&
        top > requiredTop - 2 * margin &&
        bottom < requiredBottom + 2 * margin
    }

    return nextPolicy
  }

  private resolveOuterScrollViewport(
    view: EditorView,
    policy: OuterScrollViewportPolicy,
    bias: number,
    scrollTarget: MergeScrollTarget | null,
  ) {
    let viewport = this.mappedPrimaryOuterScrollViewport(view, bias) ??
      this.computeOuterScrollViewport(view, policy, bias, null)
    return scrollTarget
      ? this.includeScrollTargetInOuterViewport(policy.viewState, viewport, scrollTarget)
      : viewport
  }

  private mappedPrimaryOuterScrollViewport(view: EditorView, bias: number): DocumentRange | null {
    if (!this.outerScrollPrimarySide || this.sideForView(view) == this.outerScrollPrimarySide)
      return null
    let primaryView = this.outerScrollPrimarySide == "a" ? this.a : this.b
    let primaryPolicy = this.ensureEditorViewportPolicy(primaryView)
    if (!primaryPolicy) return null
    let primaryViewport = this.computeOuterScrollViewport(primaryView, primaryPolicy, bias, null)
    return mapRangeBetweenMergeSides(
      this.chunks,
      primaryViewport,
      this.outerScrollPrimarySide,
      view.state.doc.length,
    )
  }

  private sharedOuterScrollViewportOverride(bias = 0): SpacerViewportOverride | undefined {
    if (!this.outerScrollPrimarySide) return undefined
    let primaryView = this.outerScrollPrimarySide == "a" ? this.a : this.b
    let secondaryView = this.outerScrollPrimarySide == "a" ? this.b : this.a
    let primaryPolicy = this.ensureEditorViewportPolicy(primaryView)
    if (!primaryPolicy) return undefined
    let primaryViewport = this.computeOuterScrollViewport(primaryView, primaryPolicy, bias, null)
    let secondaryViewport = mapRangeBetweenMergeSides(
      this.chunks,
      primaryViewport,
      this.outerScrollPrimarySide,
      secondaryView.state.doc.length,
    )
    return this.outerScrollPrimarySide == "a"
      ? {a: primaryViewport, b: secondaryViewport}
      : {a: secondaryViewport, b: primaryViewport}
  }

  getSharedOuterScrollViewportOverride(bias = 0): SpacerViewportOverride | undefined {
    return this.sharedOuterScrollViewportOverride(bias)
  }

  private computeOuterScrollViewport(
    view: EditorView,
    policy: OuterScrollViewportPolicy,
    bias: number,
    scrollTarget: MergeScrollTarget | null,
  ) {
    let viewState = policy.viewState
    let margin = this.resolveOuterScrollViewportMargin()
    let marginTop = 0.5 - Math.max(-0.5, Math.min(0.5, bias / margin / 2))
    let map = viewState.heightMap, oracle = viewState.heightOracle
    let retained = this.updateRetainedOuterScrollViewport(view)
    let outerTop = Math.max(0, this.dom.scrollTop)
    let outerBottom = outerTop + Math.max(1, this.dom.clientHeight)
    let topPx = Math.min(outerTop - marginTop * margin, retained?.top ?? outerTop)
    let bottomPx = Math.max(outerBottom + (1 - marginTop) * margin, retained?.bottom ?? outerBottom)
    let viewport = {
      from: map.lineAt(topPx, QueryTypeByHeight, oracle, 0, 0).from,
      to: map.lineAt(bottomPx, QueryTypeByHeight, oracle, 0, 0).to,
    }
    return scrollTarget ? this.includeScrollTargetInOuterViewport(viewState, viewport, scrollTarget) : viewport
  }

  private includeScrollTargetInOuterViewport(
    viewState: MergeEditorViewState,
    viewport: DocumentRange,
    scrollTarget: MergeScrollTarget,
  ) {
    let {head} = scrollTarget.range
    if (head >= viewport.from && head <= viewport.to) return viewport
    let margin = this.resolveOuterScrollViewportMargin()
    let map = viewState.heightMap, oracle = viewState.heightOracle
    let viewHeight = Math.min(viewState.editorHeight, viewState.pixelViewport.bottom - viewState.pixelViewport.top)
    let block = map.lineAt(head, QueryTypeByPos, oracle, 0, 0), topPos
    if (scrollTarget.y == "center")
      topPos = (block.top + block.bottom) / 2 - viewHeight / 2
    else if (scrollTarget.y == "start" || scrollTarget.y == "nearest" && head < viewport.from)
      topPos = block.top
    else
      topPos = block.bottom - viewHeight
    return {
      from: map.lineAt(topPos - margin / 2, QueryTypeByHeight, oracle, 0, 0).from,
      to: map.lineAt(topPos + viewHeight + margin / 2, QueryTypeByHeight, oracle, 0, 0).to,
    }
  }

  private sideForView(view: EditorView): MergeSide {
    return view == this.a ? "a" : "b"
  }

  private updateRetainedOuterScrollViewport(view: EditorView) {
    if (!this.outerScrollViewportSync) return null
    let policy = this.ensureEditorViewportPolicy(view)
    if (!policy) return null
    let viewportHeight = Math.max(1, this.dom.clientHeight)
    let visibleTop = Math.max(0, this.dom.scrollTop)
    let visibleBottom = visibleTop + viewportHeight
    let margin = this.resolveOuterScrollViewportMargin()
    let nextTop = Math.max(0, visibleTop - margin)
    let nextBottom = visibleBottom + margin

    if (!policy.hasRetainedRange) {
      policy.hasRetainedRange = true
      policy.retainedTop = nextTop
      policy.retainedBottom = nextBottom
    } else {
      policy.retainedTop = Math.min(policy.retainedTop, nextTop)
      policy.retainedBottom = Math.max(policy.retainedBottom, nextBottom)
    }

    this.clampRetainedOuterScrollViewport(policy, visibleTop, visibleBottom)
    return {
      bottom: policy.retainedBottom,
      top: policy.retainedTop,
    }
  }

  private clampRetainedOuterScrollViewport(
    policy: OuterScrollViewportPolicy,
    visibleTop: number,
    visibleBottom: number,
  ) {
    let maxSpan = this.resolveOuterScrollViewportRetention()
    if (policy.retainedBottom - policy.retainedTop <= maxSpan) return
    let center = (visibleTop + visibleBottom) / 2
    let top = Math.max(0, center - maxSpan / 2)
    let bottom = top + maxSpan
    policy.retainedTop = Math.max(policy.retainedTop, top)
    policy.retainedBottom = Math.min(policy.retainedBottom, bottom)
    if (policy.retainedBottom < visibleBottom) {
      policy.retainedBottom = visibleBottom
      policy.retainedTop = Math.max(0, policy.retainedBottom - maxSpan)
    }
    if (policy.retainedTop > visibleTop) {
      policy.retainedTop = visibleTop
      policy.retainedBottom = policy.retainedTop + maxSpan
    }
  }

  private resolveOuterScrollViewportMargin() {
    return Math.max(this.outerScrollViewportMargin, 1000)
  }

  private resolveOuterScrollViewportRetention() {
    let margin = this.resolveOuterScrollViewportMargin()
    return Math.max(this.outerScrollViewportRetention, margin * 2)
  }

  private setupRevertControls(controls: boolean, toA: boolean, render: (() => HTMLElement) | undefined) {
    this.revertToA = toA
    this.revertToLeft = this.revertToA == (this.editorDOM.firstChild == this.a.dom.parentNode)
    this.renderRevert = render
    if (!controls && this.revertDOM) {
      this.revertDOM.remove()
      this.revertDOM = null
    } else if (controls && !this.revertDOM) {
      this.revertDOM = this.editorDOM.insertBefore(document.createElement("div"), this.editorDOM.firstChild!.nextSibling)
      this.revertDOM.addEventListener("mousedown", e => this.revertClicked(e))
      this.revertDOM.className = "cm-merge-revert"
    } else if (this.revertDOM) {
      this.revertDOM.textContent = ""
    }
  }

  private scheduleMeasure() {
    if (this.measuring < 0) {
      let win = (this.dom.ownerDocument.defaultView || window)
      this.measuring = win.requestAnimationFrame(() => {
        this.measuring = -1
        this.measure()
      })
    }
  }

  private measure() {
    updateSpacers(this.a, this.b, this.chunks, this.trailingSpacer, this.sharedOuterScrollViewportOverride())
    if (this.revertDOM) this.updateRevertButtons()
  }

  private updateRevertButtons() {
    let dom = this.revertDOM!, next = dom.firstChild as HTMLElement | null
    let viewportOverride = this.sharedOuterScrollViewportOverride()
    let vpA = viewportOverride?.a ?? this.a.viewport, vpB = viewportOverride?.b ?? this.b.viewport
    for (let i = 0; i < this.chunks.length; i++) {
      let chunk = this.chunks[i]
      let rangeA = chunkSideRange(chunk, "a"), rangeB = chunkSideRange(chunk, "b")
      if (rangeA.from > vpA.to && rangeB.from > vpB.to) break
      if (!chunkTouchesViewport(chunk, vpA, vpB)) continue
      let top = this.a.lineBlockAt(chunkActualRange(chunk, "a").from).top + "px"
      while (next && +(next.dataset.chunk!) < i) next = rm(next)
      if (next && next.dataset.chunk! == String(i)) {
        if (next.style.top != top) next.style.top = top
        next = next.nextSibling as HTMLElement | null
      } else {
        dom.insertBefore(this.renderRevertButton(top, i), next)
      }
    }
    while (next) next = rm(next)
  }

  private renderRevertButton(top: string, chunk: number) {
    let elt
    if (this.renderRevert) {
      elt = this.renderRevert()
    } else {
      elt = document.createElement("button")
      let text = this.a.state.phrase("Revert this chunk")
      elt.setAttribute("aria-label", text)
      elt.setAttribute("title", text)
      elt.textContent = this.revertToLeft ? "⇜" : "⇝"
    }
    elt.style.top = top
    elt.setAttribute("data-chunk", String(chunk))
    return elt
  }

  private revertClicked(e: MouseEvent) {
    let target = e.target as HTMLElement | null, chunk
    while (target && target.parentNode != this.revertDOM) target = target.parentNode as HTMLElement | null
    if (target && (chunk = this.chunks[target.dataset.chunk as any])) {
      let sourceSide: "a" | "b" = this.revertToA ? "b" : "a"
      let destSide: "a" | "b" = this.revertToA ? "a" : "b"
      let source = this.revertToA ? this.b : this.a
      let dest = this.revertToA ? this.a : this.b
      let sourceRange = chunkActualRange(chunk, sourceSide)
      let destRange = chunkActualRange(chunk, destSide)
      let insert = sourceRange.hasActualRange
        ? source.state.sliceDoc(sourceRange.from, sourceRange.to)
        : source.state.sliceDoc(sourceRange.from, Math.max(sourceRange.from, sourceRange.to - 1))
      if (!sourceRange.hasActualRange && sourceRange.from != sourceRange.to && destRange.to <= dest.state.doc.length) insert += source.state.lineBreak
      dest.dispatch({
        changes: {from: destRange.from, to: Math.min(dest.state.doc.length, destRange.to), insert},
        userEvent: "revert"
      })
      e.preventDefault()
    }
  }

  /// Destroy this merge view.
  destroy() {
    this.dom.removeEventListener("scroll", this.onOuterScroll)
    this.a.destroy()
    this.b.destroy()
    if (this.measuring > -1)
      (this.dom.ownerDocument.defaultView || window).cancelAnimationFrame(this.measuring)
    this.dom.remove()
  }
}

function rm(elt: HTMLElement) {
  let next = elt.nextSibling
  elt.remove()
  return next as HTMLElement | null
}
