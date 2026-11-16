/**
 * Row-level data comparison for the "Compare Data" dialog. Rows are aligned by
 * a key (primary key when both sides share one, otherwise all common columns)
 * and reported as only-left, only-right or changed.
 */
import type { CellValue, ColumnInfo, Row } from '../shared/types'
import { formatCell } from './format'

export interface DataChange {
  column: string
  left: string
  right: string
}

export interface DataDiffRow {
  /** Human-readable key, e.g. `id = 1`. */
  key: string
  keyValues: string[]
  /** Values of all common columns, aligned with DataDiff.columns. */
  values: string[]
  changes: DataChange[]
}

export interface DataDiff {
  columns: string[]
  keyColumns: string[]
  onlyLeft: DataDiffRow[]
  onlyRight: DataDiffRow[]
  changed: DataDiffRow[]
  /** Keys that appear more than once on either side (only the last row is compared). */
  leftDuplicates: number
  rightDuplicates: number
  equal: boolean
}

function valueAt(columns: ColumnInfo[], row: Row, name: string): CellValue {
  const index = columns.findIndex((column) => column.name === name)
  return index < 0 ? null : (row[index] ?? null)
}

function text(value: CellValue): string {
  return formatCell(value)
}

function rowValues(columns: string[], source: ColumnInfo[], row: Row): string[] {
  return columns.map((name) => text(valueAt(source, row, name)))
}

function keyOf(columns: string[], source: ColumnInfo[], row: Row): string {
  return JSON.stringify(columns.map((name) => text(valueAt(source, row, name))))
}

export function diffTableData(options: {
  left: { columns: ColumnInfo[]; rows: Row[] }
  right: { columns: ColumnInfo[]; rows: Row[] }
  /** Columns that identify a row on both sides; empty falls back to all common columns. */
  keyColumns?: string[]
}): DataDiff {
  const rightNames = new Set(options.right.columns.map((column) => column.name))
  const columns = options.left.columns.map((column) => column.name).filter((name) => rightNames.has(name))
  const requested = options.keyColumns ?? []
  const keyColumns = requested.length > 0 && requested.every((name) => columns.includes(name))
    ? requested
    : columns
  const keySet = new Set(keyColumns)
  const changedColumns = columns.filter((name) => !keySet.has(name))

  const index = new Map<string, { row: Row; keyValues: string[] }>()
  let leftDuplicates = 0
  for (const row of options.left.rows) {
    const key = keyOf(keyColumns, options.left.columns, row)
    if (index.has(key)) leftDuplicates += 1
    index.set(key, { row, keyValues: keyColumns.map((name) => text(valueAt(options.left.columns, row, name))) })
  }

  const onlyRight: DataDiffRow[] = []
  const changed: DataDiffRow[] = []
  const seen = new Set<string>()
  let rightDuplicates = 0
  for (const row of options.right.rows) {
    const key = keyOf(keyColumns, options.right.columns, row)
    if (seen.has(key)) rightDuplicates += 1
    seen.add(key)
    const match = index.get(key)
    const keyValues = keyColumns.map((name) => text(valueAt(options.right.columns, row, name)))
    if (match === undefined) {
      onlyRight.push({
        key: keyColumns.map((name, position) => `${name} = ${keyValues[position] ?? ''}`).join(', '),
        keyValues,
        values: rowValues(columns, options.right.columns, row),
        changes: [],
      })
      continue
    }
    const changes: DataChange[] = []
    for (const column of changedColumns) {
      const leftValue = text(valueAt(options.left.columns, match.row, column))
      const rightValue = text(valueAt(options.right.columns, row, column))
      if (leftValue !== rightValue) changes.push({ column, left: leftValue, right: rightValue })
    }
    if (changes.length > 0) {
      changed.push({
        key: keyColumns.map((name, position) => `${name} = ${keyValues[position] ?? ''}`).join(', '),
        keyValues,
        values: rowValues(columns, options.right.columns, row),
        changes,
      })
    }
  }

  const onlyLeft: DataDiffRow[] = []
  for (const [key, entry] of index) {
    if (seen.has(key)) continue
    onlyLeft.push({
      key: keyColumns.map((name, position) => `${name} = ${entry.keyValues[position] ?? ''}`).join(', '),
      keyValues: entry.keyValues,
      values: rowValues(columns, options.left.columns, entry.row),
      changes: [],
    })
  }

  return {
    columns,
    keyColumns,
    onlyLeft,
    onlyRight,
    changed,
    leftDuplicates,
    rightDuplicates,
    equal: onlyLeft.length === 0 && onlyRight.length === 0 && changed.length === 0,
  }
}