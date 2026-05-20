// @ts-nocheck
import { Facet, RangeSetBuilder, StateEffect, StateField, EditorState, Transaction } from '@codemirror/state';
import { GutterMarker, gutter, EditorView, ViewPlugin } from '@codemirror/view';
import { splitDiffLines } from '../../shared/gitDiffCore';
import { buildLineFlagsFromVsCodeDiff, buildScopedLineFlagsFromVsCodeDiff } from '../../shared/gitDiffLineFlags';
import { getLiveGitCollapsedBlockAtLine, getLiveGitCollapsedBlocks } from './liveRenderedBlocks';

const MAX_DIFF_TEXT_CHARS = 1024 * 1024;
const NON_RENDERABLE_GIT_BASELINE_REASONS = new Set(['not-repo', 'ignored']);

export const setGitBaselineEffect = StateEffect.define<any>();
export const refreshGitDiffLineFlagsEffect = StateEffect.define<any>();
const setGitDiffLineFlagsEffect = StateEffect.define<(MarkerFlags | undefined)[] | null>();
const deferGitDiffLineFlagsRefreshEffect = StateEffect.define<null>();
const deferGitDiffLineFlagDocChangesFacet = Facet.define<boolean, boolean>({
  combine(values) {
    return values.some(Boolean);
  }
});

interface BaselineSnapshot {
  available: boolean;
  tracked: boolean;
  baseText: string | null;
  baseLines: string[] | null;
  indexText: string | null;
  indexLines: string[] | null;
  headOid?: string | null;
  reason?: 'not-file' | 'git-unavailable' | 'not-repo' | 'ignored' | 'too-large' | 'binary' | 'error';
}

type GitGutterChangeKind = 'added' | 'deleted' | 'modified';

type GitGutterHunkMetadata = {
  diffHunkId?: string;
  hunkEndLine?: number;
  hunkId: string;
  hunkStartLine?: number;
};

export interface MarkerFlags {
  added: boolean;
  deleted: boolean;
  diffHunkId?: string;
  modified: boolean;
  removed?: boolean;
  hunkEndLine?: number;
  hunkId?: string;
  hunkStartLine?: number;
  hunks?: Partial<Record<GitGutterChangeKind, GitGutterHunkMetadata>>;
  liveBlockStartLine?: number;
  liveBlockEndLine?: number;
  scope?: 'staged' | 'unstaged';
}

type GitDiffGutterRenderOptions = {
  mapLineFlag?: (flags: MarkerFlags) => MarkerFlags;
  mapWidgetLineFlag?: (
    flags: MarkerFlags | undefined,
    context: { block: any; pos: number; state: EditorState; widget: any }
  ) => MarkerFlags | null | undefined;
};

type GitDiffGutterBaselineOptions = {
  deferDocChanges?: boolean;
};

type SetGitBaselineOptions = {
  deferLineFlags?: boolean;
};

const emptyBaseline: BaselineSnapshot = Object.freeze({
  available: false,
  tracked: false,
  baseText: null,
  baseLines: null,
  indexText: null,
  indexLines: null
});

function normalizeBaselineSnapshot(snapshot: any): BaselineSnapshot {
  if (!snapshot || typeof snapshot !== 'object') {
    return emptyBaseline;
  }
  const baseText = typeof snapshot.baseText === 'string' ? snapshot.baseText : null;
  const indexText = typeof snapshot.indexText === 'string' ? snapshot.indexText : null;
  return {
    available: snapshot.available === true,
    tracked: snapshot.tracked === true,
    headOid: typeof snapshot.headOid === 'string' ? snapshot.headOid : snapshot.headOid === null ? null : undefined,
    baseText,
    baseLines: typeof baseText === 'string' ? splitDiffLines(baseText) : null,
    indexText,
    indexLines: typeof indexText === 'string' ? splitDiffLines(indexText) : null,
    reason: typeof snapshot.reason === 'string' ? snapshot.reason : undefined
  };
}

const gitBaselineField = StateField.define<BaselineSnapshot>({
  create(): BaselineSnapshot {
    return emptyBaseline;
  },
  update(value: BaselineSnapshot, tr: Transaction): BaselineSnapshot {
    for (const effect of tr.effects) {
      if (effect.is(setGitBaselineEffect)) {
        return normalizeBaselineSnapshot(effect.value);
      }
    }
    return value;
  }
});

class GitGutterMarker extends GutterMarker {
  flags: MarkerFlags;
  key: string;

  constructor(flags: MarkerFlags) {
    super();
    this.flags = flags;
    this.key = JSON.stringify(flags);
  }

  eq(other: GitGutterMarker): boolean {
    return other instanceof GitGutterMarker && other.key === this.key;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'meo-git-gutter-marker';
    if (typeof this.flags.diffHunkId === 'string' && this.flags.diffHunkId) {
      el.dataset.meoGitDiffHunkId = this.flags.diffHunkId;
    }
    if (typeof this.flags.hunkId === 'string' && this.flags.hunkId) {
      el.dataset.meoGitHunkId = this.flags.hunkId;
    }
    for (const kind of markerFlagChangeKinds(this.flags)) {
      const encoded = encodeMarkerHunkMetadata(getMarkerKindHunkMetadata(this.flags, kind));
      if (encoded) {
        el.dataset[`meoGitHunk${kind[0].toUpperCase()}${kind.slice(1)}`] = encoded;
      }
    }
    if (Number.isInteger(this.flags.hunkStartLine)) {
      el.dataset.meoGitHunkStartLine = String(this.flags.hunkStartLine);
    }
    if (Number.isInteger(this.flags.hunkEndLine)) {
      el.dataset.meoGitHunkEndLine = String(this.flags.hunkEndLine);
    }
    if (Number.isInteger(this.flags.liveBlockStartLine)) {
      el.dataset.meoLiveBlockStartLine = String(this.flags.liveBlockStartLine);
    }
    if (Number.isInteger(this.flags.liveBlockEndLine)) {
      el.dataset.meoLiveBlockEndLine = String(this.flags.liveBlockEndLine);
    }
    if (this.flags.scope === 'staged' || this.flags.scope === 'unstaged') {
      el.dataset.meoGitScope = this.flags.scope;
      el.classList.add(`is-${this.flags.scope}`);
    }

    if (this.flags.added) {
      el.classList.add('is-added');
    }
    if (this.flags.modified) {
      el.classList.add('is-modified');
    }
    if (this.flags.removed) {
      el.classList.add('is-removed');
    }
    if (this.flags.deleted) {
      el.classList.add('is-deleted');
    }

    if (!this.flags.added && !this.flags.modified && !this.flags.deleted && !this.flags.removed) {
      el.classList.add('is-empty');
    }

    const stripe = document.createElement('span');
    stripe.className = 'meo-git-gutter-stripe';
    el.appendChild(stripe);

    if (this.flags.deleted) {
      const deletedTriangle = document.createElement('span');
      deletedTriangle.className = 'meo-git-gutter-deleted-triangle';
      el.appendChild(deletedTriangle);
    }

    return el;
  }
}

class GitGutterSpacerMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'meo-git-gutter-marker meo-git-gutter-spacer';
    return el;
  }
}

const markerCache = new Map<string, GitGutterMarker>();
const spacerMarker = new GitGutterSpacerMarker();

function gitMarker(flags: MarkerFlags): GitGutterMarker {
  const key = JSON.stringify(flags);
  let marker = markerCache.get(key);
  if (!marker) {
    marker = new GitGutterMarker(flags);
    markerCache.set(key, marker);
  }
  return marker;
}

function emptyMarkerFlags(): MarkerFlags {
  return {
    added: false,
    deleted: false,
    modified: false,
    removed: false
  };
}

function markerFlagsHaveChange(flags: MarkerFlags | undefined | null): boolean {
  return !!(flags?.added || flags?.deleted || flags?.modified || flags?.removed);
}

function markerFlagsScopeKey(flags: MarkerFlags): string {
  return flags.scope === 'staged' || flags.scope === 'unstaged' ? flags.scope : 'unscoped';
}

function createGitHunkId(scopeKey: string, startLine: number, endLine: number): string {
  return `${scopeKey}:${startLine}:${endLine}`;
}

function getMarkerKindHunkMetadata(flags: MarkerFlags, kind: GitGutterChangeKind | null | undefined): GitGutterHunkMetadata | null {
  if (
    kind &&
    flags.hunks?.[kind] &&
    typeof flags.hunks[kind]?.hunkId === 'string' &&
    flags.hunks[kind]?.hunkId
  ) {
    return flags.hunks[kind] as GitGutterHunkMetadata;
  }
  return null;
}

function markerFlagChangeKinds(flags: MarkerFlags): GitGutterChangeKind[] {
  const kinds: GitGutterChangeKind[] = [];
  if (flags.added) {
    kinds.push('added');
  }
  if (flags.modified) {
    kinds.push('modified');
  }
  if (flags.deleted) {
    kinds.push('deleted');
  }
  return kinds;
}

function createMarkerHunkMetadata(startLine: number, endLine: number, scopeKey = 'unscoped'): GitGutterHunkMetadata {
  return {
    hunkEndLine: endLine,
    hunkId: createGitHunkId(scopeKey, startLine, endLine),
    hunkStartLine: startLine
  };
}

function addGitHunkMetadata(flags: MarkerFlags, startLine: number, endLine: number, scopeKey = markerFlagsScopeKey(flags)): MarkerFlags {
  const metadata = createMarkerHunkMetadata(startLine, endLine, scopeKey);
  if (
    flags.hunkId === metadata.hunkId &&
    flags.hunkStartLine === startLine &&
    flags.hunkEndLine === endLine &&
    markerFlagChangeKinds(flags).every((kind) => flags.hunks?.[kind]?.hunkId === metadata.hunkId)
  ) {
    return flags;
  }

  const hunks = {
    ...(flags.hunks ?? {})
  };
  for (const kind of markerFlagChangeKinds(flags)) {
    hunks[kind] = hunks[kind] ?? metadata;
  }

  return {
    ...flags,
    ...metadata,
    hunks
  };
}

function normalizeExplicitMarkerHunks(flags: MarkerFlags, fallbackStartLine: number, fallbackEndLine: number): MarkerFlags {
  if (typeof flags.hunkId !== 'string' || !flags.hunkId) {
    return flags;
  }

  const fallbackMetadata = {
    diffHunkId: flags.diffHunkId,
    hunkEndLine: Number.isInteger(flags.hunkEndLine) ? flags.hunkEndLine : fallbackEndLine,
    hunkId: flags.hunkId,
    hunkStartLine: Number.isInteger(flags.hunkStartLine) ? flags.hunkStartLine : fallbackStartLine
  };
  const hunks = {
    ...(flags.hunks ?? {})
  };
  for (const kind of markerFlagChangeKinds(flags)) {
    hunks[kind] = hunks[kind] ?? fallbackMetadata;
  }

  return {
    ...flags,
    ...fallbackMetadata,
    hunks
  };
}

function addFallbackGitHunkMetadata(flags: MarkerFlags, lineNumber: number): MarkerFlags {
  if (typeof flags.hunkId === 'string' && flags.hunkId) {
    return normalizeExplicitMarkerHunks(flags, lineNumber, lineNumber);
  }
  const normalizedLineNumber = Math.max(1, Math.floor(lineNumber));
  return addGitHunkMetadata(flags, normalizedLineNumber, normalizedLineNumber);
}

function inheritGitHunkMetadata(flags: MarkerFlags, source: MarkerFlags | undefined | null, fallbackLineNumber: number): MarkerFlags {
  if (typeof flags.hunkId === 'string' && flags.hunkId) {
    return flags;
  }
  if (typeof source?.hunkId === 'string' && source.hunkId) {
    const fallbackMetadata = {
      diffHunkId: source.diffHunkId,
      hunkEndLine: source.hunkEndLine,
      hunkId: source.hunkId,
      hunkStartLine: source.hunkStartLine
    };
    const inheritedKinds = markerFlagChangeKinds(flags);
    const inheritedHunks = {
      ...(source.hunks ?? {})
    };
    for (const kind of inheritedKinds) {
      inheritedHunks[kind] = getMarkerKindHunkMetadata(source, kind) ?? fallbackMetadata;
    }
    return {
      ...flags,
      diffHunkId: source.diffHunkId,
      hunkEndLine: source.hunkEndLine,
      hunkId: source.hunkId,
      hunkStartLine: source.hunkStartLine,
      hunks: inheritedHunks
    };
  }
  return addFallbackGitHunkMetadata(flags, fallbackLineNumber);
}

function markerHunkIdentityForKind(flags: MarkerFlags, kind: GitGutterChangeKind | null | undefined): string | null {
  return getMarkerKindHunkMetadata(flags, kind)?.hunkId ?? flags.hunkId ?? null;
}

function markerFlagsPrimaryHunkIdentity(flags: MarkerFlags): string | null {
  const parts = markerFlagChangeKinds(flags)
    .map((kind) => markerHunkIdentityForKind(flags, kind))
    .filter(Boolean);
  return parts.length
    ? parts.join('|')
    : typeof flags.hunkId === 'string' && flags.hunkId
      ? flags.hunkId
      : null;
}

function addGitHunkMetadataToLineFlags(lineFlags: (MarkerFlags | undefined)[] | null): (MarkerFlags | undefined)[] | null {
  if (!Array.isArray(lineFlags) || !lineFlags.length) {
    return lineFlags;
  }

  const result = lineFlags.slice();
  let activeStartLine = 0;
  let activeExplicitHunkId: string | null = null;
  let activeScopeKey = '';

  const flush = (endLineExclusive: number) => {
    if (!activeStartLine) {
      return;
    }
    const startLine = activeStartLine;
    const endLine = Math.max(startLine, endLineExclusive - 1);
    for (let lineNo = startLine; lineNo <= endLine; lineNo += 1) {
      const flags = result[lineNo - 1];
      if (flags && markerFlagsHaveChange(flags)) {
        result[lineNo - 1] = typeof flags.hunkId === 'string' && flags.hunkId
          ? normalizeExplicitMarkerHunks(flags, startLine, endLine)
          : addGitHunkMetadata(flags, startLine, endLine, activeScopeKey);
      }
    }
    activeStartLine = 0;
    activeExplicitHunkId = null;
    activeScopeKey = '';
  };

  for (let lineNo = 1; lineNo <= result.length; lineNo += 1) {
    const flags = result[lineNo - 1];
    if (!markerFlagsHaveChange(flags)) {
      flush(lineNo);
      continue;
    }

    const scopeKey = markerFlagsScopeKey(flags);
    const explicitHunkId = markerFlagsPrimaryHunkIdentity(flags);
    if (!activeStartLine) {
      activeStartLine = lineNo;
      activeExplicitHunkId = explicitHunkId;
      activeScopeKey = scopeKey;
      continue;
    }

    if (
      scopeKey !== activeScopeKey ||
      explicitHunkId !== activeExplicitHunkId
    ) {
      flush(lineNo);
      activeStartLine = lineNo;
      activeExplicitHunkId = explicitHunkId;
      activeScopeKey = scopeKey;
    }
  }

  flush(result.length + 1);
  return result;
}

function canRenderGitDiffBaseline(snapshot: BaselineSnapshot | null): boolean {
  if (!snapshot?.available) {
    return false;
  }
  if (!snapshot.reason) {
    return true;
  }
  return !NON_RENDERABLE_GIT_BASELINE_REASONS.has(snapshot.reason);
}

function buildDiffLineFlags(state: EditorState, baseline: BaselineSnapshot | null): (MarkerFlags | undefined)[] | null {
  if (!canRenderGitDiffBaseline(baseline)) {
    return null;
  }

  if (typeof baseline.baseText !== 'string') {
    if (!baseline.tracked || baseline.headOid === null) {
      const lineFlags: (MarkerFlags | undefined)[] = new Array(state.doc.lines);
      const textLength = state.doc.length;
      if (!textLength && state.doc.lines === 1 && state.doc.sliceString(0, state.doc.length) === '') {
        return lineFlags;
      }
      for (let i = 0; i < state.doc.lines; i += 1) {
        lineFlags[i] = { ...emptyMarkerFlags(), added: true, scope: 'unstaged' };
      }
      return lineFlags;
    }
    return null;
  }

  if (state.doc.length > MAX_DIFF_TEXT_CHARS || baseline.baseText.length > MAX_DIFF_TEXT_CHARS) {
    return null;
  }

  const baseLines = Array.isArray(baseline.baseLines) ? baseline.baseLines : splitDiffLines(baseline.baseText);
  const indexLines = Array.isArray(baseline.indexLines) ? baseline.indexLines : null;
  if (!indexLines || typeof baseline.indexText !== 'string') {
    return buildLineFlagsFromVsCodeDiff(baseLines, state.doc).map((flags) => (
      flags ? { ...flags, scope: 'unstaged' } : undefined
    ));
  }

  return buildScopedLineFlagsFromVsCodeDiff(baseLines, indexLines, state.doc);
}

function buildCurrentDiffLineFlags(state: EditorState, baseline: BaselineSnapshot | null): (MarkerFlags | undefined)[] | null {
  return buildDiffLineFlags(state, baseline);
}

function isCompositionInputTransaction(tr: Transaction): boolean {
  const userEvent = tr.annotation(Transaction.userEvent);
  return typeof userEvent === 'string' && userEvent.startsWith('input.type.compose');
}

function hasGitDiffRefreshEffect(tr: Transaction): boolean {
  return tr.effects.some((effect) => effect.is(refreshGitDiffLineFlagsEffect));
}

function hasGitBaselineEffect(tr: Transaction): boolean {
  return tr.effects.some((effect) => effect.is(setGitBaselineEffect));
}

function hasDeferredGitDiffLineFlagRefreshEffect(tr: Transaction): boolean {
  return tr.effects.some((effect) => effect.is(deferGitDiffLineFlagsRefreshEffect));
}

function getDirectGitDiffLineFlagsEffect(tr: Transaction): (MarkerFlags | undefined)[] | null | undefined {
  for (const effect of tr.effects) {
    if (effect.is(setGitDiffLineFlagsEffect)) {
      return effect.value;
    }
  }
  return undefined;
}

function shouldDeferGitDiffLineFlagDocChange(tr: Transaction): boolean {
  return tr.docChanged && tr.state.facet(deferGitDiffLineFlagDocChangesFacet);
}

function buildGitGutterMarkersFromLineFlags(state: EditorState, lineFlags: (MarkerFlags | undefined)[] | null, assumeHunkedLineFlags = false): any {
  const builder = new RangeSetBuilder<any>();
  const hunkedLineFlags = assumeHunkedLineFlags ? lineFlags : addGitHunkMetadataToLineFlags(lineFlags);
  if (!hunkedLineFlags) {
    return builder.finish();
  }

  for (let lineNo = 1; lineNo <= state.doc.lines; lineNo += 1) {
    const flags = hunkedLineFlags[lineNo - 1];
    if (!flags) {
      continue;
    }
    const line = state.doc.line(lineNo);
    builder.add(line.from, line.from, gitMarker(flags));
  }

  return builder.finish();
}

function buildLiveGitGutterMarkersFromLineFlags(state: EditorState, lineFlags: (MarkerFlags | undefined)[] | null, assumeHunkedLineFlags = false): any {
  const builder = new RangeSetBuilder<any>();
  const hunkedLineFlags = assumeHunkedLineFlags ? lineFlags : addGitHunkMetadataToLineFlags(lineFlags);
  if (!hunkedLineFlags) {
    return builder.finish();
  }

  const collapsedBlocks = getLiveGitCollapsedBlocks(state, hunkedLineFlags);
  let collapsedBlockIndex = 0;
  let activeCollapsedBlock = collapsedBlocks[collapsedBlockIndex] ?? null;
  let activeCollapsedFlags = activeCollapsedBlock ? liveCollapsedBlockMarkerFlags(activeCollapsedBlock, hunkedLineFlags) : null;

  for (let lineNo = 1; lineNo <= state.doc.lines; lineNo += 1) {
    const line = state.doc.line(lineNo);

    while (activeCollapsedBlock && lineNo > activeCollapsedBlock.endLine) {
      collapsedBlockIndex += 1;
      activeCollapsedBlock = collapsedBlocks[collapsedBlockIndex] ?? null;
      activeCollapsedFlags = activeCollapsedBlock ? liveCollapsedBlockMarkerFlags(activeCollapsedBlock, hunkedLineFlags) : null;
    }

    if (activeCollapsedBlock && lineNo >= activeCollapsedBlock.startLine && activeCollapsedFlags) {
      builder.add(line.from, line.from, gitMarker(activeCollapsedFlags));
      continue;
    }

    const flags = hunkedLineFlags[lineNo - 1];
    if (!flags) {
      continue;
    }
    builder.add(line.from, line.from, gitMarker(flags));
  }

  return builder.finish();
}

function mapLineFlags(
  lineFlags: (MarkerFlags | undefined)[] | null,
  mapLineFlag?: (flags: MarkerFlags) => MarkerFlags
): (MarkerFlags | undefined)[] | null {
  if (!lineFlags || typeof mapLineFlag !== 'function') {
    return lineFlags;
  }

  return lineFlags.map((flags, index) => (
    flags ? inheritGitHunkMetadata(mapLineFlag(flags), flags, index + 1) : undefined
  ));
}

function getSingleHunkMetadataForLineRange(
  lineFlags: (MarkerFlags | undefined)[] | null | undefined,
  startLine: number,
  endLine: number,
  kind: GitGutterChangeKind | null = null
): Pick<MarkerFlags, 'diffHunkId' | 'hunkEndLine' | 'hunkId' | 'hunkStartLine'> | null {
  if (!Array.isArray(lineFlags)) {
    return null;
  }

  let hunkId: string | null = null;
  let hunkStartLine: number | undefined;
  let hunkEndLine: number | undefined;
  let diffHunkId: string | undefined;
  for (let lineNo = startLine; lineNo <= endLine; lineNo += 1) {
    const flags = lineFlags[lineNo - 1];
    if (!markerFlagsHaveChange(flags)) {
      continue;
    }
    const metadata = kind
      ? getMarkerKindHunkMetadata(flags, kind)
      : null;
    const nextHunkId = metadata?.hunkId ?? (!kind && typeof flags?.hunkId === 'string' && flags.hunkId ? flags.hunkId : null);
    if (!nextHunkId) {
      continue;
    }
    if (hunkId && hunkId !== nextHunkId) {
      return null;
    }
    hunkId = nextHunkId;
    hunkStartLine = metadata?.hunkStartLine ?? flags?.hunkStartLine;
    hunkEndLine = metadata?.hunkEndLine ?? flags?.hunkEndLine;
    diffHunkId = metadata?.diffHunkId ?? flags?.diffHunkId;
  }

  return hunkId
    ? {
        diffHunkId,
        hunkEndLine,
        hunkId,
        hunkStartLine
      }
    : null;
}

function liveCollapsedBlockMarkerFlags(
  block: { startLine: number; endLine: number; aggregateChangeKind: 'added' | 'deleted' | 'modified' | 'removed'; aggregateChangeScope?: 'staged' | 'unstaged' },
  lineFlags: (MarkerFlags | undefined)[] | null = null
): MarkerFlags {
  const hunkMetadata = (
    getSingleHunkMetadataForLineRange(
      lineFlags,
      block.startLine,
      block.endLine,
      block.aggregateChangeKind === 'removed' ? null : block.aggregateChangeKind
    ) ??
    {
      hunkEndLine: block.endLine,
      hunkId: createGitHunkId(block.aggregateChangeScope ?? 'unscoped', block.startLine, block.endLine),
      hunkStartLine: block.startLine
    }
  );

  if (block.aggregateChangeKind === 'modified') {
    return {
      ...emptyMarkerFlags(),
      ...hunkMetadata,
      hunks: { modified: hunkMetadata },
      modified: true,
      scope: block.aggregateChangeScope,
      liveBlockStartLine: block.startLine,
      liveBlockEndLine: block.endLine
    };
  }

  if (block.aggregateChangeKind === 'deleted') {
    return {
      ...emptyMarkerFlags(),
      ...hunkMetadata,
      hunks: { deleted: hunkMetadata },
      deleted: true,
      scope: block.aggregateChangeScope,
      liveBlockStartLine: block.startLine,
      liveBlockEndLine: block.endLine
    };
  }

  if (block.aggregateChangeKind === 'removed') {
    return {
      ...emptyMarkerFlags(),
      ...hunkMetadata,
      removed: true,
      scope: block.aggregateChangeScope,
      liveBlockStartLine: block.startLine,
      liveBlockEndLine: block.endLine
    };
  }

  return {
    ...emptyMarkerFlags(),
    ...hunkMetadata,
    added: true,
    hunks: { added: hunkMetadata },
    scope: block.aggregateChangeScope,
    liveBlockStartLine: block.startLine,
    liveBlockEndLine: block.endLine
  };
}

interface DiffSegment {
  fromLine: number;
  toLine: number;
  added: boolean;
  deleted: boolean;
  modified: boolean;
}

function sameSegmentKind(segment: DiffSegment, flags: { added?: boolean; deleted?: boolean; modified?: boolean }): boolean {
  return (
    segment.added === !!flags.added &&
    segment.deleted === !!flags.deleted &&
    segment.modified === !!flags.modified
  );
}

export function getGitDiffOverviewSegments(state: EditorState): DiffSegment[] {
  const lineFlags = state.field(gitDiffLineFlagsField, false);
  if (!Array.isArray(lineFlags) || !lineFlags.length) {
    return [];
  }

  const segments: DiffSegment[] = [];
  let active: DiffSegment | null = null;

  const flush = () => {
    if (!active) {
      return;
    }
    segments.push(active);
    active = null;
  };

  for (let lineNo = 1; lineNo <= lineFlags.length; lineNo += 1) {
    const flags = lineFlags[lineNo - 1];
    if (flags?.scope === 'staged') {
      flush();
      continue;
    }
    const added = !!flags?.added;
    const deleted = !!flags?.deleted || !!flags?.removed;
    const modified = !!flags?.modified;
    if (!added && !deleted && !modified) {
      flush();
      continue;
    }

    if (
      active &&
      active.toLine + 1 === lineNo &&
      sameSegmentKind(active, { added, deleted, modified })
    ) {
      active.toLine = lineNo;
      continue;
    }

    flush();
    active = { fromLine: lineNo, toLine: lineNo, added, deleted, modified };
  }

  flush();
  return segments;
}

export function setGitBaseline(view: EditorView, snapshot: any, options: SetGitBaselineOptions = {}): void {
  const effects = [setGitBaselineEffect.of(snapshot)];
  if (options.deferLineFlags) {
    effects.push(deferGitDiffLineFlagsRefreshEffect.of(null));
  }

  view.dispatch({
    effects
  });
}

export function setGitDiffLineFlags(view: EditorView, lineFlags: (MarkerFlags | undefined)[] | null): void {
  view.dispatch({
    effects: setGitDiffLineFlagsEffect.of(lineFlags)
  });
}

function liveMarkerFlagsAtPos(
  state: EditorState,
  lineFlags: (MarkerFlags | undefined)[] | null,
  pos: number,
  assumeHunkedLineFlags = false
): MarkerFlags | null {
  const hunkedLineFlags = assumeHunkedLineFlags ? lineFlags : addGitHunkMetadataToLineFlags(lineFlags);
  if (!Array.isArray(hunkedLineFlags)) {
    return null;
  }
  const lineNo = state.doc.lineAt(Math.max(0, Math.min(pos, state.doc.length))).number;
  const block = getLiveGitCollapsedBlockAtLine(state, hunkedLineFlags, lineNo);
  if (block) {
    return liveCollapsedBlockMarkerFlags(block, hunkedLineFlags);
  }

  return hunkedLineFlags[lineNo - 1] ?? null;
}

function liveCollapsedBlockMarkerAtPos(
  state: EditorState,
  lineFlags: (MarkerFlags | undefined)[] | null,
  pos: number,
  mapLineFlag?: (flags: MarkerFlags) => MarkerFlags
): GitGutterMarker | null {
  const flags = liveMarkerFlagsAtPos(state, lineFlags, pos);
  if (!flags) {
    return null;
  }
  return gitMarker(typeof mapLineFlag === 'function' ? mapLineFlag(flags) : flags);
}

export const gitDiffLineFlagsField = StateField.define<(MarkerFlags | undefined)[] | null>({
  create(state: EditorState): (MarkerFlags | undefined)[] | null {
    return addGitHunkMetadataToLineFlags(buildCurrentDiffLineFlags(state, state.field(gitBaselineField)));
  },
  update(value: (MarkerFlags | undefined)[] | null, tr: Transaction): (MarkerFlags | undefined)[] | null {
    const directLineFlags = getDirectGitDiffLineFlagsEffect(tr);
    if (directLineFlags !== undefined) {
      return addGitHunkMetadataToLineFlags(directLineFlags);
    }

    const baselineChanged = hasGitBaselineEffect(tr);
    const forceRefresh = hasGitDiffRefreshEffect(tr);
    if (baselineChanged && !forceRefresh && hasDeferredGitDiffLineFlagRefreshEffect(tr)) {
      return value;
    }
    if (
      tr.docChanged
      && !baselineChanged
      && !forceRefresh
      && (isCompositionInputTransaction(tr) || shouldDeferGitDiffLineFlagDocChange(tr))
    ) {
      return value;
    }
    if (!tr.docChanged && !baselineChanged && !forceRefresh) {
      return value;
    }
    const baseline = tr.state.field(gitBaselineField);
    return addGitHunkMetadataToLineFlags(buildCurrentDiffLineFlags(tr.state, baseline));
  }
});

const gitDiffGutterField = StateField.define<any>({
  create(state: EditorState): any {
    return buildGitGutterMarkersFromLineFlags(state, state.field(gitDiffLineFlagsField), true);
  },
  update(value: any, tr: Transaction): any {
    const directLineFlags = getDirectGitDiffLineFlagsEffect(tr);
    if (directLineFlags !== undefined) {
      return buildGitGutterMarkersFromLineFlags(tr.state, tr.state.field(gitDiffLineFlagsField), true);
    }

    const baselineChanged = hasGitBaselineEffect(tr);
    const forceRefresh = hasGitDiffRefreshEffect(tr);
    if (baselineChanged && !forceRefresh && hasDeferredGitDiffLineFlagRefreshEffect(tr)) {
      return value;
    }
    if (
      tr.docChanged
      && !baselineChanged
      && !forceRefresh
      && (isCompositionInputTransaction(tr) || shouldDeferGitDiffLineFlagDocChange(tr))
    ) {
      return typeof value?.map === 'function' ? value.map(tr.changes) : value;
    }
    if (!tr.docChanged && !baselineChanged && !forceRefresh) {
      return value;
    }
    return buildGitGutterMarkersFromLineFlags(tr.state, tr.state.field(gitDiffLineFlagsField), true);
  }
});

const gitDiffGutterExtension = gutter({
  class: 'meo-git-gutter',
  renderEmptyElements: true,
  initialSpacer() {
    return spacerMarker;
  },
  markers(view: EditorView) {
    return (
      view.state.field(gitDiffGutterField, false) ??
      buildGitGutterMarkersFromLineFlags(view.state, view.state.field(gitDiffLineFlagsField, false), true)
    );
  }
});

function createGitDiffLiveGutterField(options: GitDiffGutterRenderOptions = {}) {
  return StateField.define<any>({
    create(state: EditorState): any {
      const lineFlags = mapLineFlags(state.field(gitDiffLineFlagsField, false), options.mapLineFlag);
      return buildLiveGitGutterMarkersFromLineFlags(
        state,
        lineFlags,
        true
      );
    },
    update(value: any, tr: Transaction): any {
      const directLineFlags = getDirectGitDiffLineFlagsEffect(tr);
      if (directLineFlags !== undefined) {
        const lineFlags = mapLineFlags(tr.state.field(gitDiffLineFlagsField, false), options.mapLineFlag);
        return buildLiveGitGutterMarkersFromLineFlags(
          tr.state,
          lineFlags,
          true
        );
      }

      const baselineChanged = hasGitBaselineEffect(tr);
      const forceRefresh = hasGitDiffRefreshEffect(tr);
      if (baselineChanged && !forceRefresh && hasDeferredGitDiffLineFlagRefreshEffect(tr)) {
        return value;
      }
      if (
        tr.docChanged
        && !baselineChanged
        && !forceRefresh
        && (isCompositionInputTransaction(tr) || shouldDeferGitDiffLineFlagDocChange(tr))
      ) {
        return typeof value?.map === 'function' ? value.map(tr.changes) : value;
      }
      if (!tr.docChanged && !baselineChanged && !forceRefresh) {
        return value;
      }
      const lineFlags = mapLineFlags(tr.state.field(gitDiffLineFlagsField, false), options.mapLineFlag);
      return buildLiveGitGutterMarkersFromLineFlags(tr.state, lineFlags, true);
    }
  });
}

function gitDiffGutterLiveExtension(options: GitDiffGutterRenderOptions = {}, liveGutterField?: StateField<any>) {
  return gutter({
    class: 'meo-git-gutter',
    renderEmptyElements: true,
    initialSpacer() {
      return spacerMarker;
    },
    markers(view: EditorView) {
      const lineFlags = mapLineFlags(view.state.field(gitDiffLineFlagsField, false), options.mapLineFlag);
      return liveGutterField
        ? view.state.field(liveGutterField, false) ?? buildLiveGitGutterMarkersFromLineFlags(view.state, lineFlags, true)
        : buildLiveGitGutterMarkersFromLineFlags(view.state, lineFlags, true);
    },
    widgetMarker(view: EditorView, widget: any, block: any) {
      return liveWidgetMarkerAtPos(
        view.state,
        view.state.field(gitDiffLineFlagsField, false),
        widget,
        block.from,
        options.mapLineFlag,
        options.mapWidgetLineFlag,
        block
      );
    }
  });
}

function liveWidgetMarkerAtPos(
  state: EditorState,
  lineFlags: (MarkerFlags | undefined)[] | null,
  widget: any,
  pos: number,
  mapLineFlag?: (flags: MarkerFlags) => MarkerFlags,
  mapWidgetLineFlag?: GitDiffGutterRenderOptions['mapWidgetLineFlag'],
  block?: any
) {
  if (widget?.isMeoLiveInlineDiffWidget === true) {
    return null;
  }

  const flags = liveMarkerFlagsAtPos(state, lineFlags, pos, true) ?? undefined;
  if (typeof mapWidgetLineFlag === 'function') {
    const widgetFlags = mapWidgetLineFlag(flags, { block, pos, state, widget });
    const lineNo = state.doc.lineAt(Math.max(0, Math.min(pos, state.doc.length))).number;
    if (widgetFlags === null) {
      return null;
    }
    if (widgetFlags) {
      return gitMarker(inheritGitHunkMetadata(widgetFlags, flags, lineNo));
    }
  }

  if (!flags) {
    return null;
  }
  const mappedFlags = typeof mapLineFlag === 'function' ? mapLineFlag(flags) : flags;
  const lineNo = state.doc.lineAt(Math.max(0, Math.min(pos, state.doc.length))).number;
  return gitMarker(inheritGitHunkMetadata(mappedFlags, flags, lineNo));
}

function isGitGutterChangedMarkerElement(marker: unknown): marker is HTMLElement {
  return marker instanceof HTMLElement && (
    marker.classList.contains('is-added') ||
    marker.classList.contains('is-modified') ||
    marker.classList.contains('is-deleted') ||
    marker.classList.contains('is-removed')
  );
}

function cssAttributeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function encodeMarkerHunkMetadata(value: GitGutterHunkMetadata | null): string | null {
  if (!value?.hunkId) {
    return null;
  }
  return JSON.stringify({
    d: value.diffHunkId,
    e: value.hunkEndLine,
    i: value.hunkId,
    s: value.hunkStartLine
  });
}

function decodeMarkerHunkMetadata(value: string | null | undefined): GitGutterHunkMetadata | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed.i !== 'string' || !parsed.i) {
      return null;
    }
    return {
      diffHunkId: typeof parsed.d === 'string' && parsed.d ? parsed.d : undefined,
      hunkEndLine: Number.isInteger(parsed.e) ? parsed.e : undefined,
      hunkId: parsed.i,
      hunkStartLine: Number.isInteger(parsed.s) ? parsed.s : undefined
    };
  } catch {
    return null;
  }
}

function parseIntegerDatasetValue(value: string | null | undefined): number | undefined {
  if (typeof value !== 'string' || !value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function uniqueMarkers(markers: Iterable<HTMLElement>): HTMLElement[] {
  const result: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  for (const marker of markers) {
    if (!isGitGutterChangedMarkerElement(marker) || seen.has(marker)) {
      continue;
    }
    seen.add(marker);
    result.push(marker);
  }
  return result;
}

function gitGutterKindDatasetKey(kind: GitGutterChangeKind): 'meoGitHunkAdded' | 'meoGitHunkDeleted' | 'meoGitHunkModified' {
  if (kind === 'deleted') {
    return 'meoGitHunkDeleted';
  }
  if (kind === 'modified') {
    return 'meoGitHunkModified';
  }
  return 'meoGitHunkAdded';
}

export function getGitGutterMarkerHunkMetadata(
  marker: HTMLElement | null | undefined,
  kind: GitGutterChangeKind | null = null
): GitGutterHunkMetadata | null {
  if (!isGitGutterChangedMarkerElement(marker)) {
    return null;
  }
  if (kind) {
    const metadata = decodeMarkerHunkMetadata(marker.dataset[gitGutterKindDatasetKey(kind)]);
    if (metadata) {
      return metadata;
    }
    if (
      (kind === 'added' && !marker.classList.contains('is-added')) ||
      (kind === 'modified' && !marker.classList.contains('is-modified')) ||
      (kind === 'deleted' && !marker.classList.contains('is-deleted'))
    ) {
      return null;
    }
  }
  const hunkId = marker.dataset.meoGitHunkId;
  return typeof hunkId === 'string' && hunkId
    ? {
        diffHunkId: typeof marker.dataset.meoGitDiffHunkId === 'string' && marker.dataset.meoGitDiffHunkId
          ? marker.dataset.meoGitDiffHunkId
          : undefined,
        hunkEndLine: parseIntegerDatasetValue(marker.dataset.meoGitHunkEndLine),
        hunkId,
        hunkStartLine: parseIntegerDatasetValue(marker.dataset.meoGitHunkStartLine)
      }
    : null;
}

export function getGitGutterHunkMarkers(
  marker: HTMLElement | null | undefined,
  kind: GitGutterChangeKind | null = null
): HTMLElement[] {
  if (!isGitGutterChangedMarkerElement(marker)) {
    return [];
  }

  const gutter = marker.closest('.cm-gutter.meo-git-gutter');
  if (!(gutter instanceof HTMLElement)) {
    return [marker];
  }

  const hunkId = getGitGutterMarkerHunkMetadata(marker, kind)?.hunkId ?? marker.dataset.meoGitHunkId;
  if (typeof hunkId === 'string' && hunkId) {
    const markerCandidates = new Set<HTMLElement>();
    if (!kind) {
      const legacySelector = `.meo-git-gutter-marker[data-meo-git-hunk-id="${cssAttributeString(hunkId)}"]`;
      for (const candidate of gutter.querySelectorAll<HTMLElement>(legacySelector)) {
        markerCandidates.add(candidate);
      }
    } else {
      for (const candidate of gutter.querySelectorAll<HTMLElement>('.meo-git-gutter-marker')) {
        if (getGitGutterMarkerHunkMetadata(candidate, kind)?.hunkId === hunkId) {
          markerCandidates.add(candidate);
        }
      }
    }
    const markers = uniqueMarkers(markerCandidates);
    return markers.length ? markers : [marker];
  }

  const liveBlockStartLine = marker.dataset.meoLiveBlockStartLine;
  const liveBlockEndLine = marker.dataset.meoLiveBlockEndLine;
  if (liveBlockStartLine && liveBlockEndLine) {
    const selector = (
      `.meo-git-gutter-marker[data-meo-live-block-start-line="${cssAttributeString(liveBlockStartLine)}"]` +
      `[data-meo-live-block-end-line="${cssAttributeString(liveBlockEndLine)}"]`
    );
    const markers = uniqueMarkers(gutter.querySelectorAll<HTMLElement>(selector));
    return markers.length ? markers : [marker];
  }

  return [marker];
}

export function getGitGutterMarkerChangeKind(marker: unknown): 'added' | 'deleted' | 'modified' | null {
  if (!(marker instanceof HTMLElement)) {
    return null;
  }
  if (marker.classList.contains('is-deleted') && !marker.classList.contains('is-added') && !marker.classList.contains('is-modified')) {
    return 'deleted';
  }
  if (marker.classList.contains('is-added')) {
    return 'added';
  }
  if (marker.classList.contains('is-modified')) {
    return 'modified';
  }
  if (marker.classList.contains('is-deleted')) {
    return 'deleted';
  }
  return null;
}

function markerHasDeletedChange(marker: HTMLElement | null | undefined): boolean {
  return marker instanceof HTMLElement && marker.classList.contains('is-deleted');
}

function markerHasLineChange(marker: HTMLElement | null | undefined): boolean {
  return marker instanceof HTMLElement && (
    marker.classList.contains('is-added') ||
    marker.classList.contains('is-modified')
  );
}

function isDeletedBoundaryHit(marker: HTMLElement | null | undefined, clientY: number | null = null): boolean {
  if (!markerHasDeletedChange(marker)) {
    return false;
  }
  if (
    marker.classList.contains('is-hit-hover-deleted') ||
    marker.classList.contains('is-hunk-hover-deleted')
  ) {
    return true;
  }
  if (!Number.isFinite(clientY)) {
    return !markerHasLineChange(marker);
  }
  const rect = marker.getBoundingClientRect();
  return clientY >= rect.bottom - 8 && clientY <= rect.bottom + 8;
}

export function getGitGutterMarkerChangeKindAt(marker: unknown, clientY: number | null = null): 'added' | 'deleted' | 'modified' | null {
  if (isDeletedBoundaryHit(marker, clientY)) {
    return 'deleted';
  }
  if (
    marker instanceof HTMLElement &&
    Number.isFinite(clientY) &&
    markerHasDeletedChange(marker) &&
    !markerHasLineChange(marker)
  ) {
    return null;
  }
  return getGitGutterMarkerChangeKind(marker);
}

function addGitHunkHoverClasses(marker: HTMLElement, hoverKind: 'added' | 'deleted' | 'modified' | null = null): void {
  marker.classList.add('is-hunk-hover');
  const kind = hoverKind ?? getGitGutterMarkerChangeKind(marker);
  if (kind) {
    marker.classList.add(`is-hunk-hover-${kind}`);
  }
}

function removeGitHunkHoverClasses(marker: HTMLElement): void {
  marker.classList.remove('is-hunk-hover');
  marker.classList.remove('is-hunk-hover-added', 'is-hunk-hover-deleted', 'is-hunk-hover-modified');
}

function getHoveredGitGutterMarker(event: MouseEvent): HTMLElement | null {
  const targetElement = event.target instanceof Element ? event.target : null;
  const target = targetElement
    ? targetElement.closest('.meo-git-gutter-marker')
    : null;
  if (target instanceof HTMLElement && target.closest('.cm-gutter.meo-git-gutter')) {
    return target;
  }
  if (!targetElement?.closest('.cm-gutter.meo-git-gutter')) {
    return null;
  }

  const stack = typeof document.elementsFromPoint === 'function'
    ? document.elementsFromPoint(event.clientX, event.clientY)
    : [document.elementFromPoint(event.clientX, event.clientY)];
  for (const hit of stack) {
    if (!(hit instanceof Element)) {
      continue;
    }
    const marker = hit.closest('.meo-git-gutter-marker');
    if (marker instanceof HTMLElement && marker.closest('.cm-gutter.meo-git-gutter')) {
      return marker;
    }
  }

  return null;
}

const gitDiffGutterHunkHoverExtension = ViewPlugin.fromClass(class {
  activeMarkers: HTMLElement[] = [];
  activeHoverKind: 'added' | 'deleted' | 'modified' | null = null;
  view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
  }

  update() {
    if (this.activeMarkers.some((marker) => !marker.isConnected)) {
      this.clear();
    }
  }

  clear() {
    if (!this.activeMarkers.length) {
      return;
    }
    for (const marker of this.activeMarkers) {
      removeGitHunkHoverClasses(marker);
    }
    this.activeMarkers = [];
    this.activeHoverKind = null;
  }

  syncFromMarker(marker: HTMLElement | null, hoverKind: 'added' | 'deleted' | 'modified' | null = null) {
    const nextMarkers = marker ? getGitGutterHunkMarkers(marker, hoverKind) : [];
    if (
      hoverKind === this.activeHoverKind &&
      nextMarkers.length === this.activeMarkers.length &&
      nextMarkers.every((nextMarker, index) => nextMarker === this.activeMarkers[index])
    ) {
      return;
    }

    this.clear();
    this.activeMarkers = nextMarkers;
    this.activeHoverKind = hoverKind;
    for (const nextMarker of this.activeMarkers) {
      addGitHunkHoverClasses(nextMarker, hoverKind);
    }
  }

  destroy() {
    this.clear();
  }
}, {
  eventHandlers: {
    mousemove(event, view) {
      const plugin = view.plugin(gitDiffGutterHunkHoverExtension);
      const marker = getHoveredGitGutterMarker(event);
      const hoverKind = marker ? getGitGutterMarkerChangeKindAt(marker, event.clientY) : null;
      plugin?.syncFromMarker(marker, hoverKind);
    },
    mouseleave(_event, view) {
      view.plugin(gitDiffGutterHunkHoverExtension)?.clear();
    }
  }
});

export function gitDiffGutterBaselineExtensions(options: GitDiffGutterBaselineOptions = {}): any[] {
  return options.deferDocChanges
    ? [gitBaselineField, gitDiffLineFlagsField, deferGitDiffLineFlagDocChangesFacet.of(true)]
    : [gitBaselineField, gitDiffLineFlagsField];
}

export function gitDiffGutterRenderExtensions(): any[] {
  return [gitDiffGutterField, gitDiffGutterExtension, gitDiffGutterHunkHoverExtension];
}

export function gitDiffGutterLiveRenderExtensions(options: GitDiffGutterRenderOptions = {}): any[] {
  const liveGutterField = createGitDiffLiveGutterField(options);
  return [liveGutterField, gitDiffGutterLiveExtension(options, liveGutterField), gitDiffGutterHunkHoverExtension];
}

export const __gitDiffGutterTestHooks = {
  addGitHunkHoverClasses,
  addGitHunkMetadataToLineFlags,
  deferGitDiffLineFlagsRefreshEffect,
  getGitGutterHunkMarkers,
  getGitGutterMarkerChangeKindAt,
  getGitGutterMarkerHunkMetadata,
  liveCollapsedBlockMarkerAtPos,
  liveWidgetMarkerAtPos,
  removeGitHunkHoverClasses,
  setGitDiffLineFlagsEffect
};
