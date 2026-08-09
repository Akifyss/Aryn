import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import {
  defaultRangeExtractor,
  useVirtualizer,
} from '@tanstack/react-virtual'
import {
  TreeList,
  TreeScrollArea,
} from '@/components/tree'

// Pre-observation estimates only; the real ScrollArea viewport replaces them after mount.
const AGENT_TREE_DOCKED_INITIAL_VIEWPORT_HEIGHT = 640
const AGENT_TREE_FLOATING_INITIAL_VIEWPORT_HEIGHT = 320
const AGENT_TREE_INITIAL_VIEWPORT_WIDTH = 320
const AGENT_TREE_OVERSCAN = 8
const DEFAULT_IS_ROW_FOCUSABLE = () => true
const TREE_ROW_FOCUS_TARGET_SELECTOR = '.app-item-main:is(button, [role="button"]), .raw-rename-input'

// AppItem's 32px row plus the shared 2px tree-list gap. Runtime measurement
// corrects this estimate whenever a rendered row has a different height.
export const DEFAULT_AGENT_TREE_ROW_SIZE = 34

type KeyedTreeRow = {
  key: string
}

export type VirtualizedTreeRowAriaMetadata = {
  level: number
  positionInSet: number
  setSize: number
}

type VirtualizedAgentTreeListProps<Row extends KeyedTreeRow> = {
  activeRowKey?: string | null
  ariaBusy?: boolean
  ariaLabel: string
  contentClassName?: string
  estimateRowSize: (row: Row) => number
  getRowClassName?: (row: Row) => string | undefined
  getRowAriaMetadata?: (row: Row) => VirtualizedTreeRowAriaMetadata | undefined
  isFloating: boolean
  isRowFocusable?: (row: Row) => boolean
  listClassName?: string
  listId?: string
  pinnedRowKeys?: ReadonlySet<string>
  renderRow: (row: Row) => ReactNode
  rows: readonly Row[]
  scrollClassName?: string
  viewportClassName?: string
}

export function VirtualizedAgentTreeList<Row extends KeyedTreeRow>({
  activeRowKey,
  ariaBusy,
  ariaLabel,
  contentClassName,
  estimateRowSize,
  getRowClassName,
  getRowAriaMetadata,
  isFloating,
  isRowFocusable = DEFAULT_IS_ROW_FOCUSABLE,
  listClassName,
  listId,
  pinnedRowKeys,
  renderRow,
  rows,
  scrollClassName,
  viewportClassName,
}: VirtualizedAgentTreeListProps<Row>) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const pendingFocusIndexRef = useRef<number | null>(null)
  const pinnedRowIndexes = useMemo(() => {
    if (!pinnedRowKeys?.size) return []

    const rowIndexByKey = new Map(rows.map((row, index) => [row.key, index]))
    return Array.from(pinnedRowKeys)
      .flatMap((rowKey) => {
        const rowIndex = rowIndexByKey.get(rowKey)
        return rowIndex === undefined ? [] : [rowIndex]
      })
      .sort((left, right) => left - right)
  }, [pinnedRowKeys, rows])
  const rangeExtractor = useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) => {
    if (pinnedRowIndexes.length === 0) return defaultRangeExtractor(range)

    return Array.from(new Set([
      ...defaultRangeExtractor(range),
      ...pinnedRowIndexes,
    ])).sort((left, right) => left - right)
  }, [pinnedRowIndexes])
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: (index) => {
      const row = rows[index]
      return row ? estimateRowSize(row) : 0
    },
    getItemKey: (index) => rows[index]?.key ?? index,
    getScrollElement: () => viewportRef.current,
    initialRect: {
      height: isFloating
        ? AGENT_TREE_FLOATING_INITIAL_VIEWPORT_HEIGHT
        : AGENT_TREE_DOCKED_INITIAL_VIEWPORT_HEIGHT,
      width: AGENT_TREE_INITIAL_VIEWPORT_WIDTH,
    },
    overscan: AGENT_TREE_OVERSCAN,
    rangeExtractor,
  })
  const activeRowIndex = useMemo(() => (
    activeRowKey ? rows.findIndex((row) => row.key === activeRowKey) : -1
  ), [activeRowKey, rows])
  const virtualRows = virtualizer.getVirtualItems()

  useEffect(() => {
    if (activeRowIndex < 0 || !viewportRef.current) return
    virtualizer.scrollToIndex(activeRowIndex, { align: 'auto' })
  }, [activeRowIndex, virtualizer])

  const focusRow = useCallback((rowIndex: number) => {
    virtualizer.scrollToIndex(rowIndex, { align: 'auto' })
    const focusTarget = listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${rowIndex}"]`)
      ?.querySelector<HTMLElement>(TREE_ROW_FOCUS_TARGET_SELECTOR)

    if (focusTarget) {
      pendingFocusIndexRef.current = null
      focusTarget.focus({ preventScroll: true })
    } else {
      pendingFocusIndexRef.current = rowIndex
    }
  }, [virtualizer])

  useEffect(() => {
    const pendingFocusIndex = pendingFocusIndexRef.current
    if (
      pendingFocusIndex === null
      || !virtualRows.some((virtualRow) => virtualRow.index === pendingFocusIndex)
    ) {
      return
    }

    pendingFocusIndexRef.current = null
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${pendingFocusIndex}"]`)
      ?.querySelector<HTMLElement>(TREE_ROW_FOCUS_TARGET_SELECTOR)
      ?.focus({ preventScroll: true })
  }, [virtualRows])

  const handleListKeyDown = useCallback((event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    if (!(event.target instanceof HTMLElement)) return
    if (event.target.matches('input, textarea, select, [contenteditable="true"]')) return

    const currentRow = event.target.closest<HTMLElement>('.agent-session-virtual-item')
    const primaryAction = currentRow?.querySelector<HTMLElement>(
      '.app-item-main:is(button, [role="button"])',
    )
    if (!currentRow || !primaryAction?.contains(event.target)) return

    const currentIndex = Number(currentRow.dataset.index)
    if (!Number.isInteger(currentIndex)) return

    const findFocusableRow = (startIndex: number, step: 1 | -1) => {
      for (
        let rowIndex = startIndex;
        rowIndex >= 0 && rowIndex < rows.length;
        rowIndex += step
      ) {
        const row = rows[rowIndex]
        if (row && isRowFocusable(row)) return rowIndex
      }

      return null
    }
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') {
      nextIndex = findFocusableRow(currentIndex + 1, 1)
    } else if (event.key === 'ArrowUp') {
      nextIndex = findFocusableRow(currentIndex - 1, -1)
    } else if (event.key === 'Home') {
      nextIndex = findFocusableRow(0, 1)
    } else if (event.key === 'End') {
      nextIndex = findFocusableRow(rows.length - 1, -1)
    }

    if (nextIndex === null || nextIndex === currentIndex) return

    event.preventDefault()
    focusRow(nextIndex)
  }, [focusRow, isRowFocusable, rows])

  return (
    <TreeScrollArea
      className={scrollClassName}
      contentClassName={contentClassName}
      viewportClassName={viewportClassName}
      viewportRef={viewportRef}
    >
      <TreeList
        ref={listRef}
        id={listId}
        className={`agent-session-virtual-list${listClassName ? ` ${listClassName}` : ''}`}
        aria-busy={ariaBusy || undefined}
        aria-label={ariaLabel}
        onKeyDown={handleListKeyDown}
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index]
          if (!row) return null

          const rowClassName = getRowClassName?.(row)
          const ariaMetadata = getRowAriaMetadata?.(row)

          return (
            <li
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              aria-level={ariaMetadata?.level}
              aria-posinset={ariaMetadata?.positionInSet ?? virtualRow.index + 1}
              aria-setsize={ariaMetadata?.setSize ?? rows.length}
              className={`agent-session-virtual-item${rowClassName ? ` ${rowClassName}` : ''}`}
              data-index={virtualRow.index}
              data-row-key={row.key}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {renderRow(row)}
            </li>
          )
        })}
      </TreeList>
    </TreeScrollArea>
  )
}
