import {EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate, Direction,
        WidgetType, GutterMarker, gutter, layer, type LayerMarker} from "@codemirror/view"
import {EditorState, RangeSetBuilder, Text, StateField, StateEffect, RangeSet, Prec} from "@codemirror/state"
import {Chunk} from "./chunk"
import {ChunkField, mergeConfig} from "./merge"

export const decorateChunks = ViewPlugin.fromClass(class {
  deco: DecorationSet
  gutter: RangeSet<GutterMarker> | null

  constructor(view: EditorView) {
    ({deco: this.deco, gutter: this.gutter} = getChunkDeco(view))
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || chunksChanged(update.startState, update.state) ||
        configChanged(update.startState, update.state))
      ({deco: this.deco, gutter: this.gutter} = getChunkDeco(update.view))
  }
}, {
  decorations: d => d.deco
})

export const changeGutter = Prec.low(gutter({
  class: "cm-changeGutter",
  markers: view => view.plugin(decorateChunks)?.gutter || RangeSet.empty
}))

export const inlineChangeLayer = layer({
  above: true,
  class: "cm-inlineChangeLayer",
  update(update) {
    return update.docChanged || update.viewportChanged ||
      chunksChanged(update.startState, update.state) ||
      configChanged(update.startState, update.state)
  },
  markers(view) {
    return getInlineChangeLayerMarkers(view)
  }
})

function chunksChanged(s1: EditorState, s2: EditorState) {
  return s1.field(ChunkField, false) != s2.field(ChunkField, false)
}

function configChanged(s1: EditorState, s2: EditorState) {
  return s1.facet(mergeConfig) != s2.facet(mergeConfig)
}

const changedLine = Decoration.line({class: "cm-changedLine"})
const insertedLineFull = Decoration.line({class: "cm-insertedLineFull"})
const deletedLineFull = Decoration.line({class: "cm-deletedLineFull"})
export const changedText = Decoration.mark({class: "cm-changedText"})
const inserted = Decoration.mark({tagName: "ins", class: "cm-insertedLine"})
const deleted = Decoration.mark({tagName: "del", class: "cm-deletedLine"})

class ChangedTextEmpty extends WidgetType {
  eq(other: ChangedTextEmpty) { return other instanceof ChangedTextEmpty }

  toDOM() {
    let elt = document.createElement("span")
    elt.className = "cm-changedTextEmpty"
    return elt
  }

  ignoreEvent() { return true }
}

const changedTextEmpty = Decoration.widget({widget: new ChangedTextEmpty(), side: 1})

const changedLineGutterMarker = new class extends GutterMarker {
  elementClass = "cm-changedLineGutter"
}

type InlineChangeRect = {
  left: number
  top: number
  width: number
  height: number
}

type InlineChangeLayerSpec = {
  selector: string
  className: string
}

const inlineChangeLayerSpecs: readonly InlineChangeLayerSpec[] = [
  {selector: ".cm-changedText", className: "cm-changedTextLayerRanges"},
  {selector: ".cm-deletedText", className: "cm-deletedTextLayerRanges"},
]

class InlineChangeLayerMarker implements LayerMarker {
  constructor(
    readonly className: string,
    readonly left: number,
    readonly top: number,
    readonly width: number,
    readonly height: number,
    readonly path: string
  ) {}

  eq(other: LayerMarker): boolean {
    return other instanceof InlineChangeLayerMarker &&
      this.className == other.className &&
      this.left == other.left && this.top == other.top &&
      this.width == other.width && this.height == other.height &&
      this.path == other.path
  }

  draw() {
    let elt = document.createElement("div")
    elt.className = this.className
    let svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    let path = document.createElementNS("http://www.w3.org/2000/svg", "path")
    path.setAttribute("class", "cm-inlineChangeLayerPath")
    svg.appendChild(path)
    elt.appendChild(svg)
    this.adjust(elt)
    return elt
  }

  update(elt: HTMLElement, prev: LayerMarker) {
    if (!(prev instanceof InlineChangeLayerMarker) || prev.className != this.className) return false
    this.adjust(elt)
    return true
  }

  private adjust(elt: HTMLElement) {
    elt.style.left = this.left + "px"
    elt.style.top = this.top + "px"
    elt.style.width = this.width + "px"
    elt.style.height = this.height + "px"
    let svg = elt.firstChild as SVGSVGElement
    svg.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`)
    let path = svg.firstChild as SVGPathElement
    path.setAttribute("d", this.path)
  }
}

function getInlineChangeLayerMarkers(view: EditorView) {
  if (!view.state.facet(mergeConfig).highlightChanges) return []
  let markers: LayerMarker[] = []
  for (let spec of inlineChangeLayerSpecs) {
    let rects = getInlineChangeRects(view, spec.selector)
    if (rects.length) markers.push(inlineChangeLayerMarker(rects, spec.className))
  }
  return markers
}

function getInlineChangeRects(view: EditorView, selector: string) {
  let scrollRect = view.scrollDOM.getBoundingClientRect()
  let baseLeft = (view.textDirection == Direction.LTR ? scrollRect.left : scrollRect.right - view.scrollDOM.clientWidth * view.scaleX) -
    view.scrollDOM.scrollLeft * view.scaleX
  let baseTop = scrollRect.top - view.scrollDOM.scrollTop * view.scaleY
  let rects: InlineChangeRect[] = []
  for (let elt of view.contentDOM.querySelectorAll<HTMLElement>(selector)) {
    for (let rect of elt.getClientRects()) {
      if (rect.width > 0 && rect.height > 0)
        rects.push({left: rect.left - baseLeft, top: rect.top - baseTop, width: rect.width, height: rect.height})
    }
  }
  return normalizeInlineChangeRects(rects, view.defaultLineHeight)
}

function normalizeInlineChangeRects(rects: readonly InlineChangeRect[], lineHeight: number): InlineChangeRect[] {
  if (!rects.length) return []

  let groups: {center: number, rects: InlineChangeRect[]}[] = []
  let threshold = Math.max(1, lineHeight * 0.05)
  for (let rect of rects.slice().sort((a, b) => a.top - b.top || a.left - b.left)) {
    let center = rect.top + rect.height / 2
    let group = groups[groups.length - 1]
    if (group && Math.abs(group.center - center) <= threshold) {
      group.rects.push(rect)
      group.center = (group.center * (group.rects.length - 1) + center) / group.rects.length
    } else {
      groups.push({center, rects: [rect]})
    }
  }

  let overlap = 0.5
  let slots = groups.map((group, i) => {
    let top = group.center - lineHeight / 2
    let bottom = group.center + lineHeight / 2
    if (i) {
      let prev = groups[i - 1], distance = group.center - prev.center
      if (distance <= lineHeight * 1.6) top = (prev.center + group.center) / 2 - overlap
    }
    if (i < groups.length - 1) {
      let next = groups[i + 1], distance = next.center - group.center
      if (distance <= lineHeight * 1.6) bottom = (group.center + next.center) / 2 + overlap
    }
    return {top, bottom}
  })

  let result: InlineChangeRect[] = []
  for (let i = 0; i < groups.length; i++) {
    let slot = slots[i]
    if (slot.bottom <= slot.top) continue
    for (let rect of groups[i].rects)
      result.push({...rect, top: slot.top, height: slot.bottom - slot.top})
  }
  return result
}

function inlineChangeLayerMarker(rects: readonly InlineChangeRect[], className: string) {
  let left = Math.min(...rects.map(rect => rect.left))
  let top = Math.min(...rects.map(rect => rect.top))
  let right = Math.max(...rects.map(rect => rect.left + rect.width))
  let bottom = Math.max(...rects.map(rect => rect.top + rect.height))
  let path = rects.map(rect => {
    let x = rect.left - left, y = rect.top - top
    return `M${x} ${y}H${x + rect.width}V${y + rect.height}H${x}Z`
  }).join("")
  return new InlineChangeLayerMarker(className, left, top, right - left, bottom - top, path)
}

export function isWholeLineChange(chunk: Chunk, isA: boolean) {
  return isA ? chunk.fromB == chunk.toB : chunk.fromA == chunk.toA
}

function addChangedLineDeco(builder: RangeSetBuilder<Decoration>, pos: number, fullLine: Decoration | null) {
  builder.add(pos, pos, changedLine)
  if (fullLine) builder.add(pos, pos, fullLine)
}

function addInlineChangeDeco(chunk: Chunk, from: number, pos: number, lineEnd: number, isA: boolean,
                             builder: RangeSetBuilder<Decoration>, changeI: number) {
  while (changeI < chunk.changes.length) {
    let nextChange = chunk.changes[changeI]
    let nextFrom = from + (isA ? nextChange.fromA : nextChange.fromB)
    let nextTo = from + (isA ? nextChange.toA : nextChange.toB)
    if (nextTo < pos) {
      changeI++
      continue
    }
    if (nextFrom > lineEnd) break
    let chFrom = Math.max(pos, nextFrom), chTo = Math.min(lineEnd, nextTo)
    if (chFrom < chTo) builder.add(chFrom, chTo, changedText)
    else if (nextFrom == nextTo && nextFrom >= pos && nextFrom <= lineEnd) {
      let otherFrom = isA ? nextChange.fromB : nextChange.fromA
      let otherTo = isA ? nextChange.toB : nextChange.toA
      if (otherFrom < otherTo) builder.add(nextFrom, nextFrom, changedTextEmpty)
    }
    if (nextTo <= lineEnd) changeI++
    else break
  }
  return changeI
}

function buildChunkDeco(chunk: Chunk, doc: Text, isA: boolean, highlight: boolean,
                        builder: RangeSetBuilder<Decoration>,
                        gutterBuilder: RangeSetBuilder<GutterMarker> | null) {
  let from = isA ? chunk.fromA : chunk.fromB, to = isA ? chunk.toA : chunk.toB
  let changeI = 0
  if (from != to) {
    let wholeLineChange = isWholeLineChange(chunk, isA)
    let fullLine = wholeLineChange ? isA ? deletedLineFull : insertedLineFull : null
    addChangedLineDeco(builder, from, fullLine)
    let markTo = Math.min(to, doc.length)
    if (from < markTo) builder.add(from, markTo, isA ? deleted : inserted)
    if (gutterBuilder) gutterBuilder.add(from, from, changedLineGutterMarker)
    for (let iter = doc.iterRange(from, to - 1), pos = from; !iter.next().done;) {
      if (iter.lineBreak) {
        if (highlight && !wholeLineChange) changeI = addInlineChangeDeco(chunk, from, pos, pos, isA, builder, changeI)
        pos++
        addChangedLineDeco(builder, pos, fullLine)
        if (gutterBuilder) gutterBuilder.add(pos, pos, changedLineGutterMarker)
        continue
      }
      let lineEnd = pos + iter.value.length
      if (highlight && !wholeLineChange) changeI = addInlineChangeDeco(chunk, from, pos, lineEnd, isA, builder, changeI)
      pos = lineEnd
    }
  }
}

function getChunkDeco(view: EditorView) {
  let chunks = view.state.field(ChunkField)
  let {side, highlightChanges, markGutter, overrideChunk} = view.state.facet(mergeConfig), isA = side == "a"
  let builder = new RangeSetBuilder<Decoration>()
  let gutterBuilder = markGutter ? new RangeSetBuilder<GutterMarker>() : null
  let {from, to} = view.viewport
  for (let chunk of chunks) {
    if ((isA ? chunk.fromA : chunk.fromB) > to) break
    if ((isA ? chunk.toA : chunk.toB) > from) {
      if (!overrideChunk || !overrideChunk(view.state, chunk, builder, gutterBuilder))
        buildChunkDeco(chunk, view.state.doc, isA, highlightChanges, builder, gutterBuilder)
    }
  }
  return {deco: builder.finish(), gutter: gutterBuilder && gutterBuilder.finish()}
}

type SpacerKind = "alignment" | "fakeLines"

class Spacer extends WidgetType {
  constructor(readonly height: number, readonly kind: SpacerKind = "alignment") { super() }

  eq(other: Spacer) { return this.height == other.height && this.kind == other.kind }

  toDOM() {
    let elt = document.createElement("div")
    elt.className = this.className
    elt.style.height = this.height + "px"
    return elt
  }

  updateDOM(dom: HTMLElement) {
    dom.className = this.className
    dom.style.height = this.height + "px"
    return true
  }

  get className() {
    return this.kind == "fakeLines" ? "cm-mergeSpacer cm-mergeSpacerFakeLines" : "cm-mergeSpacer"
  }

  get estimatedHeight() { return this.height }

  ignoreEvent() { return false }
}

export const adjustSpacers = StateEffect.define<DecorationSet>({
  map: (value, mapping) => value.map(mapping)
})

export const Spacers = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (spacers, tr) => {
    for (let e of tr.effects) if (e.is(adjustSpacers)) return e.value
    return spacers.map(tr.changes)
  },
  provide: f => EditorView.decorations.from(f)
})

const epsilon = .01

function documentBottom(view: EditorView) {
  return view.lineBlockAt(view.state.doc.length).bottom
}

function lineSpan(doc: Text, from: number, to: number) {
  if (from == to) return 0
  let safeTo = Math.min(Math.max(from, to - 1), doc.length)
  return doc.lineAt(safeTo).number - doc.lineAt(from).number + 1
}

function spacerKindAfterChunk(
  chunk: Chunk | null,
  side: "a" | "b",
  viewportAlignment: boolean,
  aDoc: Text,
  bDoc: Text
): SpacerKind {
  if (viewportAlignment || !chunk) return "alignment"
  let linesA = lineSpan(aDoc, chunk.fromA, chunk.toA)
  let linesB = lineSpan(bDoc, chunk.fromB, chunk.toB)
  return side == "a" ? linesA < linesB ? "fakeLines" : "alignment" : linesB < linesA ? "fakeLines" : "alignment"
}

function compareSpacers(a: DecorationSet, b: DecorationSet) {
  if (a.size != b.size) return false
  let iA = a.iter(), iB = b.iter()
  while (iA.value) {
    let spacerA = iA.value.spec.widget as Spacer, spacerB = iB.value!.spec.widget as Spacer
    if (iA.from != iB.from || spacerA.kind != spacerB.kind ||
        Math.abs(spacerA.height - spacerB.height) > 1)
      return false
    iA.next(); iB.next()
  }
  return true
}

export function updateSpacers(a: EditorView, b: EditorView, chunks: readonly Chunk[]) {
  let buildA = new RangeSetBuilder<Decoration>(), buildB = new RangeSetBuilder<Decoration>()
  let spacersA = a.state.field(Spacers).iter(), spacersB = b.state.field(Spacers).iter()
  let posA = 0, posB = 0, offA = 0, offB = 0, vpA = a.viewport, vpB = b.viewport
  let nextSpacerIsViewportAlignment = false
  chunks: for (let chunkI = 0;; chunkI++) {
    let chunk = chunkI < chunks.length ? chunks[chunkI] : null
    let endA = chunk ? chunk.fromA : a.state.doc.length, endB = chunk ? chunk.fromB : b.state.doc.length
    // A range at posA/posB is unchanged, must be aligned.
    if (posA < endA) {
      let previousChunk = chunkI > 0 ? chunks[chunkI - 1] : null
      let viewportAlignment = nextSpacerIsViewportAlignment
      nextSpacerIsViewportAlignment = false
      let heightA = a.lineBlockAt(posA).top + offA
      let heightB = b.lineBlockAt(posB).top + offB
      let diff = heightA - heightB
      if (diff < -epsilon) {
        offA -= diff
        buildA.add(posA, posA, Decoration.widget({
          widget: new Spacer(-diff, spacerKindAfterChunk(previousChunk, "a", viewportAlignment, a.state.doc, b.state.doc)),
          block: true,
          side: -1
        }))
      } else if (diff > epsilon) {
        offB += diff
        buildB.add(posB, posB, Decoration.widget({
          widget: new Spacer(diff, spacerKindAfterChunk(previousChunk, "b", viewportAlignment, a.state.doc, b.state.doc)),
          block: true,
          side: -1
        }))
      }
    }
    // If the viewport starts inside the unchanged range (on both
    // sides), add another sync at the top of the viewport. That way,
    // big unchanged chunks with possibly inaccurate estimated heights
    // won't cause the content to misalign (#1408)
    if (endA > posA + 1000 && posA < vpA.from && endA > vpA.from && posB < vpB.from && endB > vpB.from) {
      let off = Math.min(vpA.from - posA, vpB.from - posB)
      posA += off; posB += off
      nextSpacerIsViewportAlignment = true
      chunkI--
    } else if (!chunk) {
      break
    } else {
      posA = chunk.toA; posB = chunk.toB
    }
    while (spacersA.value && spacersA.from < posA) {
      offA -= (spacersA.value.spec.widget as Spacer).height
      spacersA.next()
    }
    while (spacersB.value && spacersB.from < posB) {
      offB -= (spacersB.value.spec.widget as Spacer).height
      spacersB.next()
    }
  }
  while (spacersA.value) {
    offA -= (spacersA.value.spec.widget as any).height
    spacersA.next()
  }
  while (spacersB.value) {
    offB -= (spacersB.value.spec.widget as any).height
    spacersB.next()
  }
  let docDiff = (documentBottom(a) + offA) - (documentBottom(b) + offB)
  let lastChunk = chunks.length ? chunks[chunks.length - 1] : null
  if (docDiff < epsilon) {
    buildA.add(a.state.doc.length, a.state.doc.length, Decoration.widget({
      widget: new Spacer(-docDiff, spacerKindAfterChunk(lastChunk, "a", false, a.state.doc, b.state.doc)),
      block: true,
      side: -1
    }))
  } else if (docDiff > epsilon) {
    buildB.add(b.state.doc.length, b.state.doc.length, Decoration.widget({
      widget: new Spacer(docDiff, spacerKindAfterChunk(lastChunk, "b", false, a.state.doc, b.state.doc)),
      block: true,
      side: -1
    }))
  }

  let decoA = buildA.finish(), decoB = buildB.finish()
  if (!compareSpacers(decoA, a.state.field(Spacers)))
    a.dispatch({effects: adjustSpacers.of(decoA)})
  if (!compareSpacers(decoB, b.state.field(Spacers)))
    b.dispatch({effects: adjustSpacers.of(decoB)})
}

/// A state effect that expands the section of collapsed unchanged
/// code starting at the given position.
export const uncollapseUnchanged = StateEffect.define<number>({
  map: (value, change) => change.mapPos(value)
})

/// Query whether the given view is displayed next to another editor
/// in a merge view. Returns `null` if it isn't, and a pair of editors
/// (one of which will be the view itself) otherwise.
export function mergeViewSiblings(view: EditorView) {
  let conf = view.state.facet(mergeConfig)
  return !conf || !conf.sibling ? null : conf.side == "a" ? {a: view, b: conf.sibling()} : {a: conf.sibling(), b: view}
}

class CollapseWidget extends WidgetType {
  constructor(readonly lines: number) { super() }

  eq(other: CollapseWidget) { return this.lines == other.lines }

  toDOM(view: EditorView) {
    let outer = document.createElement("div")
    outer.className = "cm-collapsedLines"
    outer.textContent = view.state.phrase("$ unchanged lines", this.lines)
    outer.addEventListener("click", e => {
      let pos = view.posAtDOM(e.target as HTMLElement)
      view.dispatch({effects: uncollapseUnchanged.of(pos)})
      let {side, sibling} = view.state.facet(mergeConfig)
      if (sibling) sibling().dispatch({effects: uncollapseUnchanged.of(mapPos(pos, view.state.field(ChunkField), side == "a"))})
    })
    return outer
  }

  ignoreEvent(e: Event) { return e instanceof MouseEvent }

  get estimatedHeight() { return 27 }

  get type() { return "collapsed-unchanged-code" }
}

function mapPos(pos: number, chunks: readonly Chunk[], isA: boolean) {
  let startOur = 0, startOther = 0
  for (let i = 0;; i++) {
    let next = i < chunks.length ? chunks[i] : null
    if (!next || (isA ? next.fromA : next.fromB) >= pos) return startOther + (pos - startOur)
    ;[startOur, startOther] = isA ? [next.toA, next.toB] : [next.toB, next.toA]
  }
}

const CollapsedRanges = StateField.define<DecorationSet>({
  create(state) { return Decoration.none },
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (let e of tr.effects) if (e.is(uncollapseUnchanged))
      deco = deco.update({filter: from => from != e.value})
    return deco
  },
  provide: f => EditorView.decorations.from(f)
})

export function collapseUnchanged({margin = 3, minSize = 4}: {margin?: number, minSize?: number}) {
  return CollapsedRanges.init(state => buildCollapsedRanges(state, margin, minSize))
}

function buildCollapsedRanges(state: EditorState, margin: number, minLines: number) {
  let builder = new RangeSetBuilder<Decoration>()
  let isA = state.facet(mergeConfig).side == "a"
  let chunks = state.field(ChunkField)
  let prevLine = 1
  for (let i = 0;; i++) {
    let chunk = i < chunks.length ? chunks[i] : null
    let collapseFrom = i ? prevLine + margin : 1
    let collapseTo = chunk ? state.doc.lineAt(isA ? chunk.fromA : chunk.fromB).number - 1 - margin : state.doc.lines
    let lines = collapseTo - collapseFrom + 1
    if (lines >= minLines) {
      builder.add(state.doc.line(collapseFrom).from, state.doc.line(collapseTo).to, Decoration.replace({
        widget: new CollapseWidget(lines),
        block: true
      }))
    }
    if (!chunk) break
    prevLine = state.doc.lineAt(Math.min(state.doc.length, isA ? chunk.toA : chunk.toB)).number
  }
  return builder.finish()
}
