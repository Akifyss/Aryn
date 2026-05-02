import {EditorView} from "@codemirror/view"
import {EditorStateConfig, Transaction, EditorState, StateEffect, Prec, Compartment, ChangeSet} from "@codemirror/state"
import {Chunk, defaultDiffConfig} from "./chunk"
import {DiffConfig} from "./diff"
import {deferredChunkUpdate, setChunks, ChunkField, mergeConfig} from "./merge"
import {decorateChunks, inlineChangeLayer, updateSpacers, Spacers, adjustSpacers, collapseUnchanged, changeGutter} from "./deco"
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
  private deferChunkUpdates: MergeConfig["deferChunkUpdates"]
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
    this.ensureEditorViewportPolicy(this.a)
    this.ensureEditorViewportPolicy(this.b)
    this.setupRevertControls(!!config.revertControls, config.revertControls == "b-to-a", config.renderRevertControl)
    if (config.parent) config.parent.appendChild(this.dom)
    this.syncOuterScrollListener()
    this.scheduleMeasure()
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
    let highlight = "highlightChanges" in config, gutter = "gutter" in config, collapse = "collapseUnchanged" in config
    if (highlight || gutter || collapse) {
      let effectsA: StateEffect<unknown>[] = [], effectsB: StateEffect<unknown>[] = []
      if (highlight || gutter) {
        let currentConfig = this.a.state.facet(mergeConfig)
        let markGutter = gutter ? config.gutter !== false : currentConfig.markGutter
        let highlightChanges = highlight ? config.highlightChanges !== false : currentConfig.highlightChanges
        effectsA.push(configCompartment.reconfigure([
          mergeConfig.of({side: "a", sibling: () => this.b, highlightChanges, markGutter}),
          markGutter ? changeGutter : []
        ]))
        effectsB.push(configCompartment.reconfigure([
          mergeConfig.of({side: "b", sibling: () => this.a, highlightChanges, markGutter}),
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

  private ensureOuterScrollViewport(view: EditorView) {
    let retained = this.updateRetainedOuterScrollViewport(view)
    let blocks = view.viewportLineBlocks
    let visibleTop = this.dom.scrollTop, visibleBottom = visibleTop + this.dom.clientHeight
    let first = blocks[0], last = blocks[blocks.length - 1]
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

      let margin = mergeView.resolveOuterScrollViewportMargin()
      let marginTop = 0.5 - Math.max(-0.5, Math.min(0.5, bias / margin / 2))
      let map = this.heightMap, oracle = this.heightOracle
      let retained = mergeView.updateRetainedOuterScrollViewport(view)
      let topPx = Math.min(this.visibleTop - marginTop * margin, retained?.top ?? this.visibleTop)
      let bottomPx = Math.max(this.visibleBottom + (1 - marginTop) * margin, retained?.bottom ?? this.visibleBottom)
      let viewport = {
        from: map.lineAt(topPx, QueryTypeByHeight, oracle, 0, 0).from,
        to: map.lineAt(bottomPx, QueryTypeByHeight, oracle, 0, 0).to,
      }

      if (scrollTarget) {
        let {head} = scrollTarget.range
        if (head < viewport.from || head > viewport.to) {
          let viewHeight = Math.min(this.editorHeight, this.pixelViewport.bottom - this.pixelViewport.top)
          let block = map.lineAt(head, QueryTypeByPos, oracle, 0, 0), topPos
          if (scrollTarget.y == "center")
            topPos = (block.top + block.bottom) / 2 - viewHeight / 2
          else if (scrollTarget.y == "start" || scrollTarget.y == "nearest" && head < viewport.from)
            topPos = block.top
          else
            topPos = block.bottom - viewHeight
          viewport = {
            from: map.lineAt(topPos - margin / 2, QueryTypeByHeight, oracle, 0, 0).from,
            to: map.lineAt(topPos + viewHeight + margin / 2, QueryTypeByHeight, oracle, 0, 0).to,
          }
        }
      }

      return viewport
    }

    viewState.viewportIsAppropriate = function({from, to}: {from: number, to: number}, bias = 0) {
      if (!mergeView.outerScrollViewportSync)
        return nextPolicy.originalViewportIsAppropriate.call(this, {from, to}, bias)

      if (!this.inView) return true
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
    return Math.max(this.outerScrollViewportMargin, this.dom.clientHeight * 4, 1000)
  }

  private resolveOuterScrollViewportRetention() {
    let margin = this.resolveOuterScrollViewportMargin()
    return Math.max(this.outerScrollViewportRetention, margin * 3, this.dom.clientHeight * 8)
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
    updateSpacers(this.a, this.b, this.chunks)
    if (this.revertDOM) this.updateRevertButtons()
  }

  private updateRevertButtons() {
    let dom = this.revertDOM!, next = dom.firstChild as HTMLElement | null
    let vpA = this.a.viewport, vpB = this.b.viewport
    for (let i = 0; i < this.chunks.length; i++) {
      let chunk = this.chunks[i]
      if (chunk.fromA > vpA.to || chunk.fromB > vpB.to) break
      if (chunk.fromA < vpA.from || chunk.fromB < vpB.from) continue
      let top = this.a.lineBlockAt(chunk.fromA).top + "px"
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

  private chunkActualRange(chunk: Chunk, side: "a" | "b"): [number, number, boolean] {
    let fromKey = side == "a" ? "actualFromA" : "actualFromB"
    let toKey = side == "a" ? "actualToA" : "actualToB"
    let chunkWithActualRange = chunk as Chunk & Record<string, unknown>
    return typeof chunkWithActualRange[fromKey] == "number" && typeof chunkWithActualRange[toKey] == "number"
      ? [chunkWithActualRange[fromKey] as number, chunkWithActualRange[toKey] as number, true]
      : side == "a" ? [chunk.fromA, chunk.toA, false] : [chunk.fromB, chunk.toB, false]
  }

  private revertClicked(e: MouseEvent) {
    let target = e.target as HTMLElement | null, chunk
    while (target && target.parentNode != this.revertDOM) target = target.parentNode as HTMLElement | null
    if (target && (chunk = this.chunks[target.dataset.chunk as any])) {
      let sourceSide: "a" | "b" = this.revertToA ? "b" : "a"
      let destSide: "a" | "b" = this.revertToA ? "a" : "b"
      let source = this.revertToA ? this.b : this.a
      let dest = this.revertToA ? this.a : this.b
      let [srcFrom, srcTo, hasActualSourceRange] = this.chunkActualRange(chunk, sourceSide)
      let [destFrom, destTo] = this.chunkActualRange(chunk, destSide)
      let insert = hasActualSourceRange
        ? source.state.sliceDoc(srcFrom, srcTo)
        : source.state.sliceDoc(srcFrom, Math.max(srcFrom, srcTo - 1))
      if (!hasActualSourceRange && srcFrom != srcTo && destTo <= dest.state.doc.length) insert += source.state.lineBreak
      dest.dispatch({
        changes: {from: destFrom, to: Math.min(dest.state.doc.length, destTo), insert},
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
