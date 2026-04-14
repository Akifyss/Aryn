import type { WorkspaceNode } from '@/features/workspace/types'

export type ComposerMentionToken = {
  end: number
  id: string
  kind: WorkspaceNode['kind']
  label: string
  path: string
  start: number
  text: string
}

export type ComposerMentionItem = {
  absolutePath: string
  displayName: string
  displayPath: string | null
  id: string
  kind: WorkspaceNode['kind']
  name: string
  relativePath: string
  searchSegments: string[]
  searchValue: string
}

export type ActiveComposerMentionQuery = {
  end: number
  query: string
  start: number
}

export type ComposerSelectionRange = {
  end: number
  start: number
}

export type ComposerEditResult = {
  mentions: ComposerMentionToken[]
  nextSelectionEnd: number
  nextSelectionStart: number
  value: string
}

const MENTION_TRIGGER_PATTERN = /(^|[\s([{'"`])@([^\s@[\](){}]*)$/

function normalizePathSlashes(value: string) {
  return value.replace(/[\\/]+/g, '/')
}

function normalizeSearchValue(value: string) {
  return normalizePathSlashes(value).toLowerCase()
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function getParentDisplayPath(relativePath: string) {
  const normalizedPath = trimTrailingSlash(relativePath)
  const lastSlashIndex = normalizedPath.lastIndexOf('/')

  if (lastSlashIndex <= 0) {
    return null
  }

  return normalizedPath.slice(0, lastSlashIndex)
}

function shiftMention(mention: ComposerMentionToken, delta: number) {
  return {
    ...mention,
    end: mention.end + delta,
    start: mention.start + delta,
  }
}

export function toWorkspaceRelativePath(workspacePath: string, targetPath: string) {
  const normalizedWorkspacePath = trimTrailingSlash(normalizePathSlashes(workspacePath))
  const normalizedTargetPath = trimTrailingSlash(normalizePathSlashes(targetPath))

  if (!normalizedWorkspacePath) {
    return normalizedTargetPath
  }

  if (normalizedTargetPath === normalizedWorkspacePath) {
    return ''
  }

  if (normalizedTargetPath.startsWith(`${normalizedWorkspacePath}/`)) {
    return normalizedTargetPath.slice(normalizedWorkspacePath.length + 1)
  }

  return normalizedTargetPath
}

export function flattenWorkspaceNodesForMentions(
  nodes: WorkspaceNode[],
  workspacePath: string,
): ComposerMentionItem[] {
  const items: ComposerMentionItem[] = []

  function visit(currentNodes: WorkspaceNode[]) {
    for (const node of currentNodes) {
      const relativePath = toWorkspaceRelativePath(workspacePath, node.path)
      const displayName = node.name
      const displayPath = getParentDisplayPath(relativePath)
      const normalizedRelativePath = normalizeSearchValue(relativePath)
      const normalizedName = normalizeSearchValue(node.name)
      const normalizedDisplayName = normalizeSearchValue(displayName)
      const searchSegments = normalizedRelativePath
        .split('/')
        .flatMap((segment) => segment.split(/\s+/))
        .filter(Boolean)

      items.push({
        absolutePath: node.path,
        displayName,
        displayPath,
        id: `${node.kind}:${relativePath}`,
        kind: node.kind,
        name: node.name,
        relativePath,
        searchSegments,
        searchValue: `${normalizedName}\n${normalizedDisplayName}\n${normalizedRelativePath}\n${normalizeSearchValue(displayPath ?? '')}`,
      })

      if (node.children?.length) {
        visit(node.children)
      }
    }
  }

  visit(nodes)
  return items
}

function getMentionItemScore(item: ComposerMentionItem, query: string) {
  if (!query) {
    return item.kind === 'directory' ? 10 : 0
  }

  const normalizedQuery = normalizeSearchValue(query)
  const normalizedRelativePath = normalizeSearchValue(item.relativePath)
  const normalizedName = normalizeSearchValue(item.name)
  const normalizedDisplayName = normalizeSearchValue(item.displayName)
  const queryTerms = normalizedQuery.split(/[/\s]+/).filter(Boolean)

  let score = 0
  let didMatch = false

  if (
    normalizedName === normalizedQuery
    || normalizedDisplayName === normalizedQuery
    || normalizedRelativePath === normalizedQuery
  ) {
    score += 1_000
    didMatch = true
  }

  if (normalizedName.startsWith(normalizedQuery) || normalizedDisplayName.startsWith(normalizedQuery)) {
    score += 600
    didMatch = true
  } else if (normalizedName.includes(normalizedQuery) || normalizedDisplayName.includes(normalizedQuery)) {
    score += 420
    didMatch = true
  }

  if (normalizedRelativePath.startsWith(normalizedQuery)) {
    score += 480
    didMatch = true
  } else if (normalizedRelativePath.includes(normalizedQuery)) {
    score += 320
    didMatch = true
  }

  const matchingSegmentIndex = item.searchSegments.findIndex((segment) => segment.startsWith(normalizedQuery))
  if (matchingSegmentIndex >= 0) {
    score += 360 - Math.min(matchingSegmentIndex, 24)
    didMatch = true
  }

  if (
    queryTerms.length > 1
    && queryTerms.every((term) => term.length > 0 && item.searchValue.includes(term))
  ) {
    score += 240
    didMatch = true
  }

  if (didMatch && item.kind === 'directory') {
    score += 8
  }

  return score
}

export function searchComposerMentionItems(
  items: ComposerMentionItem[],
  query: string,
  limit = 100,
) {
  const normalizedQuery = normalizeSearchValue(query).trim()

  const rankedItems = items
    .map((item, index) => ({
      index,
      item,
      score: getMentionItemScore(item, normalizedQuery),
    }))
    .filter(({ item, score }) => (
      !normalizedQuery
      || score > 0
      || item.searchValue.includes(normalizedQuery)
    ))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score
      }

      if (left.item.kind !== right.item.kind) {
        return left.item.kind === 'directory' ? -1 : 1
      }

      return left.index - right.index
    })

  return rankedItems.slice(0, limit).map(({ item }) => item)
}

export function createComposerMentionToken(
  item: ComposerMentionItem,
  start = 0,
): ComposerMentionToken {
  const text = item.displayName
  return {
    end: start + text.length,
    id: item.id,
    kind: item.kind,
    label: item.displayName,
    path: item.relativePath,
    start,
    text,
  }
}

export function serializeComposerMention(mention: ComposerMentionToken) {
  return `[${mention.label}](${mention.path})`
}

export function serializeComposerText(value: string, mentions: ComposerMentionToken[]) {
  const normalizedMentions = [...mentions].sort((left, right) => left.start - right.start)
  let cursor = 0
  let result = ''

  for (const mention of normalizedMentions) {
    result += value.slice(cursor, mention.start)
    result += serializeComposerMention(mention)
    cursor = mention.end
  }

  result += value.slice(cursor)
  return result
}

export function normalizeComposerMentions(
  value: string,
  mentions: ComposerMentionToken[],
) {
  const normalizedMentions: ComposerMentionToken[] = []

  for (const mention of [...mentions].sort((left, right) => left.start - right.start)) {
    if (
      mention.start < 0
      || mention.end > value.length
      || mention.start >= mention.end
      || value.slice(mention.start, mention.end) !== mention.text
    ) {
      continue
    }

    normalizedMentions.push(mention)
  }

  return normalizedMentions
}

export function parseComposerMentionRanges(value: string, mentions: ComposerMentionToken[]) {
  return normalizeComposerMentions(value, mentions)
}

function findMentionRangeAtPosition(ranges: ComposerMentionToken[], position: number) {
  return ranges.find((range) => position > range.start && position < range.end) ?? null
}

function getMentionIndicesWithinSelection(
  selection: ComposerSelectionRange,
  ranges: ComposerMentionToken[],
) {
  return ranges
    .map((range, index) => ({ index, range }))
    .filter(({ range }) => selection.start < range.end && selection.end > range.start)
    .map(({ index }) => index)
}

export function normalizeComposerSelection(
  selection: ComposerSelectionRange,
  ranges: ComposerMentionToken[],
): ComposerSelectionRange {
  if (selection.start !== selection.end) {
    return selection
  }

  const matchingRange = findMentionRangeAtPosition(ranges, selection.start)
  if (!matchingRange) {
    return selection
  }

  const distanceToStart = selection.start - matchingRange.start
  const distanceToEnd = matchingRange.end - selection.start
  const nextPosition = distanceToStart <= distanceToEnd ? matchingRange.start : matchingRange.end

  return {
    end: nextPosition,
    start: nextPosition,
  }
}

export function expandComposerSelectionToMentionBoundaries(
  selection: ComposerSelectionRange,
  ranges: ComposerMentionToken[],
): ComposerSelectionRange {
  let nextStart = selection.start
  let nextEnd = selection.end

  for (const range of ranges) {
    if (nextStart > range.start && nextStart < range.end) {
      nextStart = range.start
    }

    if (nextEnd > range.start && nextEnd < range.end) {
      nextEnd = range.end
    }
  }

  return {
    end: nextEnd,
    start: nextStart,
  }
}

export function getComposerDeleteRange(
  selection: ComposerSelectionRange,
  ranges: ComposerMentionToken[],
  direction: 'backward' | 'forward',
): ComposerSelectionRange | null {
  if (selection.start !== selection.end) {
    const expandedSelection = expandComposerSelectionToMentionBoundaries(selection, ranges)
    return expandedSelection.start === expandedSelection.end ? null : expandedSelection
  }

  const caretPosition = selection.start

  if (direction === 'backward') {
    const matchingRange = ranges.find((range) => (
      range.end === caretPosition || (caretPosition > range.start && caretPosition < range.end)
    ))
    return matchingRange
      ? { end: matchingRange.end, start: matchingRange.start }
      : null
  }

  const matchingRange = ranges.find((range) => (
    range.start === caretPosition || (caretPosition > range.start && caretPosition < range.end)
  ))
  return matchingRange
    ? { end: matchingRange.end, start: matchingRange.start }
    : null
}

export function applyComposerTextEdit({
  insertText = '',
  mentions,
  selection,
  value,
}: {
  insertText?: string
  mentions: ComposerMentionToken[]
  selection: ComposerSelectionRange
  value: string
}): ComposerEditResult {
  const mentionRanges = parseComposerMentionRanges(value, mentions)
  const expandedSelection = selection.start === selection.end
    ? selection
    : expandComposerSelectionToMentionBoundaries(selection, mentionRanges)
  const removedIndices = new Set(getMentionIndicesWithinSelection(expandedSelection, mentionRanges))
  const before = value.slice(0, expandedSelection.start)
  const after = value.slice(expandedSelection.end)
  const nextValue = `${before}${insertText}${after}`
  const delta = insertText.length - (expandedSelection.end - expandedSelection.start)
  const nextSelectionStart = before.length + insertText.length
  const nextMentions = mentionRanges
    .filter((_, index) => !removedIndices.has(index))
    .map((mention) => {
      if (mention.end <= expandedSelection.start) {
        return mention
      }

      if (mention.start >= expandedSelection.end) {
        return shiftMention(mention, delta)
      }

      return mention
    })

  return {
    mentions: nextMentions,
    nextSelectionEnd: nextSelectionStart,
    nextSelectionStart,
    value: nextValue,
  }
}

export function replaceComposerMentionQuery({
  item,
  mentions,
  target,
  value,
}: {
  item: ComposerMentionItem
  mentions: ComposerMentionToken[]
  target: ActiveComposerMentionQuery
  value: string
}): ComposerEditResult {
  const before = value.slice(0, target.start)
  const after = value.slice(target.end)
  const mention = createComposerMentionToken(item, before.length)
  const insertedText = mention.text
  const nextValue = `${before}${insertedText}${after}`
  const delta = insertedText.length - (target.end - target.start)
  const nextMentions = [
    ...mentions
      .filter((existingMention) => existingMention.end <= target.start)
      .map((existingMention) => existingMention),
    mention,
    ...mentions
      .filter((existingMention) => existingMention.start >= target.end)
      .map((existingMention) => shiftMention(existingMention, delta)),
  ].sort((left, right) => left.start - right.start)
  const nextSelectionStart = before.length + insertedText.length

  return {
    mentions: nextMentions,
    nextSelectionEnd: nextSelectionStart,
    nextSelectionStart,
    value: nextValue,
  }
}

export function findActiveComposerMentionQuery(
  value: string,
  selection: ComposerSelectionRange,
  ranges: ComposerMentionToken[],
): ActiveComposerMentionQuery | null {
  if (selection.start !== selection.end) {
    return null
  }

  const normalizedSelection = normalizeComposerSelection(selection, ranges)
  if (normalizedSelection.start !== selection.start) {
    return null
  }

  const prefix = value.slice(0, selection.start)
  const match = prefix.match(MENTION_TRIGGER_PATTERN)

  if (!match) {
    return null
  }

  const query = match[2] ?? ''
  const start = prefix.length - query.length - 1
  const end = selection.start

  return {
    end,
    query,
    start,
  }
}
