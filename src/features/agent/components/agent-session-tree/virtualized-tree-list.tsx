import { type ReactNode, useRef } from 'react'
import {
  DEFAULT_TREE_ROW_SIZE,
  TreeScrollArea,
  VirtualizedTreeList,
  type VirtualizedTreeRowAriaMetadata,
} from '@/components/tree'

const AGENT_TREE_DOCKED_INITIAL_VIEWPORT_HEIGHT = 640
const AGENT_TREE_FLOATING_INITIAL_VIEWPORT_HEIGHT = 320

export const DEFAULT_AGENT_TREE_ROW_SIZE = DEFAULT_TREE_ROW_SIZE
export type { VirtualizedTreeRowAriaMetadata }

type KeyedTreeRow = {
  key: string
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
  isRowFocusable,
  listClassName,
  listId,
  pinnedRowKeys,
  renderRow,
  rows,
  scrollClassName,
  viewportClassName,
}: VirtualizedAgentTreeListProps<Row>) {
  const viewportRef = useRef<HTMLDivElement | null>(null)

  return (
    <TreeScrollArea
      className={scrollClassName}
      contentClassName={contentClassName}
      viewportClassName={viewportClassName}
      viewportRef={viewportRef}
    >
      <VirtualizedTreeList
        activeRowKey={activeRowKey}
        ariaBusy={ariaBusy}
        ariaLabel={ariaLabel}
        estimateRowSize={estimateRowSize}
        getRowAriaMetadata={getRowAriaMetadata}
        getRowClassName={getRowClassName}
        initialViewportHeight={isFloating
          ? AGENT_TREE_FLOATING_INITIAL_VIEWPORT_HEIGHT
          : AGENT_TREE_DOCKED_INITIAL_VIEWPORT_HEIGHT}
        isRowFocusable={isRowFocusable}
        itemClassName='agent-session-virtual-item'
        listClassName={`agent-session-virtual-list${listClassName ? ` ${listClassName}` : ''}`}
        listId={listId}
        pinnedRowKeys={pinnedRowKeys}
        renderRow={renderRow}
        rows={rows}
        scrollElementRef={viewportRef}
      />
    </TreeScrollArea>
  )
}
