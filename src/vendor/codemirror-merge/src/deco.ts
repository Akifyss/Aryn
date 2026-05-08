import {EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate, Direction,
        WidgetType, GutterMarker, gutter, layer, type LayerMarker} from "@codemirror/view"
import {EditorState, RangeSetBuilder, Text, StateField, StateEffect, RangeSet, Prec, type Extension} from "@codemirror/state"
import {Chunk} from "./chunk"
import type {Change} from "./diff"
import {ChunkField, deferredChunkUpdate, mergeConfig, setChunks} from "./merge"

export const refreshInlineChangeLayerEffect = StateEffect.define<null>()
export const refreshChunkDecorationsEffect = StateEffect.define<null>()

// MergeView can defer chunk recomputation during live edits/IME. While chunks
// are stale, the DOM-backed inline layer must not measure old change marks.
const chunksDeferredField = StateField.define<boolean>({
  create() {
    return false
  },
  update(value, tr) {
    if (tr.effects.some(effect => effect.is(setChunks))) return false
    if (tr.annotation(deferredChunkUpdate)) return true
    return value
  },
})

export const decorateChunks = ViewPlugin.fromClass(class {
  deco: DecorationSet
  gutter: RangeSet<GutterMarker> | null
  frozen = false

  constructor(view: EditorView) {
    ({deco: this.deco, gutter: this.gutter} = getChunkDeco(view))
  }

  update(update: ViewUpdate) {
    if (chunksChanged(update.startState, update.state)) {
      this.frozen = false;
      ({deco: this.deco, gutter: this.gutter} = getChunkDeco(update.view))
      return
    }

    let refreshRequested = hasRefreshChunkDecorationsEffect(update)
    if (isDeferredChunkUpdate(update)) this.frozen = true
    if (this.frozen) {
      if (refreshRequested) {
        ({deco: this.deco, gutter: this.gutter} = getChunkDeco(update.view))
      } else if (update.docChanged) {
        this.deco = this.deco.map(update.changes)
        if (this.gutter) this.gutter = this.gutter.map(update.changes)
      } else if (shouldRefreshFrozenChunkDecorationsForUpdate({
        configChanged: configChanged(update.startState, update.state),
        docChanged: update.docChanged,
        viewportChanged: update.viewportChanged,
      })) {
        ({deco: this.deco, gutter: this.gutter} = getChunkDeco(update.view))
      }
      return
    }

    if (shouldRefreshChunkDecorationsForUpdate({
      configChanged: configChanged(update.startState, update.state),
      docChanged: update.docChanged,
      refreshRequested,
      viewportChanged: update.viewportChanged,
    }))
      ({deco: this.deco, gutter: this.gutter} = getChunkDeco(update.view))
  }
}, {
  decorations: d => d.deco
})

export const changeGutter = Prec.low(gutter({
  class: "cm-changeGutter",
  markers: view => view.plugin(decorateChunks)?.gutter || RangeSet.empty
}))

const cachedInlineChangeLayerMarkers = new WeakMap<EditorView, readonly LayerMarker[]>()

const inlineChangeLayerExtension = layer({
  above: true,
  class: "cm-inlineChangeLayer",
  // update() already covers viewport/doc/chunk changes; avoid a second layout read.
  updateOnDocViewUpdate: false,
  update(update) {
    if (isDeferredChunkUpdate(update)) return false
    return shouldMeasureInlineChangeLayer({
      chunksChanged: chunksChanged(update.startState, update.state),
      configChanged: configChanged(update.startState, update.state),
      deferredChunkUpdate: update.state.field(chunksDeferredField, false) === true,
      docChanged: update.docChanged,
      focusChanged: update.focusChanged,
      refreshRequested: hasRefreshInlineChangeLayerEffect(update),
      viewportChanged: update.viewportChanged,
    })
  },
  markers(view) {
    if (!shouldReadInlineChangeLayerDom(view.state.field(chunksDeferredField, false)))
      return cachedInlineChangeLayerMarkers.get(view) ?? []
    let markers = getInlineChangeLayerMarkers(view)
    cachedInlineChangeLayerMarkers.set(view, markers)
    return markers
  }
})

export const inlineChangeLayer: Extension = [
  chunksDeferredField,
  inlineChangeLayerExtension,
]

export function shouldMeasureInlineChangeLayer(update: {
  chunksChanged?: boolean,
  configChanged?: boolean,
  deferredChunkUpdate?: boolean,
  docChanged?: boolean,
  focusChanged?: boolean,
  refreshRequested?: boolean,
  viewportChanged?: boolean,
}) {
  if (!shouldReadInlineChangeLayerDom(update.deferredChunkUpdate)) return false
  return !!(
    update.docChanged ||
    update.viewportChanged ||
    update.focusChanged ||
    update.refreshRequested ||
    update.chunksChanged ||
    update.configChanged
  )
}

export function shouldReadInlineChangeLayerDom(chunksDeferred?: boolean) {
  return chunksDeferred !== true
}

export function shouldRefreshChunkDecorationsForUpdate(update: {
  configChanged?: boolean,
  docChanged?: boolean,
  refreshRequested?: boolean,
  viewportChanged?: boolean,
}) {
  return !!(
    update.refreshRequested ||
    update.docChanged ||
    update.viewportChanged ||
    update.configChanged
  )
}

function chunksChanged(s1: EditorState, s2: EditorState) {
  return s1.field(ChunkField, false) != s2.field(ChunkField, false)
}

function configChanged(s1: EditorState, s2: EditorState) {
  return s1.facet(mergeConfig) != s2.facet(mergeConfig)
}

function isDeferredChunkUpdate(update: ViewUpdate) {
  return update.transactions.some(tr => tr.annotation(deferredChunkUpdate))
}

function hasRefreshInlineChangeLayerEffect(update: ViewUpdate) {
  return update.transactions.some(tr =>
    tr.effects.some(effect => effect.is(refreshInlineChangeLayerEffect)))
}

function hasRefreshChunkDecorationsEffect(update: ViewUpdate) {
  return update.transactions.some(tr =>
    tr.effects.some(effect => effect.is(refreshChunkDecorationsEffect)))
}

export function shouldRefreshFrozenChunkDecorationsForUpdate(update: {
  configChanged?: boolean,
  docChanged?: boolean,
  viewportChanged?: boolean,
}) {
  return !!(!update.docChanged && (update.viewportChanged || update.configChanged))
}

const changedLine = Decoration.line({class: "cm-changedLine"})
const insertedLineFull = Decoration.line({class: "cm-insertedLineFull"})
const deletedLineFull = Decoration.line({class: "cm-deletedLineFull"})
export const changedText = Decoration.mark({class: "cm-changedText"})
export const changedTextFullLine = Decoration.mark({class: "cm-changedText cm-changedTextFullLine"})
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

const placeEmptyTextMarkersAfterTextMarks = 500000000
const changedTextEmpty = Decoration.widget({widget: new ChangedTextEmpty(), side: placeEmptyTextMarkersAfterTextMarks})

const changedLineGutterMarker = new class extends GutterMarker {
  elementClass = "cm-changedLineGutter"
}

type PendingDecoration = {from: number, to: number, decoration: Decoration}

function addPendingDecoration(target: RangeSetBuilder<Decoration> | PendingDecoration[], from: number, to: number, decoration: Decoration) {
  if (Array.isArray(target)) target.push({from, to, decoration})
  else target.add(from, to, decoration)
}

function flushPendingDecorations(builder: RangeSetBuilder<Decoration>, decorations: PendingDecoration[]) {
  decorations.sort((a, b) =>
    a.from - b.from ||
    a.decoration.startSide - b.decoration.startSide ||
    a.to - b.to ||
    a.decoration.endSide - b.decoration.endSide)
  for (let {from, to, decoration} of decorations) builder.add(from, to, decoration)
}

export type InlineChangeRect = {
  left: number
  top: number
  width: number
  height: number
  lineHeight?: number
  rowTop?: number
  rowBottom?: number
}

type InlineChangeRectGroup = {
  top: number
  bottom: number
  lineHeight: number
  rowTop: number | null
  rowBottom: number | null
  rects: InlineChangeRect[]
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
    path.setAttribute("shape-rendering", "crispEdges")
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
  let pixelRatio = inlineChangeLayerPixelRatio(view)
  for (let spec of inlineChangeLayerSpecs) {
    let rects = getInlineChangeRects(view, spec.selector)
    if (rects.length) markers.push(inlineChangeLayerMarker(rects, spec.className, pixelRatio))
  }
  return markers
}

function inlineChangeLayerPixelRatio(view: EditorView) {
  let ratio = view.dom.ownerDocument.defaultView?.devicePixelRatio
  return typeof ratio == "number" && Number.isFinite(ratio) && ratio > 0 ? ratio : 1
}

function getInlineChangeRects(view: EditorView, selector: string) {
  let scrollRect = view.scrollDOM.getBoundingClientRect()
  let baseLeft = (view.textDirection == Direction.LTR ? scrollRect.left : scrollRect.right - view.scrollDOM.clientWidth * view.scaleX) -
    view.scrollDOM.scrollLeft * view.scaleX
  let baseTop = scrollRect.top - view.scrollDOM.scrollTop * view.scaleY
  let rects: InlineChangeRect[] = []
  let lineMetrics = new WeakMap<HTMLElement, LineMetrics>()
  for (let elt of view.contentDOM.querySelectorAll<HTMLElement>(selector)) {
    let line = elt.closest(".cm-line") as HTMLElement | null
    let metrics = line && getLineMetrics(line, baseTop, view.defaultLineHeight, view.scaleY, lineMetrics)
    let fullLine = elt.classList.contains("cm-changedTextFullLine")
    for (let rect of elt.getClientRects()) {
      if (rect.width > 0 && rect.height > 0) {
        let top = rect.top - baseTop, height = rect.height
        let box = fullLine && line ? fullLineInlineChangeBox(line, baseLeft, rect, view) : null
        rects.push({...getInlineChangeRectLineBox(top, height, metrics),
          left: box ? box.left : rect.left - baseLeft,
          top,
          width: box ? box.width : rect.width,
          height})
      }
    }
  }
  return normalizeInlineChangeRects(rects, view.defaultLineHeight)
}

function fullLineInlineChangeBox(line: HTMLElement, baseLeft: number, rect: DOMRect, view: EditorView) {
  let lineRect = line.getBoundingClientRect()
  let lineLeft = lineRect.left - baseLeft
  let lineWidth = Math.max(rect.width, view.scrollDOM.clientWidth * view.scaleX - lineLeft)
  return {left: lineLeft, width: lineWidth}
}

type LineMetrics = {
  top: number
  bottom: number
  lineHeight: number
}

function getLineMetrics(line: HTMLElement, baseTop: number, fallbackLineHeight: number, scaleY: number,
                        cache: WeakMap<HTMLElement, LineMetrics>) {
  let cached = cache.get(line)
  if (cached) return cached
  let style = getComputedStyle(line)
  let rect = line.getBoundingClientRect()
  let paddingTop = parsedPixelValue(style.paddingTop) * scaleY
  let paddingBottom = parsedPixelValue(style.paddingBottom) * scaleY
  let cssLineHeight = parsedPixelValue(style.lineHeight) * scaleY
  let lineHeight = cssLineHeight > 0 ? cssLineHeight : fallbackLineHeight
  let metrics = {
    top: rect.top - baseTop + paddingTop,
    bottom: rect.bottom - baseTop - paddingBottom,
    lineHeight,
  }
  cache.set(line, metrics)
  return metrics
}

function parsedPixelValue(value: string) {
  let parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function getInlineChangeRectLineBox(top: number, height: number, metrics: LineMetrics | null): Pick<InlineChangeRect, "lineHeight" | "rowTop" | "rowBottom"> {
  if (!metrics || metrics.lineHeight <= 0 || metrics.bottom <= metrics.top)
    return {}
  let row = Math.max(0, Math.floor((top + height / 2 - metrics.top) / metrics.lineHeight))
  let maxRow = Math.max(0, Math.ceil((metrics.bottom - metrics.top) / metrics.lineHeight) - 1)
  row = Math.min(row, maxRow)
  let rowTop = metrics.top + row * metrics.lineHeight
  return {lineHeight: metrics.lineHeight, rowTop, rowBottom: rowTop + metrics.lineHeight}
}

export function normalizeInlineChangeRects(rects: readonly InlineChangeRect[], lineHeight: number): InlineChangeRect[] {
  if (!rects.length) return []

  let groups: InlineChangeRectGroup[] = []
  let threshold = Math.max(1, lineHeight * 0.25)
  for (let rect of rects.slice().sort((a, b) => a.top - b.top || a.left - b.left)) {
    let top = rect.top, bottom = rect.top + rect.height, center = (top + bottom) / 2
    let group = groups[groups.length - 1]
    if (group && center >= group.top - threshold && center <= group.bottom + threshold) {
      group.rects.push(rect)
      group.top = Math.min(group.top, top)
      group.bottom = Math.max(group.bottom, bottom)
      group.lineHeight = Math.max(group.lineHeight, rect.lineHeight || lineHeight)
      group.rowTop = rect.rowTop == null ? group.rowTop :
        group.rowTop == null ? rect.rowTop : Math.min(group.rowTop, rect.rowTop)
      group.rowBottom = rect.rowBottom == null ? group.rowBottom :
        group.rowBottom == null ? rect.rowBottom : Math.max(group.rowBottom, rect.rowBottom)
    } else {
      groups.push({
        top,
        bottom,
        lineHeight: rect.lineHeight || lineHeight,
        rowTop: rect.rowTop ?? null,
        rowBottom: rect.rowBottom ?? null,
        rects: [rect],
      })
    }
  }

  let overlap = 0.5
  let slots = groups.map(group => {
    if (group.rowTop != null && group.rowBottom != null) {
      let top = Math.min(group.rowTop, group.top)
      let bottom = Math.max(group.rowBottom, group.bottom)
      return {center: (top + bottom) / 2, top, bottom, height: bottom - top}
    }
    let center = (group.top + group.bottom) / 2
    let height = Math.max(group.lineHeight, group.bottom - group.top)
    return {center, top: center - height / 2, bottom: center + height / 2, height}
  })
  for (let i = 0; i < slots.length - 1; i++) {
    let slot = slots[i], next = slots[i + 1]
    let distance = next.center - slot.center
    let close = distance <= Math.max(lineHeight, (slot.height + next.height) / 2) * 1.6
    let gap = next.top - slot.bottom
    if (close && gap > 0) {
      let boundary = slot.bottom + gap / 2
      slot.bottom = boundary + overlap
      next.top = boundary - overlap
    }
  }

  let result: InlineChangeRect[] = []
  for (let i = 0; i < groups.length; i++) {
    let slot = slots[i]
    if (slot.bottom <= slot.top) continue
    for (let rect of groups[i].rects)
      result.push({left: rect.left, top: slot.top, width: rect.width, height: slot.bottom - slot.top})
  }
  return result
}

export function snapInlineChangeLayerRect(rect: InlineChangeRect, pixelRatio = 1): InlineChangeRect {
  let ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1
  let left = Math.floor(rect.left * ratio) / ratio
  let top = Math.floor(rect.top * ratio) / ratio
  let right = Math.ceil((rect.left + rect.width) * ratio) / ratio
  let bottom = Math.ceil((rect.top + rect.height) * ratio) / ratio
  return {
    ...rect,
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

function inlineChangeLayerMarker(rects: readonly InlineChangeRect[], className: string, pixelRatio = 1) {
  let snappedRects = rects.map(rect => snapInlineChangeLayerRect(rect, pixelRatio))
  let left = Math.min(...snappedRects.map(rect => rect.left))
  let top = Math.min(...snappedRects.map(rect => rect.top))
  let right = Math.max(...snappedRects.map(rect => rect.left + rect.width))
  let bottom = Math.max(...snappedRects.map(rect => rect.top + rect.height))
  let path = snappedRects.map(rect => {
    let x = rect.left - left, y = rect.top - top
    return `M${x} ${y}H${x + rect.width}V${y + rect.height}H${x}Z`
  }).join("")
  return new InlineChangeLayerMarker(className, left, top, right - left, bottom - top, path)
}

export function isWholeLineChange(chunk: Chunk, isA: boolean) {
  return isA ? chunk.fromB == chunk.toB : chunk.fromA == chunk.toA
}

export function isLineFullyInsertedOrDeleted(
  chunk: Chunk,
  from: number,
  lineFrom: number,
  lineTo: number,
  isA: boolean,
) {
  for (let change of chunk.changes) {
    if (changeFullyInsertsOrDeletesLine(change, from, lineFrom, lineTo, isA)) return true
  }
  return false
}

function changeFullyInsertsOrDeletesLine(
  change: Change,
  from: number,
  lineFrom: number,
  lineTo: number,
  isA: boolean,
) {
  let changeFrom = from + (isA ? change.fromA : change.fromB)
  let changeTo = from + (isA ? change.toA : change.toB)
  let otherFrom = isA ? change.fromB : change.fromA
  let otherTo = isA ? change.toB : change.toA
  return otherFrom == otherTo && changeFrom <= lineFrom && changeTo > lineTo && changeFrom < changeTo
}

function addChangedLineDeco(builder: RangeSetBuilder<Decoration> | PendingDecoration[], pos: number) {
  addPendingDecoration(builder, pos, pos, changedLine)
}

export function addChangedLineDecoration(builder: RangeSetBuilder<Decoration>, pos: number) {
  addChangedLineDeco(builder, pos)
}

function addFullLineDiffTextDeco(
  builder: RangeSetBuilder<Decoration> | PendingDecoration[],
  lineFrom: number,
  lineTo: number,
  emptyLineFull: Decoration,
  fullLineChangedText: Decoration | null | undefined,
) {
  // Match VS Code's layering: every changed line keeps the line background, and
  // a whole inserted/deleted line also receives the regular text-level mark.
  // Empty lines have no text range, so they still need the line-only fallback.
  if (lineFrom < lineTo) {
    if (fullLineChangedText) addPendingDecoration(builder, lineFrom, lineTo, fullLineChangedText)
    return
  }

  addPendingDecoration(builder, lineFrom, lineFrom, emptyLineFull)
}

function addInlineChangeDeco(
  chunk: Chunk,
  from: number,
  pos: number,
  lineFrom: number,
  lineEnd: number,
  isA: boolean,
  builder: RangeSetBuilder<Decoration> | PendingDecoration[],
  changeI: number,
  inlineChangedText: Decoration | null = changedText,
  inlineChangedTextEmpty: Decoration | null = changedTextEmpty,
  inlineChangedTextFullLine: Decoration | null = changedTextFullLine,
  shouldSkipChange: ((change: Change) => "empty" | "full" | null) | null = null,
) {
  while (changeI < chunk.changes.length) {
    let nextChange = chunk.changes[changeI]
    let nextFrom = from + (isA ? nextChange.fromA : nextChange.fromB)
    let nextTo = from + (isA ? nextChange.toA : nextChange.toB)
    if (nextTo < pos) {
      changeI++
      continue
    }
    if (nextFrom > lineEnd) break
    let skipChange = shouldSkipChange?.(nextChange) ?? null
    if (skipChange == "full") {
      if (nextTo <= lineEnd) changeI++
      else break
      continue
    }
    let chFrom = Math.max(pos, nextFrom), chTo = Math.min(lineEnd, nextTo)
    if (chFrom < chTo) {
      let otherFrom = isA ? nextChange.fromB : nextChange.fromA
      let otherTo = isA ? nextChange.toB : nextChange.toA
      let fullLineReplacement = lineFrom < lineEnd && otherFrom < otherTo &&
        nextFrom <= lineFrom && nextTo >= lineEnd
      let textDecoration = fullLineReplacement ? inlineChangedTextFullLine : inlineChangedText
      if (textDecoration) addPendingDecoration(builder, chFrom, chTo, textDecoration)
    }
    else if (skipChange != "empty" && nextFrom == nextTo && nextFrom >= pos && nextFrom <= lineEnd) {
      let otherFrom = isA ? nextChange.fromB : nextChange.fromA
      let otherTo = isA ? nextChange.toB : nextChange.toA
      if (otherFrom < otherTo && inlineChangedTextEmpty) addPendingDecoration(builder, nextFrom, nextFrom, inlineChangedTextEmpty)
    }
    if (nextTo <= lineEnd) changeI++
    else break
  }
  return changeI
}

export type ChunkDecorationOptions = {
  changedText?: Decoration | null
  changedTextEmpty?: Decoration | null
  changedTextFullLine?: Decoration | null
  gutter?: boolean
}

export function addChunkDecorations(
  chunk: Chunk,
  doc: Text,
  isA: boolean,
  highlight: boolean,
  builder: RangeSetBuilder<Decoration>,
  gutterBuilder: RangeSetBuilder<GutterMarker> | null = null,
  options: ChunkDecorationOptions = {},
) {
  let from = isA ? chunk.fromA : chunk.fromB, to = isA ? chunk.toA : chunk.toB
  let changeI = 0
  if (from != to) {
    let inlineChangedText = options.changedText === undefined ? changedText : options.changedText
    let inlineChangedTextEmpty = options.changedTextEmpty === undefined ? changedTextEmpty : options.changedTextEmpty
    let inlineChangedTextFullLine = options.changedTextFullLine === undefined
      ? options.changedText === null ? null : changedTextFullLine
      : options.changedTextFullLine
    let wholeLineChange = isWholeLineChange(chunk, isA)
    let emptyLineFull = isA ? deletedLineFull : insertedLineFull
    let pendingDecorations: PendingDecoration[] = []
    let lineFullDeco = (lineFrom: number, lineTo: number) =>
      wholeLineChange || isLineFullyInsertedOrDeleted(chunk, from, lineFrom, lineTo, isA) ? emptyLineFull : null
    let addLine = (pos: number) => {
      addChangedLineDeco(pendingDecorations, pos)
    }
    let firstLine = doc.lineAt(Math.min(from, doc.length))
    addLine(from)
    let firstLineFullDeco = lineFullDeco(firstLine.from, firstLine.to)
    if (firstLineFullDeco) {
      addFullLineDiffTextDeco(pendingDecorations, firstLine.from, firstLine.to, firstLineFullDeco, inlineChangedTextFullLine)
    }
    let markTo = Math.min(to, doc.length)
    if (from < markTo) addPendingDecoration(pendingDecorations, from, markTo, isA ? deleted : inserted)
    if (options.gutter !== false && gutterBuilder) gutterBuilder.add(from, from, changedLineGutterMarker)
    for (let iter = doc.iterRange(from, to - 1), pos = from; !iter.next().done;) {
      if (iter.lineBreak) {
        let line = doc.lineAt(Math.min(pos, doc.length))
        let lineIsFullChange = !!lineFullDeco(line.from, line.to)
        let shouldSkipChange = lineIsFullChange
          ? (change: Change) => changeFullyInsertsOrDeletesLine(change, from, line.from, line.to, isA) ? "full" : null
          : null
        if (highlight) changeI = addInlineChangeDeco(
          chunk,
          from,
          pos,
          line.from,
          pos,
          isA,
          pendingDecorations,
          changeI,
          inlineChangedText,
          inlineChangedTextEmpty,
          inlineChangedTextFullLine,
          shouldSkipChange,
        )
        pos++
        let nextLine = doc.lineAt(Math.min(pos, doc.length))
        addLine(pos)
        let nextLineFullDeco = lineFullDeco(nextLine.from, nextLine.to)
        if (nextLineFullDeco) {
          addFullLineDiffTextDeco(pendingDecorations, nextLine.from, nextLine.to, nextLineFullDeco, inlineChangedTextFullLine)
        }
        if (options.gutter !== false && gutterBuilder) gutterBuilder.add(pos, pos, changedLineGutterMarker)
        continue
      }
      let lineEnd = pos + iter.value.length
      let line = doc.lineAt(Math.min(pos, doc.length))
      let lineIsFullChange = !!lineFullDeco(line.from, line.to)
      let shouldSkipChange = (change: Change) => {
        let changeFrom = from + (isA ? change.fromA : change.fromB)
        let changeTo = from + (isA ? change.toA : change.toB)
        let otherFrom = isA ? change.fromB : change.fromA
        let otherTo = isA ? change.toB : change.toA
        if (otherFrom != otherTo || changeTo <= changeFrom) return null
        if (lineIsFullChange && changeFullyInsertsOrDeletesLine(change, from, line.from, line.to, isA)) return "full"
        return changeFrom <= line.from && changeTo > line.to && changeFrom == lineEnd ? "empty" : null
      }
      if (highlight) changeI = addInlineChangeDeco(
        chunk,
        from,
        pos,
        line.from,
        lineEnd,
        isA,
        pendingDecorations,
        changeI,
        inlineChangedText,
        inlineChangedTextEmpty,
        inlineChangedTextFullLine,
        shouldSkipChange,
      )
      pos = lineEnd
    }
    flushPendingDecorations(builder, pendingDecorations)
  }
}

function buildChunkDeco(chunk: Chunk, doc: Text, isA: boolean, highlight: boolean,
                        builder: RangeSetBuilder<Decoration>,
                        gutterBuilder: RangeSetBuilder<GutterMarker> | null) {
  addChunkDecorations(chunk, doc, isA, highlight, builder, gutterBuilder)
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

export type SpacerKind = "alignment" | "fakeLines"
export type TrailingSpacerMode = "all" | "fakeLines" | "none"

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

function rangeCrossesLineBreak(doc: Text, from: number, to: number) {
  if (from == to) return false
  let safeFrom = Math.max(0, Math.min(from, doc.length))
  let safeTo = Math.max(safeFrom, Math.min(to, doc.length))
  let last = Math.min(Math.max(safeFrom, safeTo - 1), doc.length)
  return doc.lineAt(last).number > doc.lineAt(safeFrom).number
}

function rangeCoversWholeLines(doc: Text, from: number, to: number) {
  if (from == to) return false
  let safeFrom = Math.max(0, Math.min(from, doc.length))
  let safeTo = Math.max(safeFrom, Math.min(to, doc.length))
  let startLine = doc.lineAt(safeFrom)
  let lastLine = doc.lineAt(Math.min(Math.max(safeFrom, safeTo - 1), doc.length))
  let endsAtLineTextBoundary = safeTo == lastLine.to
  let endsAtNextLineBoundary = lastLine.number < doc.lines && safeTo == doc.line(lastLine.number + 1).from
  return safeFrom == startLine.from && (endsAtLineTextBoundary || endsAtNextLineBoundary)
}

function rangeHasLineShape(doc: Text, from: number, to: number) {
  return rangeCrossesLineBreak(doc, from, to) || rangeCoversWholeLines(doc, from, to)
}

export function spacerKindAfterChunk(
  chunk: Chunk | null,
  side: "a" | "b",
  viewportAlignment: boolean,
  aDoc: Text,
  bDoc: Text
): SpacerKind {
  if (viewportAlignment || !chunk) return "alignment"
  let linesA = lineSpan(aDoc, chunk.fromA, chunk.toA)
  let linesB = lineSpan(bDoc, chunk.fromB, chunk.toB)
  let lineShapeA = rangeHasLineShape(aDoc, chunk.fromA, chunk.toA)
  let lineShapeB = rangeHasLineShape(bDoc, chunk.fromB, chunk.toB)
  return side == "a" ? linesA < linesB && lineShapeB ? "fakeLines" : "alignment" : linesB < linesA && lineShapeA ? "fakeLines" : "alignment"
}

export function shouldAddTrailingSpacer(kind: SpacerKind, mode: TrailingSpacerMode = "all") {
  return mode == "all" || (mode == "fakeLines" && kind == "fakeLines")
}

export function spacerSideAfterChunk(
  chunk: Chunk | null,
  kind: SpacerKind,
  doc: Text,
  pos: number
) {
  if (kind != "fakeLines" || !chunk || pos <= 0) return -1
  let clampedPos = Math.min(pos, doc.length)
  let line = doc.lineAt(clampedPos)
  return clampedPos == doc.length || clampedPos == line.to && line.from < line.to ? 1 : -1
}

function compareSpacers(a: DecorationSet, b: DecorationSet) {
  if (a.size != b.size) return false
  let iA = a.iter(), iB = b.iter()
  while (iA.value) {
    let spacerA = iA.value.spec.widget as Spacer, spacerB = iB.value!.spec.widget as Spacer
    if (iA.from != iB.from || spacerA.kind != spacerB.kind ||
        iA.value.spec.side != iB.value!.spec.side ||
        Math.abs(spacerA.height - spacerB.height) > 1)
      return false
    iA.next(); iB.next()
  }
  return true
}

export function updateSpacers(
  a: EditorView,
  b: EditorView,
  chunks: readonly Chunk[],
  trailingSpacer: TrailingSpacerMode = "all"
) {
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
        let kind = spacerKindAfterChunk(previousChunk, "a", viewportAlignment, a.state.doc, b.state.doc)
        buildA.add(posA, posA, Decoration.widget({
          widget: new Spacer(-diff, kind),
          block: true,
          side: spacerSideAfterChunk(previousChunk, kind, a.state.doc, posA)
        }))
      } else if (diff > epsilon) {
        offB += diff
        let kind = spacerKindAfterChunk(previousChunk, "b", viewportAlignment, a.state.doc, b.state.doc)
        buildB.add(posB, posB, Decoration.widget({
          widget: new Spacer(diff, kind),
          block: true,
          side: spacerSideAfterChunk(previousChunk, kind, b.state.doc, posB)
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
    let kind = spacerKindAfterChunk(lastChunk, "a", false, a.state.doc, b.state.doc)
    if (shouldAddTrailingSpacer(kind, trailingSpacer))
      buildA.add(a.state.doc.length, a.state.doc.length, Decoration.widget({
        widget: new Spacer(-docDiff, kind),
        block: true,
        side: spacerSideAfterChunk(lastChunk, kind, a.state.doc, a.state.doc.length)
      }))
  } else if (docDiff > epsilon) {
    let kind = spacerKindAfterChunk(lastChunk, "b", false, a.state.doc, b.state.doc)
    if (shouldAddTrailingSpacer(kind, trailingSpacer))
      buildB.add(b.state.doc.length, b.state.doc.length, Decoration.widget({
        widget: new Spacer(docDiff, kind),
        block: true,
        side: spacerSideAfterChunk(lastChunk, kind, b.state.doc, b.state.doc.length)
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
