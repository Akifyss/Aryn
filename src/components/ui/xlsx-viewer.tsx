import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import * as XLSX from 'xlsx'
import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area'

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

function ScrollArea({
  children,
  className,
  orientation = 'vertical',
  viewportClassName,
}: {
  children: ReactNode
  className?: string
  orientation?: 'horizontal' | 'vertical'
  viewportClassName?: string
}) {
  return (
    <BaseScrollArea.Root className={cn('relative min-h-0 overflow-hidden', className)}>
      <BaseScrollArea.Viewport className={cn('size-full overscroll-contain', viewportClassName)}>
        {children}
      </BaseScrollArea.Viewport>
      <BaseScrollArea.Scrollbar
        className={cn(
          'flex touch-none select-none p-0.5',
          orientation === 'vertical' ? 'h-full w-2.5 flex-col' : 'h-2.5 flex-col',
        )}
        orientation={orientation}
      >
        <BaseScrollArea.Thumb className='relative flex-1 rounded-full bg-[var(--scrollbar)] hover:bg-[var(--scrollbar-hover)]' />
      </BaseScrollArea.Scrollbar>
    </BaseScrollArea.Root>
  )
}

type XlsxViewerPreviewProps = {
  className?: string
  fileName?: string
  isDark?: boolean
  leadingToolbarActions?: ReactNode
  onIsDarkChange?: Dispatch<SetStateAction<boolean>>
  showToolbar?: boolean
  showUpload?: boolean
  src: string
  toolbarActions?: ReactNode
}

type ViewerState =
  | { status: 'error' }
  | { status: 'loading' }
  | { status: 'ready'; workbook: XLSX.WorkBook }

type SheetGrid = {
  columnLabels: string[]
  isColumnLimited: boolean
  isRowLimited: boolean
  rows: string[][]
  totalColumnCount: number
  totalRowCount: number
}

const MAX_RENDERED_COLUMNS = 80
const MAX_RENDERED_ROWS = 500
const THUMBNAIL_COLUMNS = 6
const THUMBNAIL_ROWS = 12

type XlsxThumbnailOptions = {
  maxHeight?: number
  maxWidth?: number
  pixelRatio?: number
}

type XlsxSheetThumbnailOptions = XlsxThumbnailOptions & {
  cacheKey?: string
  sheetIndex?: number
}

const XLSX_THUMBNAIL_WORKBOOK_CACHE_LIMIT = 4
const xlsxThumbnailWorkbookCache = new Map<string, Promise<XLSX.WorkBook>>()

function formatCell(cell: XLSX.CellObject | undefined) {
  if (!cell) {
    return ''
  }

  if (cell.w !== undefined) {
    return String(cell.w)
  }

  if (cell.v === undefined || cell.v === null) {
    return ''
  }

  return String(cell.v)
}

function getSheetGrid(
  sheet: XLSX.WorkSheet | undefined,
  limits: { maxColumns?: number; maxRows?: number } = {},
): SheetGrid {
  const fallbackGrid: SheetGrid = {
    columnLabels: [],
    isColumnLimited: false,
    isRowLimited: false,
    rows: [],
    totalColumnCount: 0,
    totalRowCount: 0,
  }

  if (!sheet?.['!ref']) {
    return fallbackGrid
  }

  const range = XLSX.utils.decode_range(sheet['!ref'])
  const totalColumnCount = range.e.c - range.s.c + 1
  const totalRowCount = range.e.r - range.s.r + 1
  const renderedColumnCount = Math.min(totalColumnCount, limits.maxColumns ?? MAX_RENDERED_COLUMNS)
  const renderedRowCount = Math.min(totalRowCount, limits.maxRows ?? MAX_RENDERED_ROWS)
  const columnLabels = Array.from({ length: renderedColumnCount }, (_, index) => (
    XLSX.utils.encode_col(range.s.c + index)
  ))
  const rows = Array.from({ length: renderedRowCount }, (_, rowIndex) => {
    const row = range.s.r + rowIndex

    return Array.from({ length: renderedColumnCount }, (_, columnIndex) => {
      const column = range.s.c + columnIndex
      const address = XLSX.utils.encode_cell({ c: column, r: row })
      return formatCell(sheet[address])
    })
  })

  return {
    columnLabels,
    isColumnLimited: renderedColumnCount < totalColumnCount,
    isRowLimited: renderedRowCount < totalRowCount,
    rows,
    totalColumnCount,
    totalRowCount,
  }
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const resolvedRadius = Math.min(radius, width / 2, height / 2)

  context.beginPath()
  context.moveTo(x + resolvedRadius, y)
  context.lineTo(x + width - resolvedRadius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + resolvedRadius)
  context.lineTo(x + width, y + height - resolvedRadius)
  context.quadraticCurveTo(x + width, y + height, x + width - resolvedRadius, y + height)
  context.lineTo(x + resolvedRadius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - resolvedRadius)
  context.lineTo(x, y + resolvedRadius)
  context.quadraticCurveTo(x, y, x + resolvedRadius, y)
  context.closePath()
}

function drawClippedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  const normalizedText = text.replace(/\s+/g, ' ').trim()

  if (!normalizedText) {
    return
  }

  if (context.measureText(normalizedText).width <= maxWidth) {
    context.fillText(normalizedText, x, y)
    return
  }

  let clippedText = normalizedText

  while (clippedText.length > 1 && context.measureText(`${clippedText}...`).width > maxWidth) {
    clippedText = clippedText.slice(0, -1)
  }

  context.fillText(`${clippedText}...`, x, y)
}

function resolveXlsxSheet(workbook: XLSX.WorkBook, requestedSheetIndex = 0) {
  const sheetCount = Math.max(workbook.SheetNames.length, 1)
  const sheetIndex = Math.max(
    0,
    Math.min(Math.trunc(requestedSheetIndex), sheetCount - 1),
  )
  const sheetName = workbook.SheetNames[sheetIndex]

  return {
    sheet: sheetName ? workbook.Sheets[sheetName] : undefined,
    sheetCount,
    sheetIndex,
    sheetName,
  }
}

async function loadXlsxWorkbook(src: string, cacheKey?: string) {
  const cachedWorkbook = cacheKey ? xlsxThumbnailWorkbookCache.get(cacheKey) : null

  if (cachedWorkbook) {
    return cachedWorkbook
  }

  const workbookPromise = (async () => {
    const response = await fetch(src)

    if (!response.ok) {
      throw new Error(`Unable to load spreadsheet: ${response.status}`)
    }

    const data = await response.arrayBuffer()

    return XLSX.read(data, {
      cellDates: true,
      cellNF: false,
      cellStyles: false,
      type: 'array',
    })
  })()

  if (cacheKey) {
    xlsxThumbnailWorkbookCache.set(cacheKey, workbookPromise)
    if (xlsxThumbnailWorkbookCache.size > XLSX_THUMBNAIL_WORKBOOK_CACHE_LIMIT) {
      const oldestKey = xlsxThumbnailWorkbookCache.keys().next().value

      if (oldestKey) {
        xlsxThumbnailWorkbookCache.delete(oldestKey)
      }
    }
    void workbookPromise.catch(() => {
      if (xlsxThumbnailWorkbookCache.get(cacheKey) === workbookPromise) {
        xlsxThumbnailWorkbookCache.delete(cacheKey)
      }
    })
  }

  return workbookPromise
}

function renderXlsxSheetThumbnail(
  workbook: XLSX.WorkBook,
  options: XlsxSheetThumbnailOptions = {},
) {
  const { sheet, sheetCount, sheetName } = resolveXlsxSheet(workbook, options.sheetIndex)
  const grid = getSheetGrid(sheet, {
    maxColumns: THUMBNAIL_COLUMNS,
    maxRows: THUMBNAIL_ROWS,
  })
  const cssWidth = options.maxWidth ?? 360
  const cssHeight = options.maxHeight ?? 260
  const pixelRatio = Math.max(1, Math.min(options.pixelRatio ?? window.devicePixelRatio ?? 1, 2))
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to create spreadsheet thumbnail.')
  }

  canvas.width = Math.ceil(cssWidth * pixelRatio)
  canvas.height = Math.ceil(cssHeight * pixelRatio)
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`
  context.scale(pixelRatio, pixelRatio)

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, cssWidth, cssHeight)
  context.fillStyle = '#f4f6f8'
  roundRect(context, 10, 10, cssWidth - 20, cssHeight - 20, 10)
  context.fill()

  const tableX = 18
  const tableY = 32
  const rowHeaderWidth = 30
  const headerHeight = 24
  const availableWidth = cssWidth - tableX * 2
  const availableHeight = cssHeight - tableY - 20
  const columnCount = Math.max(grid.columnLabels.length, 1)
  const rowCount = Math.max(grid.rows.length, 1)
  const columnWidth = Math.max(42, (availableWidth - rowHeaderWidth) / columnCount)
  const rowHeight = Math.max(18, Math.min(24, (availableHeight - headerHeight) / rowCount))
  const tableWidth = rowHeaderWidth + columnWidth * columnCount
  const tableHeight = headerHeight + rowHeight * rowCount

  context.save()
  roundRect(context, tableX, tableY, Math.min(tableWidth, availableWidth), Math.min(tableHeight, availableHeight), 6)
  context.clip()
  context.fillStyle = '#ffffff'
  context.fillRect(tableX, tableY, tableWidth, tableHeight)
  context.fillStyle = '#eef2f7'
  context.fillRect(tableX, tableY, tableWidth, headerHeight)
  context.fillRect(tableX, tableY, rowHeaderWidth, tableHeight)
  context.strokeStyle = '#d8dee8'
  context.lineWidth = 1

  for (let columnIndex = 0; columnIndex <= columnCount; columnIndex += 1) {
    const x = tableX + rowHeaderWidth + columnIndex * columnWidth
    context.beginPath()
    context.moveTo(x, tableY)
    context.lineTo(x, tableY + tableHeight)
    context.stroke()
  }

  for (let rowIndex = 0; rowIndex <= rowCount; rowIndex += 1) {
    const y = tableY + headerHeight + rowIndex * rowHeight
    context.beginPath()
    context.moveTo(tableX, y)
    context.lineTo(tableX + tableWidth, y)
    context.stroke()
  }

  context.font = '600 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  context.fillStyle = '#647084'
  grid.columnLabels.forEach((label, index) => {
    context.fillText(label, tableX + rowHeaderWidth + index * columnWidth + 8, tableY + 16)
  })

  context.font = '500 10px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    context.fillText(String(rowIndex + 1), tableX + 9, tableY + headerHeight + rowIndex * rowHeight + 13)
  }

  context.font = '11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  context.fillStyle = '#172033'

  if (grid.rows.length > 0) {
    grid.rows.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        drawClippedText(
          context,
          cell,
          tableX + rowHeaderWidth + columnIndex * columnWidth + 8,
          tableY + headerHeight + rowIndex * rowHeight + 13,
          columnWidth - 14,
        )
      })
    })
  } else {
    context.fillStyle = '#7b8494'
    context.font = '500 14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    context.fillText('空工作表', tableX + rowHeaderWidth + 12, tableY + headerHeight + 28)
  }

  context.restore()

  if (sheetName) {
    context.fillStyle = '#1f2937'
    context.font = '600 12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    drawClippedText(context, sheetName, tableX, 22, cssWidth - tableX * 2)
  }

  return {
    pageCount: sheetCount,
    url: canvas.toDataURL('image/png'),
  }
}

export async function renderXlsxSheetToDataUrlWithSheetCount(
  src: string,
  options: XlsxSheetThumbnailOptions = {},
) {
  const workbook = await loadXlsxWorkbook(src, options.cacheKey)

  return renderXlsxSheetThumbnail(workbook, options)
}

export async function renderXlsxFirstSheetToDataUrl(
  src: string,
  options: XlsxThumbnailOptions = {},
) {
  const { url } = await renderXlsxSheetToDataUrlWithSheetCount(src, {
    ...options,
    sheetIndex: 0,
  })

  return url
}

export const __xlsxViewerTestHooks = {
  getSheetGrid,
  renderXlsxSheetThumbnail,
  resolveXlsxSheet,
}

export function XlsxViewerPreview({
  className,
  fileName,
  isDark: _isDark,
  leadingToolbarActions,
  onIsDarkChange: _onIsDarkChange,
  showToolbar = false,
  showUpload: _showUpload,
  src,
  toolbarActions,
}: XlsxViewerPreviewProps) {
  const [viewerState, setViewerState] = useState<ViewerState>({ status: 'loading' })
  const [activeSheetName, setActiveSheetName] = useState<string | null>(null)

  useEffect(() => {
    const abortController = new AbortController()
    let isCurrent = true

    setViewerState({ status: 'loading' })
    setActiveSheetName(null)

    async function loadWorkbook() {
      try {
        const response = await fetch(src, { signal: abortController.signal })

        if (!response.ok) {
          throw new Error(`Unable to load spreadsheet: ${response.status}`)
        }

        const data = await response.arrayBuffer()
        const workbook = XLSX.read(data, {
          cellDates: true,
          cellNF: false,
          cellStyles: false,
          type: 'array',
        })

        if (!isCurrent) {
          return
        }

        setViewerState({ status: 'ready', workbook })
        setActiveSheetName(workbook.SheetNames[0] ?? null)
      } catch {
        if (!isCurrent || abortController.signal.aborted) {
          return
        }

        setViewerState({ status: 'error' })
      }
    }

    void loadWorkbook()

    return () => {
      isCurrent = false
      abortController.abort()
    }
  }, [src])

  const workbook = viewerState.status === 'ready' ? viewerState.workbook : null
  const sheetNames = workbook?.SheetNames ?? []
  const resolvedActiveSheetName = activeSheetName && sheetNames.includes(activeSheetName)
    ? activeSheetName
    : sheetNames[0] ?? null
  const grid = useMemo(
    () => getSheetGrid(resolvedActiveSheetName ? workbook?.Sheets[resolvedActiveSheetName] : undefined),
    [resolvedActiveSheetName, workbook],
  )
  const hasToolbar = showToolbar || Boolean(leadingToolbarActions) || Boolean(toolbarActions)

  return (
    <div className={cn('flex min-h-0 flex-col bg-[var(--background-primary)] text-[var(--foreground-primary)]', className)}>
      {hasToolbar ? (
        <div className='viewer-toolbar'>
          {leadingToolbarActions ? <div className='viewer-toolbar-leading'>{leadingToolbarActions}</div> : null}
          <div className='viewer-toolbar-title'>{fileName ?? '电子表格'}</div>
          {toolbarActions ? <div className='viewer-toolbar-actions'>{toolbarActions}</div> : null}
        </div>
      ) : null}
      {workbook && sheetNames.length > 1 ? (
        <div className='viewer-toolbar-subbar'>
          <label className='viewer-toolbar-label' htmlFor='xlsx-viewer-sheet'>
            工作表
          </label>
          <select
            id='xlsx-viewer-sheet'
            className='viewer-toolbar-select'
            value={resolvedActiveSheetName ?? ''}
            onChange={(event) => setActiveSheetName(event.target.value)}
          >
            {sheetNames.map((sheetName) => (
              <option key={sheetName} value={sheetName}>
                {sheetName}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {viewerState.status === 'loading' ? (
        <div className='grid min-h-0 flex-1 place-items-center bg-[var(--background-primary)] text-sm text-[var(--foreground-secondary)]'>
          正在加载表格...
        </div>
      ) : null}
      {viewerState.status === 'error' ? (
        <div className='grid min-h-0 flex-1 place-items-center bg-[var(--background-primary)] text-sm text-[var(--foreground-secondary)]'>
          无法预览此表格。
        </div>
      ) : null}
      {viewerState.status === 'ready' ? (
        grid.rows.length > 0 ? (
          <ScrollArea
            orientation='horizontal'
            className='min-h-0 flex-1 bg-[var(--background-primary)]'
            viewportClassName='overscroll-x-contain'
          >
            <div className='h-full min-w-max'>
              <ScrollArea orientation='vertical' className='h-full min-w-max'>
                <div className='p-3'>
                  <table className='border-collapse bg-[var(--background-primary)] text-xs shadow-sm'>
                    <thead>
                      <tr>
                        <th className='sticky left-0 top-0 z-20 h-7 min-w-12 border bg-[var(--background-tertiary)] px-2 text-right font-medium text-[var(--foreground-secondary)]' />
                        {grid.columnLabels.map((columnLabel) => (
                          <th
                            key={columnLabel}
                            className='sticky top-0 z-10 h-7 min-w-24 border bg-[var(--background-tertiary)] px-2 text-left font-medium text-[var(--foreground-secondary)]'
                          >
                            {columnLabel}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {grid.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          <th className='sticky left-0 z-10 h-7 border bg-[var(--background-tertiary)] px-2 text-right font-medium text-[var(--foreground-secondary)]'>
                            {rowIndex + 1}
                          </th>
                          {row.map((cell, columnIndex) => (
                            <td
                              key={`${rowIndex}:${columnIndex}`}
                              className='h-7 max-w-72 border px-2 align-middle text-[var(--foreground-primary)]'
                            >
                              <div className='truncate'>{cell}</div>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {grid.isRowLimited || grid.isColumnLimited ? (
                    <div className='px-1 py-2 text-xs text-[var(--foreground-secondary)]'>
                      Showing {grid.rows.length} of {grid.totalRowCount} rows and {grid.columnLabels.length} of {grid.totalColumnCount} columns.
                    </div>
                  ) : null}
                </div>
              </ScrollArea>
            </div>
          </ScrollArea>
        ) : (
          <div className='grid min-h-0 flex-1 place-items-center bg-[var(--background-primary)] text-sm text-[var(--foreground-secondary)]'>
            This sheet is empty.
          </div>
        )
      ) : null}
    </div>
  )
}
