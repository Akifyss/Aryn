import {
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  defaultRangeExtractor,
  useVirtualizer,
} from '@tanstack/react-virtual'
import { TreeList } from './tree'

const DEFAULT_INITIAL_VIEWPORT_HEIGHT = 640
const DEFAULT_INITIAL_VIEWPORT_WIDTH = 320
const DEFAULT_OVERSCAN = 8
const DEFAULT_IS_ROW_FOCUSABLE = () => true
const DEFAULT_FOCUS_TARGET_SELECTOR = '.app-item-main:is(button, [role="button"]), .raw-rename-input'
const useIsomorphicLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect

export const DEFAULT_TREE_ROW_SIZE = 34
export const DESCRIBED_TREE_ROW_SIZE = 50

type KeyedTreeRow = {
  key: string
}

export type VirtualizedTreeRowAriaMetadata = {
  level: number
  positionInSet: number
  setSize: number
}

export type VirtualizedTreeListProps<Row extends KeyedTreeRow> = {
  activeRowKey?: string | null
  ariaBusy?: boolean
  ariaLabel: string
  estimateRowSize: (row: Row) => number
  focusTargetSelector?: string
  getRowAriaMetadata?: (row: Row) => VirtualizedTreeRowAriaMetadata | undefined
  getRowClassName?: (row: Row) => string | undefined
  getRowDepth?: (row: Row) => number
  getRowStyle?: (row: Row) => CSSProperties | undefined
  guideOffset?: number
  indentSize?: number
  initialViewportHeight?: number
  initialViewportWidth?: number
  isRowFocusable?: (row: Row) => boolean
  itemClassName?: string
  listClassName?: string
  listId?: string
  listProps?: Omit<
    HTMLAttributes<HTMLUListElement>,
    'children' | 'className' | 'id' | 'onKeyDown' | 'style'
  >
  onListKeyDown?: (event: ReactKeyboardEvent<HTMLUListElement>) => void
  overscan?: number
  pinnedRowKeys?: ReadonlySet<string>
  renderRow: (row: Row) => ReactNode
  rows: readonly Row[]
  scrollElementRef: RefObject<HTMLDivElement | null>
}

export function VirtualizedTreeList<Row extends KeyedTreeRow>({
  activeRowKey,
  ariaBusy,
  ariaLabel,
  estimateRowSize,
  focusTargetSelector = DEFAULT_FOCUS_TARGET_SELECTOR,
  getRowAriaMetadata,
  getRowClassName,
  getRowDepth,
  getRowStyle,
  guideOffset = 16,
  indentSize = 22,
  initialViewportHeight = DEFAULT_INITIAL_VIEWPORT_HEIGHT,
  initialViewportWidth = DEFAULT_INITIAL_VIEWPORT_WIDTH,
  isRowFocusable = DEFAULT_IS_ROW_FOCUSABLE,
  itemClassName,
  listClassName,
  listId,
  listProps,
  onListKeyDown,
  overscan = DEFAULT_OVERSCAN,
  pinnedRowKeys,
  renderRow,
  rows,
  scrollElementRef,
}: VirtualizedTreeListProps<Row>) {
  const listRef = useRef<HTMLUListElement | null>(null)
  const pendingFocusIndexRef = useRef<number | null>(null)
  const revealedActiveRowKeyRef = useRef<string | null>(null)
  // Lists may live below headers or sibling virtual sections while sharing
  // one viewport. TanStack uses this absolute offset to compute their range.
  const [scrollMargin, setScrollMargin] = useState(0)
  // Keep rows that own transient UI mounted even if scrolling moves them
  // outside the normal overscan window (rename, menus, dialogs, drag source).
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
  const getItemKey = useCallback(
    (index: number) => rows[index]?.key ?? index,
    [rows],
  )
  const virtualizer = useVirtualizer({
    count: rows.length,
    directDomUpdates: true,
    directDomUpdatesMode: 'transform',
    estimateSize: (index) => {
      const row = rows[index]
      return row ? estimateRowSize(row) : 0
    },
    getItemKey,
    getScrollElement: () => scrollElementRef.current,
    initialRect: {
      height: initialViewportHeight,
      width: initialViewportWidth,
    },
    overscan,
    rangeExtractor,
    scrollMargin,
  })
  const activeRowIndex = useMemo(() => (
    activeRowKey ? rows.findIndex((row) => row.key === activeRowKey) : -1
  ), [activeRowKey, rows])
  const virtualRows = virtualizer.getVirtualItems()

  const updateScrollMargin = useCallback(() => {
    const listElement = listRef.current
    const scrollElement = scrollElementRef.current
    if (!listElement || !scrollElement) return

    const nextScrollMargin = (
      listElement.getBoundingClientRect().top
      - scrollElement.getBoundingClientRect().top
      + scrollElement.scrollTop
    )
    setScrollMargin((currentScrollMargin) => (
      Math.abs(currentScrollMargin - nextScrollMargin) < 0.5
        ? currentScrollMargin
        : nextScrollMargin
    ))
  }, [scrollElementRef])

  useIsomorphicLayoutEffect(updateScrollMargin)

  useIsomorphicLayoutEffect(() => {
    updateScrollMargin()
    if (typeof ResizeObserver === 'undefined') return

    const listElement = listRef.current
    const scrollElement = scrollElementRef.current
    if (!listElement || !scrollElement) return

    const resizeObserver = new ResizeObserver(updateScrollMargin)
    resizeObserver.observe(scrollElement)
    // A sibling section can change this list's offset without resizing the
    // list itself, so observe the shared content box as well.
    const scrollContent = scrollElement.firstElementChild
    if (scrollContent instanceof HTMLElement) resizeObserver.observe(scrollContent)
    if (listElement.parentElement) resizeObserver.observe(listElement.parentElement)

    return () => resizeObserver.disconnect()
  }, [scrollElementRef, updateScrollMargin])

  useEffect(() => {
    if (!activeRowKey) {
      revealedActiveRowKeyRef.current = null
      return
    }
    if (
      revealedActiveRowKeyRef.current === activeRowKey
      || activeRowIndex < 0
      || !scrollElementRef.current
    ) {
      return
    }

    // Reveal a new selection once. Reordering the same key later must not
    // fight a user's manual scrolling.
    virtualizer.scrollToIndex(activeRowIndex, { align: 'auto' })
    revealedActiveRowKeyRef.current = activeRowKey
  }, [activeRowIndex, activeRowKey, scrollElementRef, virtualizer])

  const focusRow = useCallback((rowIndex: number) => {
    virtualizer.scrollToIndex(rowIndex, { align: 'auto' })
    const focusTarget = listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${rowIndex}"]`)
      ?.querySelector<HTMLElement>(focusTargetSelector)

    if (focusTarget) {
      pendingFocusIndexRef.current = null
      focusTarget.focus({ preventScroll: true })
    } else {
      pendingFocusIndexRef.current = rowIndex
    }
  }, [focusTargetSelector, virtualizer])

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
      ?.querySelector<HTMLElement>(focusTargetSelector)
      ?.focus({ preventScroll: true })
  }, [focusTargetSelector, virtualRows])

  const handleListKeyDown = useCallback((event: ReactKeyboardEvent<HTMLUListElement>) => {
    onListKeyDown?.(event)
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    if (!(event.target instanceof HTMLElement)) return
    if (event.target.matches('input, textarea, select, [contenteditable="true"]')) return

    const currentRow = event.target.closest<HTMLElement>('.tree-virtual-item')
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
  }, [focusRow, isRowFocusable, onListKeyDown, rows])

  const setListElement = useCallback((element: HTMLUListElement | null) => {
    listRef.current = element
    virtualizer.containerRef(element)
  }, [virtualizer])
  return (
    <TreeList
      {...listProps}
      ref={setListElement}
      id={listId}
      className={`tree-virtual-list${listClassName ? ` ${listClassName}` : ''}`}
      aria-busy={ariaBusy || undefined}
      aria-label={ariaLabel}
      role={listProps?.role ?? 'tree'}
      onKeyDown={handleListKeyDown}
    >
      {virtualRows.map((virtualRow) => {
        const row = rows[virtualRow.index]
        if (!row) return null

        const ariaMetadata = getRowAriaMetadata?.(row)
        const depth = Math.max(0, getRowDepth?.(row) ?? 0)
        const rowClassName = getRowClassName?.(row)
        const rowStyle = getRowStyle?.(row)

        return (
          <li
            key={virtualRow.key}
            ref={virtualizer.measureElement}
            aria-level={ariaMetadata?.level}
            aria-posinset={ariaMetadata?.positionInSet ?? virtualRow.index + 1}
            aria-setsize={ariaMetadata?.setSize ?? rows.length}
            role='treeitem'
            className={[
              'tree-virtual-item',
              itemClassName,
              rowClassName,
            ].filter(Boolean).join(' ')}
            data-index={virtualRow.index}
            data-row-key={row.key}
            style={{
              ...rowStyle,
              paddingLeft: depth > 0 ? depth * indentSize : rowStyle?.paddingLeft,
            }}
          >
            {depth > 0 ? (
              <span className='tree-virtual-indent-guides' aria-hidden='true'>
                {Array.from({ length: depth }, (_, guideIndex) => (
                  <span
                    key={guideIndex}
                    style={{ left: guideOffset + guideIndex * indentSize }}
                  />
                ))}
              </span>
            ) : null}
            {renderRow(row)}
          </li>
        )
      })}
    </TreeList>
  )
}
