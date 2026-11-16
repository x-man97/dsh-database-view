/**
 * One table's data in its own right Sidebar tab, IDEA style: a WHERE box, an
 * ORDER BY box, a result grid, and a pager under it.
 *
 * Double-clicking a table in the data tree opens this page with the table's
 * coordinates as navigation parameters. The first read opens the connection when
 * it is closed; a restored tab carries no parameters, so it reports that the
 * table has to be opened again instead of guessing.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { CellValue, ClientConnection, ColumnDetail, ColumnInfo, QueryResult, Row, SqlDialect, TableDescription } from '../shared/types'
import { ApiError, api } from './api'
import { DataGrid, type CellMenuTarget } from './DataGrid'
import { MenuGroupList, type MenuGroupSpec } from './menugroups'
import { formatCell, formatCount, formatMs } from './format'
import { ArrowUpIcon, CopyIcon, DatabaseIcon, DownloadIcon, UndoIcon, EyeUpIcon, FilterIcon, MinusIcon, PlayIcon, PlusIcon, RefreshIcon, TableIcon, TerminalIcon, UploadIcon } from './icons'
import { downloadText, exportFilename, renderExport, toCsv, toJson, toMarkdown, toTsv, type ExportFormat } from './export'
import { openConsoleTab, openTableTab, readTableTabParams, type TableTabParams } from './tab-open'
import { columnValues, commaValues, copyText, type ColumnMenuItem } from './colmenu'
import { cellCopyText, rowToTsv } from './cellmenu'
import { columnSignature, identityOrder, moveColumn, orderColumns, orderRows } from './columnOrder'
import { hideColumns, onlyColumn, pruneHidden, readHidden, toggleHidden, writeHidden } from './columnhide'
import { collectRows } from './pagedrows'
import { nextOrderBy, parseOrderBy, quoteSortColumn, stripOrderBy } from './sorting'
import { cellWhere, composeWhere, groupCountSql, inListOf, insertStatement, insertStatements, orderByForPaging, pageClause, qualifiedName, columnNames, selectColumnsSql, stripWhere, tableSelectSql, type ColumnFilter, type ColumnFilters } from './tablesql'
import { usePopoverDismiss } from './popover'
import { shortcutHit, shortcutLabel } from './keymap'
import { Banner, Button, EmptyState, Loading, Modal, Spinner, Tag } from './ui'
import { CellValueModal } from './CellValueModal'
import { DdlModal } from './DdlModal'
import { cellValueView, type CellValueView } from './cellvalue'
import { tableDumpText } from './tabledump'
import { SqlHighlight } from './sqlhighlight'
import { SqlFilterInput } from './SqlFilterInput'
import { useI18n } from './i18n'
import { deleteRowSql, insertRowSql, updateRowSql, whereForRow, DEFAULT_VALUE, type RowValue } from './rowedit'
import { DataImportModal } from './DataImportModal'
import { CopyToDatabaseModal } from './CopyToDatabaseModal'
import { summarizeRange, type GridRange } from './gridrange'

/** What the tab body receives: the framework's tab reader. */
export interface TableTabProps {
  useTabInfo?: () => { tab?: { navigation?: { params?: unknown } } } | undefined
}

interface Failure {
  message: string
  detail?: string
}

import { TABLE_PAGE_KEY, readPageSize, writePageSize } from './pagesize'
import { readAllowedNumber, readFlag, readText, writeFlag, writeNumber, writeText } from './prefs'

const PAGE_SIZES = [100, 200, 500, 1000, 2000, 5000]
const AUTO_REFRESH_KEY = 'dsh-database-view.auto-refresh.v1'
const FILTERS_OPEN_KEY = 'dsh-database-view.table.filters-open.v1'
const ORDER_KEY = 'dsh-database-view.table-order.v1'
const AUTO_REFRESH_OPTIONS = [0, 5000, 10000, 30000] as const

const noTabInfo = (): undefined => undefined

function failureText(error: unknown): Failure {
  if (error instanceof ApiError) return { message: error.message, ...(error.detail ? { detail: error.detail } : {}) }
  return { message: error instanceof Error ? error.message : String(error) }
}

/** What a failed reload or query copies out, matching what the banner shows. */
function failureMessage(error: Failure): string {
  return error.detail === undefined ? error.message : error.message + '\n' + error.detail
}

/**
 * A column filter: `like` is the text typed into the filter row, `eq` is an
 * exact value picked from a cell, `isnull` comes from clicking a NULL cell.
 */
async function runSql(id: string, sql: string, maxRows: number): Promise<QueryResult> {
  try {
    return await api.query({ id, sql, maxRows })
  } catch (error) {
    // A tab opened from a cold app has no live connection yet; open it once.
    if (error instanceof ApiError && error.code === 'not-connected') {
      await api.connect(id)
      return await api.query({ id, sql, maxRows })
    }
    throw error
  }
}

function PagerButton({
  label,
  title,
  onClick,
  disabled,
}: {
  label: string
  title: string
  onClick: () => void
  disabled: boolean
}): ReactElement {
  return (
    <button type="button" className="dshdb-pager-btn" title={title} aria-label={title} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  )
}

function TableGrid({ params }: { params: TableTabParams }): ReactElement {
  const t = useI18n()
  const [connection, setConnection] = useState<ClientConnection | null>(null)
  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState<number | undefined>(undefined)
  /** Counting is optional (permissions, timeouts); say so instead of a bare empty total. */
  const [countUnknown, setCountUnknown] = useState(false)
  const [elapsed, setElapsed] = useState<number | undefined>(undefined)
  const [sqlText, setSqlText] = useState('')
  const [loading, setLoading] = useState(false)
  /** Auto-refresh period in ms; 0 means off. */
  const [autoMs, setAutoMs] = useState(() => readAllowedNumber(AUTO_REFRESH_KEY, AUTO_REFRESH_OPTIONS, 0))
  const [error, setError] = useState<Failure | null>(null)
  const [description, setDescription] = useState<TableDescription | null>(null)
  const [pendingNew, setPendingNew] = useState<Array<Record<string, string>>>([])
  const [pendingUpdates, setPendingUpdates] = useState<Record<number, Record<string, string | typeof DEFAULT_VALUE>>>({})
  const [pendingDeletes, setPendingDeletes] = useState<Set<number>>(new Set())
  const [cellRange, setCellRange] = useState<GridRange | null>(null)
  const [cellEdit, setCellEdit] = useState<{ rowIndex: number; column: string; value: string } | null>(null)
  const [newCell, setNewCell] = useState<{ rowIndex: number; column: string; value: string } | null>(null)
  const [dmlOpen, setDmlOpen] = useState(false)
  const [rowSaving, setRowSaving] = useState(false)
  const [rowError, setRowError] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(() => readPageSize(TABLE_PAGE_KEY, PAGE_SIZES, 500))
  const [pageDraft, setPageDraft] = useState('1')
  const [whereText, setWhereText] = useState(() => params.where ?? '')
  /** Sort order survives closing the tab, the same way column widths do. */
  const orderStorageKey = `${ORDER_KEY}:${params.schema}.${params.table}`
  const [orderText, setOrderText] = useState(() => readText(orderStorageKey))
  const [filters, setFilters] = useState<ColumnFilters>({})
  const [filtersOpen, setFiltersOpen] = useState(() => readFlag(FILTERS_OPEN_KEY, false))
  const [order, setOrder] = useState<number[] | null>(null)
  // The ordering saved with the tab is only applied after the first page tells us
  // which columns exist; a column that was dropped or renamed is simply dropped.
  useEffect(() => {
    if (columns.length === 0 || storedOrderApplied.current) return
    storedOrderApplied.current = true
    const remembered = readText(orderStorageKey)
    if (remembered === '') return
    const parsed = parseOrderBy(stripOrderBy(remembered))
    if (parsed === undefined) return
    if (!columns.some((column) => column.name === parsed.column)) {
      writeText(orderStorageKey, '')
      return
    }
    setOrderText(remembered)
    applyRef.current({ orderBy: remembered, page: 0, recount: false })
  }, [columns, orderStorageKey])
  const [hiddenColumns, setHiddenColumns] = useState<string[] | null>(() => readHidden(`table:${params.schema}.${params.table}`))
  const [cellView, setCellView] = useState<CellValueView | null>(null)
  const objectKind = params.kind === 'view' ? 'view' : 'table'
  const [ddl, setDdl] = useState<{ title: string; text: string; warnings: string[] } | null>(null)
  const [ddlBusy, setDdlBusy] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const exportingRef = useRef(false)
  const [exportNote, setExportNote] = useState('')
  /** Checked rows of the current page (indices into shownRows). */
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => new Set())
  const selectionAnchor = useRef<number | null>(null)
  /** Copy and export notes clear themselves so the footer does not stale. */
  useEffect(() => {
    if (exportNote === '') return undefined
    const timer = setTimeout(() => setExportNote(''), 2500)
    return () => clearTimeout(timer)
  }, [exportNote])
  /** Copies from the export menu and reports it in the bar, like the toolbar copies do. */
  const noteCopied = useCallback(
    (label: string) =>
      (ok: boolean): void => {
        setExportNote(ok ? `${label} 已复制` : '复制失败：这个环境不允许访问剪贴板')
      },
    [],
  )
  const exportCancelled = useRef(false)
  // Leaving the tab should stop walking pages, otherwise the server keeps answering a tab nobody sees.
  useEffect(() => {
    return () => {
      exportCancelled.current = true
    }
  }, [])


  const exportAnchor = useRef<HTMLSpanElement>(null)
  const closeExport = useCallback(() => setExportOpen(false), [])
  usePopoverDismiss(exportOpen, closeExport, exportAnchor)
  const applyRef = useRef<
    (next: { page?: number; size?: number; where?: string; orderBy?: string; recount?: boolean }, override?: ColumnFilters) => void
  >(() => undefined)
  const whereRef = useRef<HTMLInputElement | null>(null)
  /** Latest load wins: an older page must not overwrite a newer one. */
  const loadToken = useRef(0)
  /** Remembers what the last load asked for so the error banner can retry it. */
  const lastLoad = useRef<{
    found: ClientConnection
    target: { page: number; size: number; where: string; orderBy: string; recount: boolean }
  } | null>(null)
  const storedOrderApplied = useRef(false)
  const filterRowRef = useRef<HTMLTableRowElement | null>(null)

  // Column drag order is display-only; reset it when the result set changes shape.
  const signature = columnSignature(columns)
  useEffect(() => {
    setOrder(null)
    setHiddenColumns((current) => pruneHidden(current, columns))
  }, [signature, columns])
  useEffect(() => {
    writeHidden(`table:${params.schema}.${params.table}`, hiddenColumns)
  }, [hiddenColumns, params.schema, params.table])
  const displayColumns = useMemo(() => orderColumns(columns, order), [columns, order])
  const displayRows = useMemo(() => orderRows(rows, order), [rows, order])
  // Hiding only narrows what the grid renders; positions map back for drag order.
  const hiddenView = useMemo(() => hideColumns(displayColumns, displayRows, hiddenColumns), [displayColumns, displayRows, hiddenColumns])
  const shownColumns = hiddenView.columns
  const shownRows = hiddenView.rows
  const hiddenCount = displayColumns.length - shownColumns.length

  // A reload, page change or filter shows different rows; old checkboxes would point nowhere.
  useEffect(() => {
    setSelectedRows(new Set())
    setPendingUpdates({})
    setPendingDeletes(new Set())
    setPendingNew([])
    setCellEdit(null)
    setNewCell(null)
    selectionAnchor.current = null
  }, [rows, page])

  const load = useCallback(
    async (found: ClientConnection, target: { page: number; size: number; where: string; orderBy: string; recount: boolean }): Promise<void> => {
      const token = ++loadToken.current
      lastLoad.current = { found, target }
      setLoading(true)
      setError(null)
      try {
        const dialect = found.dialect
        const from = qualifiedName(dialect, params.schema, params.table)
        const where = stripWhere(target.where)
        const orderBy = stripOrderBy(target.orderBy)
        const whereSql = where === '' ? '' : ` WHERE ${where}`
        const orderSql = orderByForPaging(dialect, orderBy)
        const offset = target.page * target.size
        const pageSql = `SELECT * FROM ${from}${whereSql}${orderSql} ${pageClause(dialect, target.size, offset)}`
        // The total is only a pager label, so it runs alongside the page instead of after it.
        const countPromise = target.recount
          ? runSql(params.connectionId, `SELECT COUNT(*) FROM ${from}${whereSql}`, 1).then(
              (counted) => {
                const first = counted.rows[0]?.[0]
                const value = typeof first === 'number' ? first : Number(first)
                return Number.isFinite(value) ? value : undefined
              },
              () => undefined,
            )
          : undefined
        const result = await runSql(params.connectionId, pageSql, target.size)
        if (token !== loadToken.current) return
        setColumns(result.columns)
        setRows(result.rows)
        setElapsed(result.elapsedMs)
        setSqlText(result.sql === '' ? pageSql : result.sql)
        setPage(target.page)
        if (countPromise !== undefined) {
          // Already running alongside the page query; a failed count just hides the total.
          const counted = await countPromise
          if (token === loadToken.current) {
            setTotal(counted)
            setCountUnknown(counted === undefined)
          }
        }
      } catch (caught) {
        if (token !== loadToken.current) return
        setError(failureText(caught))
      } finally {
        if (token === loadToken.current) setLoading(false)
      }
    },
    [params.connectionId, params.schema, params.table],
  )

  useEffect(() => {
    let cancelled = false
    setConnection(null)
    setRows([])
    setColumns([])
    setTotal(undefined)
    setPage(0)
    setWhereText(params.where ?? '')
    setOrderText('')
    setError(null)
    void (async () => {
      try {
        const status = await api.status()
        const found = status.config.connections.find((item) => item.id === params.connectionId)
        if (found === undefined) throw new ApiError('not-found', '该数据源已不存在，请重新连接后再打开数据表')
        if (found.dialect === 'redis') throw new ApiError('unsupported', '数据表只能在关系型数据源中打开')
        if (cancelled) return
        setConnection(found)
        await load(found, { page: 0, size: pageSize, where: params.where ?? '', orderBy: '', recount: true })
        const described = typeof api.describe === 'function'
          ? await api.describe(found.id, params.schema, params.table, objectKind).catch(() => null)
          : null
        if (!cancelled) setDescription(described)
      } catch (caught) {
        if (!cancelled) setError(failureText(caught))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [load, params.connectionId])

  const offset = page * pageSize
  const activeSort = useMemo(() => parseOrderBy(stripOrderBy(orderText)), [orderText])

  const apply = useCallback(
    (
      next: { page?: number; size?: number; where?: string; orderBy?: string; recount?: boolean },
      override?: ColumnFilters,
    ): void => {
      if (connection === null) return
      const manualWhere = next.where ?? whereText
      const orderBy = next.orderBy ?? orderText
      writeText(orderStorageKey, orderBy)
      void load(connection, {
        page: next.page ?? page,
        size: next.size ?? pageSize,
        where: composeWhere(connection.dialect, manualWhere, columns, override ?? filters),
        orderBy,
        recount: next.recount ?? (next.where !== undefined || next.size !== undefined || next.page === 0),
      })
    },
    [columns, connection, filters, load, orderStorageKey, orderText, page, pageSize, whereText],
  )
  applyRef.current = apply

  const editableColumns = useMemo(() => description?.columns ?? [], [description])
  const keyColumns = editableColumns.filter((column) => column.primaryKey === true)
  const effectiveKey = keyColumns.length > 0 ? keyColumns : editableColumns
  const canMutate =
    connection !== null &&
    connection.readOnly !== true &&
    objectKind === 'table' &&
    description !== null
  const selectedIndex = selectedRows.size === 1 ? [...selectedRows][0] : undefined
  const selectedRow = selectedIndex === undefined ? undefined : displayRows[selectedIndex]

  const rowValue = (column: string, row: Row): CellValue | null => {
    const index = displayColumns.findIndex((entry) => entry.name === column)
    return index < 0 ? null : row[index] ?? null
  }

  const startInsert = (): void => {
    if (!canMutate) return
    const first = editableColumns[0]
    if (first === undefined) return
    setRowError('')
    setNewCell({ rowIndex: pendingNew.length, column: first.name, value: '' })
    setPendingNew((previous) => [...previous, {}])
  }
  const startCellEdit = useCallback((rowIndex: number, column: ColumnInfo): void => {
    if (!canMutate || pendingDeletes.has(rowIndex)) return
    const row = displayRows[rowIndex]
    if (row === undefined) return
    const index = displayColumns.findIndex((entry) => entry.name === column.name)
    const loaded = index < 0 ? null : row[index] ?? null
    const pending = pendingUpdates[rowIndex]?.[column.name]
    const current = pending === DEFAULT_VALUE ? '' : pending ?? loaded
    setRowError('')
    setCellEdit({ rowIndex, column: column.name, value: current === null ? '' : String(current) })
  }, [canMutate, displayColumns, displayRows, pendingDeletes, pendingUpdates])
  const updateCell = (value: string): void => {
    setCellEdit((previous) => (previous === null ? previous : { ...previous, value }))
  }
  const commitCell = (): void => {
    if (cellEdit === null) return
    const { rowIndex, column, value } = cellEdit
    const row = displayRows[rowIndex]
    const original = row === undefined ? null : rowValue(column, row)
    const originalText = original === null ? '' : String(original)
    setPendingUpdates((previous) => {
      const next = { ...previous }
      const rowChanges = { ...(next[rowIndex] ?? {}) }
      if (value === originalText) delete rowChanges[column]
      else rowChanges[column] = value
      if (Object.keys(rowChanges).length === 0) delete next[rowIndex]
      else next[rowIndex] = rowChanges
      return next
    })
    setCellEdit(null)
  }
  const cancelCell = (): void => setCellEdit(null)
  /** Explicit NULL/DEFAULT assignments from the cell menu. */
  const setCellPending = useCallback(
    (rowIndex: number, column: ColumnInfo, value: string | typeof DEFAULT_VALUE): void => {
      if (!canMutate || pendingDeletes.has(rowIndex)) return
      setRowError('')
      setPendingUpdates((previous) => {
        const next = { ...previous }
        next[rowIndex] = { ...(next[rowIndex] ?? {}), [column.name]: value }
        return next
      })
    },
    [canMutate, pendingDeletes],
  )
  /** Copy one row's current values into a pending insert; generated keys stay empty. */
  const duplicateRow = useCallback(
    (rowIndex: number): void => {
      if (!canMutate || rowSaving) return
      const row = displayRows[rowIndex]
      if (row === undefined) return
      const values: Record<string, string> = {}
      for (const column of editableColumns) {
        if (column.primaryKey === true && column.autoIncrement === true) continue
        const index = displayColumns.findIndex((entry) => entry.name === column.name)
        if (index < 0) continue
        const pending = pendingUpdates[rowIndex]?.[column.name]
        const value: CellValue =
          pending === DEFAULT_VALUE ? null : pending === undefined ? (row[index] ?? null) : pending === '' ? null : pending
        if (value === null || value === '') continue
        values[column.name] = String(value)
      }
      const newIndex = pendingNew.length
      setPendingNew((previous) => [...previous, values])
      const firstEmpty = editableColumns.find((column) => values[column.name] === undefined)
      const target = firstEmpty ?? editableColumns[0]
      if (target !== undefined) {
        setNewCell({ rowIndex: newIndex, column: target.name, value: values[target.name] ?? '' })
      }
      setRowError('')
    },
    [canMutate, displayColumns, displayRows, editableColumns, pendingNew.length, pendingUpdates, rowSaving],
  )
  const startNewCell = (rowIndex: number, column: string): void => {
    const value = pendingNew[rowIndex]?.[column] ?? ''
    setNewCell({ rowIndex, column, value })
  }
  const updateNewCell = (value: string): void => {
    setNewCell((previous) => (previous === null ? previous : { ...previous, value }))
  }
  const commitNewCell = (): void => {
    if (newCell === null) return
    const { rowIndex, column, value } = newCell
    setPendingNew((previous) => previous.map((row, index) => index === rowIndex ? { ...row, [column]: value } : row))
    setNewCell(null)
  }
  /** Fill pending edits from a pasted TSV block, clipped to the current page. */
  const pasteRange = useCallback(
    (anchor: { rowIndex: number; columnIndex: number }, text: string): void => {
      if (!canMutate || rowSaving) return
      const lines = text.replace(/\r\n/gu, '\n').replace(/\n$/u, '').split('\n')
      const next: Record<number, Record<string, string | typeof DEFAULT_VALUE>> = { ...pendingUpdates }
      let changed = 0
      for (const [rowOffset, line] of lines.entries()) {
        const rowIndex = anchor.rowIndex + rowOffset
        if (rowIndex >= displayRows.length) break
        if (pendingDeletes.has(rowIndex)) continue
        for (const [columnOffset, cellText] of line.split('\t').entries()) {
          const column = shownColumns[anchor.columnIndex + columnOffset]
          if (column === undefined) continue
          if (!editableColumns.some((entry) => entry.name === column.name)) continue
          next[rowIndex] = { ...(next[rowIndex] ?? {}), [column.name]: cellText }
          changed += 1
        }
      }
      if (changed === 0) return
      setPendingUpdates(next)
      setRowError('')
      setExportNote(t('table.pasted', { n: changed }))
    },
    [canMutate, displayRows.length, editableColumns, pendingDeletes, pendingUpdates, rowSaving, shownColumns, t],
  )

  const cancelNewCell = (): void => setNewCell(null)
  const removeNewRow = (rowIndex: number): void => {
    setNewCell((previous) => (previous?.rowIndex === rowIndex ? null : previous))
    setPendingNew((previous) => previous.filter((_, index) => index !== rowIndex))
  }
  const undoPending = (): void => {
    if (rowSaving) return
    setPendingNew([])
    setPendingUpdates({})
    setPendingDeletes(new Set())
    setCellEdit(null)
    setNewCell(null)
    setRowError('')
    setSelectedRows(new Set())
  }
  const markDelete = (): void => {
    if (!canMutate || selectedRows.size === 0 || rowSaving) return
    setRowError('')
    setCellEdit(null)
    setPendingDeletes((previous) => {
      const allDeleted = [...selectedRows].every((index) => previous.has(index))
      const next = new Set(previous)
      for (const index of selectedRows) {
        if (allDeleted) next.delete(index)
        else next.add(index)
      }
      return next
    })
  }
  const buildDml = (): string[] => {
    if (connection === null) return []
    const dialect = connection.dialect as SqlDialect
    const statements: string[] = []
    for (const index of [...pendingDeletes].sort((a, b) => a - b)) {
      const row = displayRows[index]
      if (row === undefined) continue
      const original = new Map(effectiveKey.map((column) => [column.name, rowValue(column.name, row)]))
      statements.push(`${deleteRowSql(dialect, params.schema, params.table, effectiveKey, original)};`)
    }
    for (const [rawIndex, changes] of Object.entries(pendingUpdates)) {
      const index = Number(rawIndex)
      const row = displayRows[index]
      if (row === undefined || pendingDeletes.has(index)) continue
      const values: RowValue[] = editableColumns
        .filter((column) => changes[column.name] !== undefined)
        .map((column) => {
          const changed = changes[column.name]
          const value: CellValue | null | typeof DEFAULT_VALUE =
            changed === DEFAULT_VALUE ? DEFAULT_VALUE : changed === '' || changed === undefined ? null : changed
          return { column, value }
        })
      if (values.length === 0) continue
      const original = new Map(effectiveKey.map((column) => [column.name, rowValue(column.name, row)]))
      statements.push(`${updateRowSql(dialect, params.schema, params.table, values, effectiveKey, original)};`)
    }
    for (const row of pendingNew) {
      const values = editableColumns
        .filter((column) => row[column.name] !== undefined && row[column.name] !== '')
        .map((column) => ({ column, value: row[column.name] }))
      if (values.length === 0) continue
      statements.push(`${insertRowSql(dialect, params.schema, params.table, values)};`)
    }
    return statements
  }
  const dmlStatements = buildDml()
  const pendingCount = pendingDeletes.size + Object.keys(pendingUpdates).length + pendingNew.filter((row) => Object.values(row).some((value) => value !== '')).length
  const openDml = (): void => {
    if (dmlStatements.length === 0) return
    setRowError('')
    setDmlOpen(true)
  }
  const submitDml = async (): Promise<void> => {
    if (dmlStatements.length === 0) return
    setRowSaving(true)
    setRowError('')
    try {
      for (const sql of dmlStatements) {
        await api.query({ id: params.connectionId, sql, maxRows: 1, allowWrite: true })
      }
      setPendingNew([])
      setPendingUpdates({})
      setPendingDeletes(new Set())
      setCellEdit(null)
      setNewCell(null)
      setDmlOpen(false)
      applyRef.current({ recount: true })
    } catch (caught) {
      setRowError(failureMessage(failureText(caught)))
    } finally {
      setRowSaving(false)
    }
  }

  const orderTextRef = useRef(orderText)
  orderTextRef.current = orderText
  const loadingRef = useRef(loading)
  loadingRef.current = loading

  // Stable grid callbacks: typing into the WHERE / ORDER BY boxes must not
  // repaint the whole result grid on every keystroke.
  const sortTable = useCallback(
    (column: ColumnInfo): void => {
      const dialect = connection?.dialect ?? 'mysql'
      const next = nextOrderBy(stripOrderBy(orderTextRef.current), column.name, quoteSortColumn(dialect, column.name))
      setOrderText(next)
      applyRef.current({ orderBy: next, page: 0 })
    },
    [connection?.dialect],
  )
  const sortBy = useCallback(
    (column: ColumnInfo, direction: 'asc' | 'desc'): void => {
      const dialect = connection?.dialect ?? 'mysql'
      const next = `${quoteSortColumn(dialect, column.name)} ${direction.toUpperCase()}`
      setOrderText(next)
      applyRef.current({ orderBy: next, page: 0 })
    },
    [connection?.dialect],
  )
  const clearSort = useCallback((): void => {
    setOrderText('')
    applyRef.current({ orderBy: '', page: 0 })
  }, [])
  const columnMenu = useCallback(
    (column: ColumnInfo): ColumnMenuItem[] => {
      const active = activeSort?.column === column.name ? activeSort.direction : null
      const index = columns.findIndex((item) => item.name === column.name)
      return [
        { label: t('menu.sortAsc'), disabled: active === 'asc', run: () => sortBy(column, 'asc') },
        { label: t('menu.sortDesc'), disabled: active === 'desc', run: () => sortBy(column, 'desc') },
        { label: t('menu.clearSort'), disabled: activeSort === undefined, run: clearSort },
        { label: `复制列名「${column.name}」`, run: () => void copyText(column.name).then(noteCopied('列名')) },
        {
          label: t('menu.copyColumnValues', { n: rows.length }),
          disabled: rows.length === 0 || index < 0,
          run: () => void copyText(columnValues(rows, index)).then(noteCopied('本列值')),
        },
        {
          label: t('menu.copyIn'),
          disabled: rows.length === 0 || index < 0,
          run: () => void copyText(inListOf(connection?.dialect ?? 'mysql', rows, index)).then(noteCopied('IN 列表')),
        },
        {
          label: t('menu.copyComma'),
          disabled: rows.length === 0 || index < 0,
          run: () => void copyText(commaValues(rows, index)).then(noteCopied('逗号分隔')),
        },
        {
          label: t('menu.copyAllColumns'),
          disabled: displayColumns.length === 0,
          run: () => void copyText(columnNames(connection?.dialect ?? 'mysql', displayColumns)).then(noteCopied('全部列名')),
        },
        {
          label: t('menu.copySelectColumns', { n: displayColumns.length }),
          disabled: displayColumns.length === 0,
          run: () => void copyText(selectColumnsSql(connection?.dialect ?? 'mysql', params.schema, params.table, displayColumns)).then(noteCopied('查询语句')),
        },
        {
          label: t('menu.hideColumn', { name: column.name }),
          disabled: shownColumns.length <= 1,
          run: () => setHiddenColumns((current) => toggleHidden(current, column.name)),
        },
        {
          label: t('menu.onlyColumn'),
          disabled: displayColumns.length <= 1,
          run: () => setHiddenColumns(onlyColumn(displayColumns, column.name)),
        },
        {
          label: hiddenCount === 0 ? '显示全部列' : `显示全部列（已隐藏 ${hiddenCount} 列）`,
          disabled: hiddenCount === 0,
          run: () => setHiddenColumns(null),
        },
      ]
    },
    [activeSort, clearSort, columns, displayColumns, hiddenCount, rows, shownColumns.length, sortBy],
  )
  const gridReorder = useCallback(
    (from: number, to: number): void => {
      const positions = hiddenView.positions
      const source = positions[from] ?? from
      const target = positions[to] ?? to
      setOrder((current) => moveColumn(current ?? identityOrder(displayColumns.length), source, target))
    },
    [displayColumns.length, hiddenView.positions],
  )
  // Auto refresh reuses the current page/filter/sort; a tick is skipped while
  // the previous load is still running so slow queries do not pile up.
  useEffect(() => {
    if (autoMs === 0 || connection === null) return undefined
    const tick = (): void => {
      // An export is already walking the table page by page; refreshing the
      // grid underneath it would only churn the view.
      if (exportingRef.current) return
      if (!loadingRef.current) applyRef.current({ recount: false })
    }
    const timer = setInterval(() => {
      // A hidden tab is not being read: skip the tick so the database is not
      // re-queried while the user is looking at something else.
      if (document.visibilityState !== 'visible') return
      tick()
    }, autoMs)
    // Coming back to the tab should not wait up to a full interval for the
    // first refresh, otherwise the page can look stale for half a minute.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [autoMs, connection])

  const openDdl = useCallback(async (): Promise<void> => {
    if (connection === null) return
    setDdlBusy(true)
    try {
      const result = await api.ddl(params.connectionId, params.schema, params.table, objectKind)
      setDdl({
        title: `${params.schema}.${params.table} 的${objectKind === 'view' ? '视图定义' : '建表语句'}`,
        text: result.ddl,
        warnings: result.warnings,
      })
    } catch (caught) {
      setError(failureText(caught))
    } finally {
      setDdlBusy(false)
    }
  }, [connection, objectKind, params.connectionId, params.schema, params.table])

  const gridCellOpen = useCallback((column: ColumnInfo, value: CellValue): void => {
    setCellView(cellValueView(column.name, value))
  }, [])
  const gridCellClass = useCallback(
    (): string | undefined => (filtersOpen ? 'dshdb-cell-filterable' : undefined),
    [filtersOpen],
  )
  const gridCellMenu = useCallback(
    (cell: CellMenuTarget): ColumnMenuItem[] => {
      const related: ColumnMenuItem[] = []
      const row = displayRows[cell.rowIndex]
      if (connection !== null && row !== undefined) {
        for (const foreignKey of description?.foreignKeys ?? []) {
          if (!foreignKey.columns.includes(cell.column.name) || foreignKey.referencedTable.trim() === '') continue
          if (foreignKey.referencedColumns.length !== foreignKey.columns.length) continue
          const columns: ColumnInfo[] = []
          const values = new Map<string, CellValue | null>()
          let complete = true
          for (const [index, localName] of foreignKey.columns.entries()) {
            const position = displayColumns.findIndex((column) => column.name === localName)
            const referencedName = foreignKey.referencedColumns[index]
            if (position < 0 || referencedName === undefined) {
              complete = false
              break
            }
            const localType = editableColumns.find((column) => column.name === localName)?.typeName ?? ''
            columns.push({ name: referencedName, typeName: localType })
            values.set(referencedName, row[position] ?? null)
          }
          if (!complete) continue
          const targetSchema = foreignKey.referencedSchema.trim() === '' ? params.schema : foreignKey.referencedSchema
          const where = whereForRow(connection.dialect as SqlDialect, columns, values)
          related.push({
            label: t('menu.relatedRows', { name: `${targetSchema}.${foreignKey.referencedTable}` }),
            run: () =>
              openTableTab({
                connectionId: params.connectionId,
                schema: targetSchema,
                table: foreignKey.referencedTable,
                where,
              }),
          })
        }
      }
      return [
            ...(canMutate
              ? [{
                  label: t('menu.edit'),
                  disabled: pendingDeletes.has(cell.rowIndex),
                  run: () => startCellEdit(cell.rowIndex, cell.column),
                }]
              : []),
            ...(canMutate && editableColumns.some((entry) => entry.name === cell.column.name)
              ? [
                  {
                    label: t('menu.setNull'),
                    disabled: pendingDeletes.has(cell.rowIndex),
                    run: () => setCellPending(cell.rowIndex, cell.column, ''),
                  },
                  {
                    label: t('menu.setDefault'),
                    disabled: pendingDeletes.has(cell.rowIndex),
                    run: () => setCellPending(cell.rowIndex, cell.column, DEFAULT_VALUE),
                  },
                  {
                    label: t('menu.duplicateRow'),
                    disabled: rowSaving,
                    run: () => duplicateRow(cell.rowIndex),
                  },
                ]
              : []),
            ...related,
            {
              label: t('menu.viewFull'),
              run: () => setCellView(cellValueView(cell.column.name, cell.value)),
            },
            {
              label: t('menu.copyCell'),
              run: () => void copyText(cellCopyText(cell.value)).then(noteCopied('单元格值')),
            },
            {
              label: t('menu.copyRow', { n: displayColumns.length }),
              run: () => void copyText(rowToTsv(displayColumns, cell.row)).then(noteCopied('整行')),
            },
            {
              label: t('menu.copyInsert'),
              run: () => {
                if (connection === null) return
                void copyText(insertStatement(connection.dialect, params.schema, params.table, displayColumns, cell.row)).then(noteCopied('INSERT'))
              },
            },
            {
              label: t('menu.copyWhere'),
              run: () => {
                if (connection === null) return
                void copyText(`WHERE ${cellWhere(connection.dialect, cell.column, cell.value)}`).then(noteCopied('WHERE 条件'))
              },
            },
            {
              label: t('menu.groupCount'),
              run: () => {
                if (connection === null) return
                openConsoleTab({
                  connectionId: params.connectionId,
                  sql: groupCountSql(connection.dialect, params.schema, params.table, cell.column),
                })
              },
            },
            {
              label: t('menu.queryByValue'),
              run: () => {
                if (connection === null) return
                const where = cellWhere(connection.dialect, cell.column, cell.value)
                openConsoleTab({
                  connectionId: params.connectionId,
                  sql: tableSelectSql(connection.dialect, params.schema, params.table, where, '', pageSize),
                })
              },
            },
            {
              label: t('menu.filterByValue'),
              run: () => {
                setFiltersOpen(true)
                setColumnFilter(
                  cell.column,
                  cell.value === null ? { text: '', op: 'isnull' } : { text: formatCell(cell.value), op: 'eq' },
                )
              },
            },
            {
              label: t('menu.clearColumnFilter', { name: cell.column.name }),
              disabled: filters[cell.column.name] === undefined,
              run: () => {
                setColumnFilter(cell.column, undefined)
                applyRef.current({ page: 0 })
              },
            },
      ]
    },
    [
      canMutate,
      connection,
      description,
      displayColumns,
      displayRows,
      duplicateRow,
      editableColumns,
      filters,
      pageSize,
      params.connectionId,
      params.schema,
      params.table,
      pendingDeletes,
      rowSaving,
      setCellPending,
      startCellEdit,
    ],
  )
  const hasPrevious = page > 0
  const lastPage = total === undefined ? undefined : Math.max(Math.ceil(total / pageSize) - 1, 0)

  // Rows can disappear under the current page (deleted elsewhere, or a wider
  // WHERE than when the total was measured): fall back to the last real page.
  useEffect(() => {
    if (loading || connection === null || total === undefined) return
    if (rows.length > 0 || page === 0) return
    const last = Math.max(Math.ceil(total / pageSize) - 1, 0)
    if (last >= page) return
    void load(connection, {
      page: last,
      size: pageSize,
      where: composeWhere(connection.dialect, whereText, columns, filters),
      orderBy: orderText,
      recount: false,
    })
  }, [columns, connection, filters, load, loading, orderText, page, pageSize, rows.length, total, whereText])
  useEffect(() => {
    setPageDraft(String(page + 1))
  }, [page])
  const jumpToPage = useCallback((): void => {
    const wanted = Number.parseInt(pageDraft, 10)
    const target = Number.isFinite(wanted) && wanted >= 1 ? wanted - 1 : page
    const bounded = lastPage === undefined ? target : Math.min(target, lastPage)
    if (bounded === page) {
      setPageDraft(String(page + 1))
      return
    }
    apply({ page: bounded })
  }, [apply, lastPage, page, pageDraft])
  const hasNext = lastPage === undefined ? rows.length >= pageSize : page < lastPage
  const rangeStart = rows.length === 0 ? 0 : offset + 1
  const rangeEnd = offset + rows.length
  const totalText = total !== undefined ? `/${formatCount(total)}` : hasNext ? `/${formatCount(offset + pageSize)}+` : ''

  // Typing in a column filter re-queries on a short delay so each keystroke does
  // not hit the server. Emptying the last filter re-queries at once, otherwise
  // the grid would keep showing the narrowed rows.
  //
  // `columns` is deliberately read through a ref: every successful query stores
  // a fresh columns array, so depending on it here made the effect re-run after
  // each load and schedule the next query forever (a filter would poll).
  const columnsRef = useRef<ColumnInfo[]>([])
  columnsRef.current = columns
  const previousActive = useRef(0)
  useEffect(() => {
    if (!filtersOpen || connection === null) return
    const active = columnsRef.current.filter((column) => filters[column.name] !== undefined).length
    const hadFilters = previousActive.current > 0
    previousActive.current = active
    if (active === 0) {
      if (hadFilters) applyRef.current({ page: 0 }, {})
      return
    }
    const timer = setTimeout(() => applyRef.current({ page: 0 }), 400)
    return () => clearTimeout(timer)
  }, [filters, filtersOpen, connection])

  // Opening the filter row should land the caret in the first box.
  useEffect(() => {
    if (!filtersOpen) return
    filterRowRef.current?.querySelector('input')?.focus()
  }, [filtersOpen])

  const activeFilterCount = columns.filter((column) => filters[column.name] !== undefined).length

  /** Drop every per-column filter at once and re-query the first page. */
  const clearColumnFilters = useCallback((): void => {
    setFilters({})
    if (connection !== null) apply({ where: composeWhere(connection.dialect, whereText, columns, {}), page: 0 })
  }, [apply, columns, connection, whereText])
  /** 跳到 WHERE 框、刷新当前页这两个键都能在设置里改。 */
  const handleShortcuts = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    if (shortcutHit(event, 'table.where')) {
      event.preventDefault()
      whereRef.current?.focus()
      return
    }
    if (shortcutHit(event, 'table.refresh')) {
      // 浏览器默认会把这个组合键当成刷新整页，这里只刷当前页的行。
      event.preventDefault()
      applyRef.current({ recount: true })
    }
  }, [])

  const conditioned = whereText.trim() !== '' || activeFilterCount > 0
  const setColumnFilter = (column: ColumnInfo, filter: ColumnFilter | undefined): void => {
    setFilters((previous) => {
      const next: ColumnFilters = { ...previous }
      if (filter === undefined) delete next[column.name]
      else next[column.name] = filter
      return next
    })
  }

  /**
   * Export what the grid currently shows ("page") or page through the whole
   * filtered result set, capped so a huge table cannot freeze the browser.
   */
  const EXPORT_LIMIT = 50000
  /** Read every row of the current filtered result, capped like the exports. */
  const collectAllRows = async (label: string): Promise<{ columns: ColumnInfo[]; rows: Row[] }> => {
    if (connection === null) return { columns: displayColumns, rows: [] }
    const dialect = connection.dialect
    const from = qualifiedName(dialect, params.schema, params.table)
    const where = composeWhere(dialect, whereText, columns, filters)
    const whereSql = where === '' ? '' : ` WHERE ${where}`
    const orderBy = stripOrderBy(orderText)
    const orderSql = orderByForPaging(dialect, orderBy)
    const batch = 2000
    let seeded = false
    let collectedColumns = displayColumns
    const collected = await collectRows({
      limit: EXPORT_LIMIT,
      batch,
      cancelled: () => exportCancelled.current,
      onProgress: (count) => setExportNote(`${label} 正在取 ${formatCount(count)} 行…`),
      fetch: async ({ offset }) => {
        const sql = `SELECT * FROM ${from}${whereSql}${orderSql} ${pageClause(dialect, batch, offset)}`
        const result = await runSql(params.connectionId, sql, batch)
        if (!seeded) {
          collectedColumns = result.columns
          seeded = true
        }
        return result.rows
      },
    })
    return { columns: collectedColumns, rows: collected }
  }

  const exportRows = async (format: ExportFormat, scope: 'page' | 'all'): Promise<void> => {
    if (connection === null) return
    setExporting(true)
    exportingRef.current = true
    setExportOpen(false)
    exportCancelled.current = false
    try {
      const dialect = connection.dialect as SqlDialect
      let exportColumns = displayColumns
      let exportData = displayRows
      if (scope === 'all') {
        const collected = await collectAllRows(format.toUpperCase())
        if (exportCancelled.current) {
          setExportNote(`${format.toUpperCase()} 导出已取消`)
          setTimeout(() => setExportNote(''), 5000)
          return
        }
        exportData = orderRows(collected.rows, order)
        exportColumns = orderColumns(collected.columns, order)
      }
      const payload = renderExport(format, {
        dialect,
        schema: params.schema,
        table: params.table,
        columns: exportColumns,
        rows: exportData,
      })
      downloadText(exportFilename(params.schema, params.table, format), payload.mime, payload.text)
      setExportNote(`${format.toUpperCase()} 已导出 ${formatCount(exportData.length)} 行`)
      setTimeout(() => setExportNote(''), 5000)
    } catch (caught) {
      setError(failureText(caught))
    } finally {
      setExporting(false)
      exportingRef.current = false
    }
  }

  /** Toggle one checkbox; shift-click extends from the last clicked row. */
  const selectRow = useCallback((rowIndex: number, extend: boolean): void => {
    setSelectedRows((current) => {
      const next = new Set(current)
      if (extend && selectionAnchor.current !== null) {
        const from = Math.min(selectionAnchor.current, rowIndex)
        const to = Math.max(selectionAnchor.current, rowIndex)
        const select = !next.has(rowIndex)
        for (let index = from; index <= to; index += 1) {
          if (select) next.add(index)
          else next.delete(index)
        }
        return next
      }
      if (next.has(rowIndex)) next.delete(rowIndex)
      else next.add(rowIndex)
      return next
    })
    selectionAnchor.current = rowIndex
  }, [])
  const toggleAllRows = useCallback((): void => {
    setSelectedRows((current) =>
      current.size === shownRows.length ? new Set() : new Set(shownRows.map((_, index) => index)),
    )
  }, [shownRows])
  /** Save only the checked rows of the current page. */
  const exportSelected = (format: ExportFormat): void => {
    setExportOpen(false)
    const picked = shownRows.filter((_, index) => selectedRows.has(index))
    if (picked.length === 0) return
    const payload = renderExport(format, {
      dialect: connection?.dialect ?? 'mysql',
      schema: params.schema,
      table: params.table,
      columns: shownColumns,
      rows: picked,
    })
    downloadText(exportFilename(params.schema, params.table, format), payload.mime, payload.text)
    setExportNote(`${format.toUpperCase()} 已导出 ${picked.length} 行`)
    setTimeout(() => setExportNote(''), 5000)
    setSelectedRows(new Set())
  }

  /** The whole table as a runnable script: CREATE plus one INSERT per row. */
  const exportDump = async (): Promise<void> => {
    if (connection === null) return
    setExporting(true)
    exportingRef.current = true
    setExportOpen(false)
    exportCancelled.current = false
    try {
      const collected = await collectAllRows('脚本')
      if (exportCancelled.current) {
        setExportNote('脚本导出已取消')
        setTimeout(() => setExportNote(''), 5000)
        return
      }
      const ddl = await api
        .ddl(params.connectionId, params.schema, params.table, objectKind)
        .then((result) => result.ddl)
        .catch(() => null)
      const text = tableDumpText({
        dialect: connection.dialect,
        schema: params.schema,
        table: params.table,
        ddl,
        columns: orderColumns(collected.columns, order),
        rows: orderRows(collected.rows, order),
      })
      downloadText(exportFilename(params.schema, params.table, 'sql'), 'application/sql', text)
      setExportNote(`SQL 已导出 ${formatCount(collected.rows.length)} 行`)
      setTimeout(() => setExportNote(''), 5000)
    } catch (caught) {
      setError(failureText(caught))
    } finally {
      setExporting(false)
      exportingRef.current = false
    }
  }

  const pendingNewRows = useMemo(
    () =>
      pendingNew.map((values, index) => ({
        values,
        onStartEdit: (column: string) => startNewCell(index, column),
        onRemove: () => removeNewRow(index),
        ...(newCell?.rowIndex === index
          ? {
              editing: {
                column: newCell.column,
                value: newCell.value,
                onChange: updateNewCell,
                onCommit: commitNewCell,
                onCancel: cancelNewCell,
              },
            }
          : {}),
      })),
    [pendingNew, newCell],
  )
  const editedCell = useCallback((rowIndex: number, column: string) => pendingUpdates[rowIndex]?.[column] !== undefined, [pendingUpdates])
  const pendingCell = useCallback(
    (rowIndex: number, column: string, original: CellValue): CellValue | undefined => {
      const changed = pendingUpdates[rowIndex]?.[column]
      if (changed === undefined) return undefined
      if (changed === DEFAULT_VALUE) return 'DEFAULT'
      return changed === '' ? null : changed
    },
    [pendingUpdates],
  )
  const cellAggregate = useMemo(() => {
    if (cellRange === null) return null
    return summarizeRange(shownColumns, shownRows, cellRange, (rowIndex, columnIndex) => {
      const loaded: CellValue = shownRows[rowIndex]?.[columnIndex] ?? null
      const column = shownColumns[columnIndex]
      if (column === undefined) return loaded
      const pending = pendingUpdates[rowIndex]?.[column.name]
      if (pending === undefined) return loaded
      return pending === DEFAULT_VALUE ? null : pending === '' ? null : pending
    })
  }, [cellRange, pendingUpdates, shownColumns, shownRows])
  const copyRows = useMemo(
    () => (selectedRows.size > 0 ? displayRows.filter((_, index) => selectedRows.has(index)) : displayRows),
    [displayRows, selectedRows],
  )

  if (error !== null && rows.length === 0) {
    return (
      <div className="dshdb-qtab">
        <Banner
          tone="error"
          onClose={() => setError(null)}
          actions={
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const last = lastLoad.current
                  if (last === null) return
                  void load(last.found, last.target)
                }}
              >
                {t('table.retry')}
              </Button>
              <Button size="sm" variant="ghost" title={t('table.copyError')} onClick={() => void copyText(failureMessage(error))}>
                {t('table.copy')}
              </Button>
            </>
          }
        >
          {error.message}
          {error.detail ? `\n${error.detail}` : ''}
        </Banner>
      </div>
    )
  }

  /** Copy the checked rows in the same formats the page copies offer. */
  const copySelected = (format: 'csv' | 'tsv' | 'json' | 'md' | 'sql'): void => {
    const picked = shownRows.filter((_, index) => selectedRows.has(index))
    if (picked.length === 0) return
    const text =
      format === 'csv'
        ? toCsv(shownColumns, picked)
        : format === 'tsv'
          ? toTsv(shownColumns, picked)
          : format === 'json'
            ? toJson(shownColumns, picked)
            : format === 'md'
              ? toMarkdown(shownColumns, picked)
              : insertStatements(connection?.dialect ?? 'mysql', params.schema, params.table, shownColumns, picked)
    void copyText(text).then(noteCopied(format === 'md' ? 'Markdown' : format.toUpperCase()))
  }

  const exportGroups: MenuGroupSpec[] = [
    {
      id: 'page',
      label: t('table.export.page'),
      leaves: [
        { id: 'page-csv', label: `${t('table.currentPage')} CSV (${formatCount(rows.length)} ${t('table.rows')})`, onSelect: () => void exportRows('csv', 'page') },
        { id: 'page-json', label: `${t('table.currentPage')} JSON (${formatCount(rows.length)} ${t('table.rows')})`, onSelect: () => void exportRows('json', 'page') },
        { id: 'page-sql', label: `${t('table.currentPage')} SQL (${formatCount(rows.length)} ${t('table.rows')})`, onSelect: () => void exportRows('sql', 'page') },
        { id: 'page-md', label: `${t('table.currentPage')} Markdown (${formatCount(rows.length)} ${t('table.rows')})`, onSelect: () => void exportRows('md', 'page') },
      ],
    },
    ...(selectedRows.size > 0
      ? [
          {
            id: 'selected',
            label: t('table.export.selected'),
            leaves: [
              { id: 'selected-csv', label: `${t('table.selectedRows')} CSV (${selectedRows.size} ${t('table.rows')})`, onSelect: () => exportSelected('csv') },
              { id: 'selected-json', label: `${t('table.selectedRows')} JSON (${selectedRows.size} ${t('table.rows')})`, onSelect: () => exportSelected('json') },
              { id: 'selected-sql', label: `${t('table.selectedRows')} SQL (${selectedRows.size} ${t('table.rows')})`, onSelect: () => exportSelected('sql') },
              { id: 'selected-md', label: `${t('table.selectedRows')} Markdown (${selectedRows.size} ${t('table.rows')})`, onSelect: () => exportSelected('md') },
            ],
          },
        ]
      : []),
    {
      id: 'copy-page',
      label: t('table.copy.page'),
      leaves: [
        { id: 'copy-page-md', label: `${t('table.copy.page')} Markdown`, onSelect: () => void copyText(toMarkdown(displayColumns, rows)).then(noteCopied('Markdown')) },
        { id: 'copy-page-csv', label: `${t('table.copy.page')} CSV`, onSelect: () => void copyText(toCsv(displayColumns, rows)).then(noteCopied('CSV')) },
        { id: 'copy-page-tsv', label: `${t('table.copy.page')} TSV`, onSelect: () => void copyText(toTsv(displayColumns, rows)).then(noteCopied('TSV')) },
        { id: 'copy-page-json', label: `${t('table.copy.page')} JSON`, onSelect: () => void copyText(toJson(displayColumns, rows)).then(noteCopied('JSON')) },
        {
          id: 'copy-page-sql',
          label: `${t('table.copy.page')} SQL`,
          onSelect: () =>
            void copyText(insertStatements(connection?.dialect ?? 'mysql', params.schema, params.table, displayColumns, rows)).then(noteCopied('SQL')),
        },
      ],
    },
    ...(selectedRows.size > 0
      ? [
          {
            id: 'copy-selected',
            label: t('table.copy.selected'),
            leaves: [
              { id: 'copy-selected-md', label: `${t('table.copy.selected')} Markdown`, onSelect: () => copySelected('md') },
              { id: 'copy-selected-csv', label: `${t('table.copy.selected')} CSV`, onSelect: () => copySelected('csv') },
              { id: 'copy-selected-tsv', label: `${t('table.copy.selected')} TSV`, onSelect: () => copySelected('tsv') },
              { id: 'copy-selected-json', label: `${t('table.copy.selected')} JSON`, onSelect: () => copySelected('json') },
              { id: 'copy-selected-sql', label: `${t('table.copy.selected')} SQL`, onSelect: () => copySelected('sql') },
            ],
          },
        ]
      : []),
    {
      id: 'all',
      label: t('table.export.all'),
      leaves: [
        { id: 'all-csv', label: '全部 CSV', onSelect: () => void exportRows('csv', 'all') },
        { id: 'all-json', label: '全部 JSON', onSelect: () => void exportRows('json', 'all') },
        { id: 'all-sql', label: '全部 SQL', onSelect: () => void exportRows('sql', 'all') },
        { id: 'all-md', label: '全部 Markdown', onSelect: () => void exportRows('md', 'all') },
      ],
    },
  ]

  return (
    <div className="dshdb-qtab" onKeyDown={handleShortcuts}>
      <div className="dshdb-qbar">
        <span className="dshdb-qtable" title={`${params.schema}.${params.table}`}>
          <TableIcon size={13} />
          {params.table}
        </span>
        {connection?.readOnly === true ? (
          <Tag tone="warn" title="这条连接是只读的，写语句会被拒绝">
            只读
          </Tag>
        ) : null}
        <button
          type="button"
          className="dshdb-pager-btn"
          title={canMutate ? t('table.add') : objectKind === 'view' ? 'View rows cannot be added' : 'Show all columns and connect a writable source first'}
          aria-label={t('table.add')}
          onClick={startInsert}
          disabled={!canMutate || rowSaving}
        >
          <PlusIcon size={13} />
        </button>
        <button
          type="button"
          className="dshdb-pager-btn"
          title={canMutate ? t('table.duplicateRow') : 'Not duplicable'}
          aria-label={t('table.duplicateRow')}
          onClick={() => {
            if (selectedIndex !== undefined) duplicateRow(selectedIndex)
          }}
          disabled={!canMutate || selectedIndex === undefined || rowSaving}
        >
          <CopyIcon size={13} />
        </button>
        <button
          type="button"
          className="dshdb-pager-btn"
          title={canMutate ? t('table.delete') : 'Not deletable'}
          aria-label={t('table.delete')}
          onClick={markDelete}
          disabled={!canMutate || selectedRows.size === 0 || rowSaving}
        >
          <MinusIcon size={13} />
        </button>
        <button
          type="button"
          className="dshdb-pager-btn"
          title={t('table.undoTitle')}
          aria-label={t('table.undo')}
          onClick={undoPending}
          disabled={pendingNew.length === 0 && pendingDeletes.size === 0 && Object.keys(pendingUpdates).length === 0 || rowSaving}
        >
          <UndoIcon size={13} />
        </button>
        <button
          type="button"
          className="dshdb-pager-btn"
          title={t('table.dml')}
          aria-label={t('table.dml')}
          onClick={openDml}
          disabled={pendingCount === 0 || rowSaving}
        >
          <EyeUpIcon size={14} />
        </button>
        <button
          type="button"
          className="dshdb-pager-btn"
          title={t('table.submit')}
          aria-label={t('table.submit')}
          onClick={() => void submitDml()}
          disabled={pendingCount === 0 || rowSaving}
        >
          <ArrowUpIcon size={13} />
        </button>
        {pendingCount > 0 ? <Tag tone="business">{t('table.pending')} {pendingCount}</Tag> : null}
        <span className="dshdb-qbar-spacer" />
        {loading ? <Loading bare /> : null}
        {elapsed !== undefined && !loading ? <span className="dshdb-qmeta">{formatMs(elapsed)}</span> : null}
        {exportNote !== '' ? <Tag tone="business" role="status">{exportNote}</Tag> : null}
        {exporting ? (
          <button
            type="button"
            className="dshdb-pager-btn"
            title="停止导出，已取到的行不会写入文件"
            onClick={() => {
              exportCancelled.current = true
            }}
          >
            取消
          </button>
        ) : null}
        <button
          type="button"
          className="dshdb-pager-btn"
          title={
            canMutate
              ? pendingCount > 0
                ? t('import.blockedPending')
                : t('table.import')
              : t('import.readonly')
          }
          aria-label={t('table.import')}
          onClick={() => setImportOpen(true)}
          disabled={!canMutate || description === null || pendingCount > 0 || loading}
        >
          <UploadIcon size={13} />
        </button>
        <button
          type="button"
          className="dshdb-pager-btn"
          title={
            connection?.readOnly === true
              ? t('copyTo.readonly')
              : pendingCount > 0
                ? t('import.blockedPending')
                : t('table.copyToDatabase')
          }
          aria-label={t('table.copyToDatabase')}
          onClick={() => setCopyOpen(true)}
          disabled={
            connection?.readOnly === true ||
            displayColumns.length === 0 ||
            rows.length === 0 ||
            loading ||
            pendingCount > 0
          }
        >
          <DatabaseIcon size={13} />
        </button>
        <span className="dshdb-menu-wrap" ref={exportAnchor}>
          <button
            type="button"
            className={`dshdb-pager-btn${exportOpen ? ' dshdb-pager-btn-active' : ''}`}
            title="导出结果"
            aria-label="导出结果"
            aria-expanded={exportOpen}
            onClick={() => setExportOpen((open) => !open)}
            disabled={loading || exporting || rows.length === 0}
          >
            {exporting ? <Spinner /> : <DownloadIcon size={13} />}
          </button>
          {exportOpen ? (
            <MenuGroupList
              groups={exportGroups}
              extra={{ id: 'dump', label: t('table.dump'), onSelect: () => void exportDump() }}
              onClose={() => setExportOpen(false)}
            />
          ) : null}
        </span>
        <button
          type="button"
          className={`dshdb-pager-btn${filtersOpen ? ' dshdb-pager-btn-active' : ''}`}
          title={filtersOpen ? '关闭列筛选' : '按列筛选（也可点击单元格按值筛选）'}
          aria-label="列筛选"
          aria-pressed={filtersOpen}
          onClick={() => {
            setFiltersOpen((open) => {
              const next = !open
              writeFlag(FILTERS_OPEN_KEY, next)
              return next
            })
          }}
          disabled={loading}
        >
          <FilterIcon size={13} />
          {activeFilterCount > 0 ? <span className="dshdb-filter-count">{activeFilterCount}</span> : null}
        </button>
        <button
          type="button"
          className="dshdb-pager-btn"
          title={t('table.console')}
          aria-label={t('table.console')}
          onClick={() => {
            const target = connection
            if (target === null) return
            const where = composeWhere(target.dialect, whereText, columns, filters)
            const orderBy = stripOrderBy(orderText)
            openConsoleTab({
              connectionId: params.connectionId,
              sql: tableSelectSql(target.dialect, params.schema, params.table, where, orderBy, pageSize),
            })
          }}
          disabled={loading}
        >
          <TerminalIcon size={13} />
        </button>
        <select
          className="dshdb-input dshdb-qfilter-input"
          aria-label="自动刷新"
          title="定时重新查询当前页"
          value={autoMs}
          onChange={(event) => {
            const next = Number(event.target.value)
            setAutoMs(next)
            writeNumber(AUTO_REFRESH_KEY, next)
          }}
        >
          <option value={0}>{t('table.autoRefreshOff')}</option>
          <option value={5000}>{t('table.autoRefreshEvery', { n: 5 })}</option>
          <option value={10000}>{t('table.autoRefreshEvery', { n: 10 })}</option>
          <option value={30000}>{t('table.autoRefreshEvery', { n: 30 })}</option>
        </select>
        <button
          type="button"
          className="dshdb-pager-btn"
          title={t('table.ddl')}
          aria-label={t('table.ddl')}
          onClick={() => void openDdl()}
          disabled={ddlBusy}
        >
          <TableIcon size={13} />
        </button>
        <button
          type="button"
          className="dshdb-pager-btn"
          title={t('table.refresh')}
          aria-label={t('table.refresh')}
          onClick={() => apply({ recount: true })}
          disabled={loading}
        >
          <RefreshIcon size={13} />
        </button>
      </div>

      <div className="dshdb-qfilter">
        <span className="dshdb-qfilter-label">WHERE</span>
        <SqlFilterInput
          ref={whereRef}
          value={whereText}
          onChange={setWhereText}
          onEnter={() => apply({ where: whereText, page: 0 })}
          onEscape={() => {
            setWhereText('')
            apply({ where: '', page: 0 })
          }}
          placeholder={t('table.wherePlaceholder')}
          ariaLabel={t('table.whereAria')}
          title={t('table.whereFocus', { binding: shortcutLabel('table.where') })}
          connectionId={params.connectionId}
          schema={params.schema}
          table={params.table}
          dialect={connection?.dialect ?? 'mysql'}
          clause="where"
        />
        {whereText === '' ? null : (
          <button
            type="button"
            className="dshdb-row-action"
            title={t('table.clearWhere')}
            aria-label={t('table.clearWhere')}
            onClick={() => {
              setWhereText('')
              apply({ where: '', page: 0 })
            }}
          >
            ×
          </button>
        )}
        <span className="dshdb-qfilter-label">ORDER BY</span>
        <SqlFilterInput
          value={orderText}
          onChange={setOrderText}
          onEnter={() => apply({ orderBy: orderText, page: 0 })}
          onEscape={() => {
            setOrderText('')
            apply({ orderBy: '', page: 0 })
          }}
          placeholder={t('table.orderPlaceholder')}
          ariaLabel={t('table.orderAria')}
          connectionId={params.connectionId}
          schema={params.schema}
          table={params.table}
          dialect={connection?.dialect ?? 'mysql'}
          clause="order"
          className="dshdb-qfilter-order"
        />
        {orderText === '' ? null : (
          <button
            type="button"
            className="dshdb-row-action"
            title={t('table.clearOrder')}
            aria-label={t('table.clearOrder')}
            onClick={() => {
              setOrderText('')
              apply({ orderBy: '', page: 0 })
            }}
          >
            ×
          </button>
        )}
        <button
          type="button"
          className="dshdb-pager-btn"
          title={t('table.applyFilters')}
          aria-label={t('table.applyFilters')}
          onClick={() => apply({ where: whereText, orderBy: orderText, page: 0 })}
          disabled={loading}
        >
          <PlayIcon size={13} />
        </button>
      </div>

      {error !== null ? (
        <Banner
          tone="error"
          onClose={() => setError(null)}
          actions={
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const last = lastLoad.current
                  if (last === null) return
                  void load(last.found, last.target)
                }}
              >
                {t('table.retry')}
              </Button>
              <Button size="sm" variant="ghost" title={t('table.copyError')} onClick={() => void copyText(failureMessage(error))}>
                {t('table.copy')}
              </Button>
            </>
          }
        >
          {error.message}
          {error.detail ? `\n${error.detail}` : ''}
        </Banner>
      ) : null}


      {rowError !== '' ? (
        <Banner tone="error" onClose={() => setRowError('')}>{rowError}</Banner>
      ) : null}

      {rows.length === 0 && !loading ? (
        <div className="dshdb-grid-wrap">
          <EmptyState
            icon={<TableIcon size={22} />}
            title={conditioned ? t('table.noRowsMatch') : t('table.empty')}
            description={conditioned ? sqlText : t('table.emptyDescription')}
            actions={
              conditioned ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setWhereText('')
                    setFilters({})
                    setOrderText('')
                    apply({ where: '', orderBy: '', page: 0 })
                  }}
                  title={t('table.clearConditionsTitle')}
                >
                  {t('table.clearConditions')}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <DataGrid
          label="表数据"
          columns={shownColumns}
          rows={shownRows}
          offset={offset}
          storageKey={`table:${params.schema}.${params.table}`}
          sort={activeSort ?? null}
          headerMenu={columnMenu}
          onSort={sortTable}
          onReorderColumns={gridReorder}
          selectedRows={selectedRows}
          onToggleRow={selectRow}
          onToggleAllRows={toggleAllRows}
          headerExtra={filtersOpen ? (
              <tr
                className="dshdb-filter-row"
                ref={filterRowRef}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return
                  event.preventDefault()
                  setFiltersOpen(false)
                }}
              >
                <th className="dshdb-select-cell" />
                <th className="dshdb-num">
                  {activeFilterCount > 0 ? (
                    <button type="button" className="dshdb-row-action" title={t('table.clearAllFilters')} aria-label={t('table.clearColumnFilters')} onClick={clearColumnFilters}>
                      ×
                    </button>
                  ) : null}
                </th>
                {shownColumns.map((column, index) => {
                  const filter = filters[column.name]
                  const cleared = filter === undefined || (filter.op !== 'isnull' && filter.text.trim() === '')
                  return (
                    <th key={`filter-${column.name}-${index}`}>
                      <span className={`dshdb-filter-box${cleared ? '' : ' dshdb-filter-box-active'}`}>
                        <input
                          className="dshdb-filter-input"
                          placeholder={filter?.op === 'isnull' ? 'NULL' : t('table.filterContains')}
                          aria-label={`筛选 ${column.name}`}
                          title={filter?.op === 'isnull' ? t('table.filterNull') : t('table.filterByColumn', { name: column.name })}
                          value={filter?.op === 'isnull' ? '' : filter?.text ?? ''}
                          spellCheck={false}
                          onChange={(event) => {
                            const text = event.target.value
                            setColumnFilter(column, text === '' ? undefined : { text, op: 'like' })
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') applyRef.current({ page: 0 })
                          }}
                        />
                        {cleared ? null : (
                          <button
                            type="button"
                            className="dshdb-filter-clear"
                            aria-label={t('table.clearColumnFilter', { name: column.name })}
                            onClick={() => {
                              setColumnFilter(column, undefined)
                              const next: ColumnFilters = { ...filters }
                              delete next[column.name]
                              applyRef.current({ page: 0 }, next)
                            }}
                          >
                            ×
                          </button>
                        )}
                      </span>
                    </th>
                  )
                })}
              </tr>
            ) : null}
          cellClass={gridCellClass}
          cellMenu={gridCellMenu}
          onCellOpen={gridCellOpen}
          onCellClick={
            filtersOpen
              ? (column, value) => {
                  setColumnFilter(column, value === null ? { text: '', op: 'isnull' } : { text: formatCell(value), op: 'eq' })
                }
              : undefined
          }
          pendingNewRows={pendingNewRows}
          deletedRows={pendingDeletes}
          editedCells={editedCell}
          pendingCellValue={pendingCell}
          onRangeChange={setCellRange}
          {...(canMutate ? { onPasteRange: pasteRange } : {})}
          {...(cellEdit === null ? {} : {
            cellEdit: {
              rowIndex: cellEdit.rowIndex,
              column: cellEdit.column,
              value: cellEdit.value,
              onChange: updateCell,
              onCommit: commitCell,
              onCancel: cancelCell,
            },
          })}
          {...(canMutate ? { onCellDoubleClick: startCellEdit } : {})}
        />
      )}

      {cellAggregate !== null ? (
        <div className="dshdb-grid-aggregate" role="status">
          <span>{t('table.rangeSize', { rows: cellAggregate.rows, columns: cellAggregate.columns })}</span>
          <span>{t('table.rangeNonNull', { n: cellAggregate.nonNull })}</span>
          {cellAggregate.numeric > 0 ? (
            <>
              <span>{t('table.rangeSum', { n: String(cellAggregate.sum) })}</span>
              <span>{t('table.rangeAverage', { n: String(Math.round((cellAggregate.average ?? 0) * 100) / 100) })}</span>
              <span>{t('table.rangeMin', { n: String(cellAggregate.min ?? '') })}</span>
              <span>{t('table.rangeMax', { n: String(cellAggregate.max ?? '') })}</span>
            </>
          ) : null}
          <span className="dshdb-grid-aggregate-hint">{t('table.rangeCopyHint')}</span>
        </div>
      ) : null}

      <div className="dshdb-pager">
        {loading ? <Tag tone="business">{t('table.querying')}</Tag> : null}
        {sqlText !== '' ? (
          <span className="dshdb-pager-sql" title={sqlText}>
            {sqlText}
          </span>
        ) : null}
        <span className="dshdb-pager-spacer" />
        <button
          type="button"
          className="dshdb-pager-btn"
          title={t('table.first')}
          aria-label={t('table.first')}
          onClick={() => apply({ page: 0 })}
          disabled={!hasPrevious || loading}
        >
          |◀
        </button>
        <button
          type="button"
          className="dshdb-pager-btn"
          title={t('table.previous')}
          aria-label={t('table.previous')}
          onClick={() => apply({ page: Math.max(page - 1, 0) })}
          disabled={!hasPrevious || loading}
        >
          ◀
        </button>
        <span className="dshdb-pager-range" title={`${formatCount(rangeStart)}-${formatCount(rangeEnd)}`}>
          {formatCount(rangeStart)}-{formatCount(rangeEnd)}
        </span>
        <span className="dshdb-pager-jump">
          <input
            className="dshdb-input dshdb-pager-input"
            type="number"
            min={1}
            inputMode="numeric"
            aria-label={t('table.page')}
            title="输入页码后回车跳到该页"
            value={pageDraft}
            disabled={loading}
            onChange={(event) => setPageDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              jumpToPage()
            }}
            onBlur={jumpToPage}
          />
        </span>
        <select
          className="dshdb-select dshdb-select-inline dshdb-pager-size"
          aria-label={t('table.rowsPerPage')}
          value={String(pageSize)}
          disabled={loading}
          onChange={(event) => {
            const size = Number(event.target.value)
            setPageSize(size)
            writePageSize(TABLE_PAGE_KEY, size)
            apply({ size, page: 0 })
          }}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {formatCount(size)}
            </option>
          ))}
        </select>
        {countUnknown ? (
          <Tag tone="warn" title="行数统计失败（可能是权限或超时），页码只能按已取到的行数往后翻">{t('table.unknownCount')}</Tag>
        ) : null}
        <span className="dshdb-pager-total">{totalText}</span>
        <button
          type="button"
          className="dshdb-pager-btn"
          title={t('table.next')}
          aria-label={t('table.next')}
          onClick={() => apply({ page: page + 1 })}
          disabled={!hasNext || loading}
        >
          ▶
        </button>
        <button
          type="button"
          className="dshdb-pager-btn"
          title={t('table.last')}
          aria-label={t('table.last')}
          onClick={() => apply({ page: lastPage ?? page })}
          disabled={lastPage === undefined || loading || page >= lastPage}
        >
          ▶|
        </button>
      </div>

      <DdlModal
        title={ddl?.title ?? ''}
        text={ddl?.text ?? null}
        warnings={ddl?.warnings ?? []}
        onClose={() => setDdl(null)}
      />
      <Modal
        open={dmlOpen}
        title={t('table.dmlTitle')}
        width={720}
        onClose={() => setDmlOpen(false)}
        footer={
          <>
            <span className="dshdb-muted">共 {dmlStatements.length} 条语句</span>
            <span className="dshdb-modal-foot-spacer" />
            <Button onClick={() => setDmlOpen(false)} disabled={rowSaving}>{t('table.dmlCancel')}</Button>
            <Button variant="primary" loading={rowSaving} onClick={() => void submitDml()}>{t('table.dmlSubmit')}</Button>
          </>
        }
      >
        <SqlHighlight sql={dmlStatements.join('\n\n')} className="dshdb-dml-sql" />
        {keyColumns.length === 0 ? <Banner tone="warn">{t('table.noPrimaryKey')}</Banner> : null}
        {rowError !== '' ? <Banner tone="error">{rowError}</Banner> : null}
      </Modal>
      <CellValueModal view={cellView} onClose={() => setCellView(null)} />
      <DataImportModal
        target={
          !importOpen || connection === null || description === null
            ? null
            : {
                connection,
                schema: params.schema,
                table: params.table,
                columns: description.columns,
              }
        }
        onClose={() => setImportOpen(false)}
        onImported={(count) => {
          setExportNote(t('import.done', { n: formatCount(count) }))
          applyRef.current({ recount: true, page: 0 })
        }}
      />
      <CopyToDatabaseModal
        target={
          !copyOpen || connection === null || copyRows.length === 0
            ? null
            : {
                connection,
                schema: params.schema,
                table: params.table,
                columns: displayColumns,
                rows: copyRows,
              }
        }
        onClose={() => setCopyOpen(false)}
        onCopied={(count, name) => {
          setExportNote(t('copyTo.done', { n: formatCount(count), name }))
        }}
      />
    </div>
  )
}

/** Render the table tab named by this tab's navigation parameters. */
export function TableTab(props: TableTabProps): ReactElement {
  const t = useI18n()
  const info = (props.useTabInfo ?? noTabInfo)()
  const params = readTableTabParams(info?.tab?.navigation?.params)
  if (params === undefined) {
    return (
      <EmptyState
        icon={<TableIcon size={22} />}
        title={t('nav.table')}
        description={t('nav.table')}
      />
    )
  }
  return <TableGrid params={params} />
}

/** The chip text of a table tab: the table's name, or nothing to name. */
export function TableTabTitle(props: TableTabProps): ReactElement {
  const t = useI18n()
  const info = (props.useTabInfo ?? noTabInfo)()
  const params = readTableTabParams(info?.tab?.navigation?.params)
  if (params === undefined) return <span>{t('nav.table')}</span>
  // The chip is narrow: name the table, keep the qualified name in the tip and
  // in the body header.
  const label = params.table
  const qualified = params.schema === '' ? params.table : `${params.schema}.${params.table}`
  return (
    <span className="dshdb-tabtitle" title={qualified}>
      <TableIcon size={12} />
      {label}
    </span>
  )
}
