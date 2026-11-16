/**
 * Pure helpers behind the result grid's rectangular selection: normalise the
 * anchor/focus pair, render it as TSV for the clipboard, and summarise it for
 * the aggregate bar. Kept out of the components so they stay testable.
 */
import type { CellValue, ColumnInfo, Row } from '../shared/types'
import { formatCell } from './format'

export interface GridCell {
  rowIndex: number
  columnIndex: number
}

export interface GridRange {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
}

export interface RangeSummary {
  rows: number
  columns: number
  nonNull: number
  numeric: number
  sum: number
  average?: number
  min?: number
  max?: number
}

export const NUMERIC_TYPE = /(?:^|\b)(?:tiny|small|medium|big)?int(?:eger)?\b|decimal|numeric|float|double|real|number|money/i

export function numericColumn(column: ColumnInfo): boolean {
  return NUMERIC_TYPE.test(column.typeName)
}

export function normalizeGridRange(anchor: GridCell, focus: GridCell): GridRange {
  return {
    startRow: Math.min(anchor.rowIndex, focus.rowIndex),
    endRow: Math.max(anchor.rowIndex, focus.rowIndex),
    startColumn: Math.min(anchor.columnIndex, focus.columnIndex),
    endColumn: Math.max(anchor.columnIndex, focus.columnIndex),
  }
}

export function rangeContains(range: GridRange, rowIndex: number, columnIndex: number): boolean {
  return (
    rowIndex >= range.startRow &&
    rowIndex <= range.endRow &&
    columnIndex >= range.startColumn &&
    columnIndex <= range.endColumn
  )
}

function tsvCell(value: CellValue): string {
  if (value === null) return ''
  return formatCell(value).replace(/[\t\r\n]+/gu, ' ')
}

/** Rectangular TSV; NULL becomes an empty cell so the block pastes back cleanly. */
export function rangeToTsv(
  columns: readonly ColumnInfo[],
  rows: readonly Row[],
  range: GridRange,
  valueOf?: (rowIndex: number, columnIndex: number) => CellValue,
): string {
  const lines: string[] = []
  for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex += 1) {
    const row = rows[rowIndex]
    if (row === undefined) continue
    const cells: string[] = []
    for (let columnIndex = range.startColumn; columnIndex <= range.endColumn; columnIndex += 1) {
      if (columns[columnIndex] === undefined) continue
      const value = valueOf === undefined ? (row[columnIndex] ?? null) : valueOf(rowIndex, columnIndex)
      cells.push(tsvCell(value))
    }
    lines.push(cells.join('\t'))
  }
  return lines.join('\n')
}

function numberOrUndefined(value: CellValue): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && /^[-+]?\d+(?:\.\d+)?$/u.test(value.trim())) return Number(value)
  return undefined
}

/**
 * Count non-empty cells and, for numeric columns, sum/min/max/average. Values
 * in non-numeric columns are counted but never summed, matching the table view.
 */
export function summarizeRange(
  columns: readonly ColumnInfo[],
  rows: readonly Row[],
  range: GridRange,
  valueOf?: (rowIndex: number, columnIndex: number) => CellValue,
): RangeSummary {
  let nonNull = 0
  let numeric = 0
  let sum = 0
  let min: number | undefined
  let max: number | undefined
  for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex += 1) {
    const row = rows[rowIndex]
    if (row === undefined) continue
    for (let columnIndex = range.startColumn; columnIndex <= range.endColumn; columnIndex += 1) {
      const column = columns[columnIndex]
      if (column === undefined) continue
      const value = valueOf === undefined ? (row[columnIndex] ?? null) : valueOf(rowIndex, columnIndex)
      if (value === null) continue
      nonNull += 1
      if (!numericColumn(column)) continue
      const amount = numberOrUndefined(value)
      if (amount === undefined) continue
      numeric += 1
      sum += amount
      min = min === undefined ? amount : Math.min(min, amount)
      max = max === undefined ? amount : Math.max(max, amount)
    }
  }
  return {
    rows: range.endRow - range.startRow + 1,
    columns: range.endColumn - range.startColumn + 1,
    nonNull,
    numeric,
    sum,
    ...(numeric === 0 ? {} : { average: sum / numeric }),
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  }
}
