/**
 * CSV/TSV import helpers: detect the delimiter, parse quoted fields, guess a
 * header and map source columns onto table columns. The dialog only collects
 * state; SQL generation stays here so it is testable.
 */
import type { ColumnDetail, SqlDialect } from '../shared/types'
import { sqlValue } from './rowedit'
import { qualifiedName, quoteIdent } from './tablesql'

export type Delimiter = ',' | '\t' | ';' | '|'

export const DELIMITERS: Array<{ value: Delimiter; label: string }> = [
  { value: ',', label: '逗号 ( , )' },
  { value: '\t', label: '制表符 ( Tab )' },
  { value: ';', label: '分号 ( ; )' },
  { value: '|', label: '竖线 ( | )' },
]

/** Pick the delimiter with the most occurrences in the first data lines. */
export function detectDelimiter(text: string): Delimiter {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim() !== '').slice(0, 5)
  let best: Delimiter = ','
  let score = 0
  for (const delimiter of [',', '\t', ';', '|'] as Delimiter[]) {
    const count = lines.reduce((sum, line) => sum + line.split(delimiter).length - 1, 0)
    if (count > score) {
      score = count
      best = delimiter
    }
  }
  return best
}

/**
 * RFC 4180-ish parser: quotes may wrap delimiters and newlines, doubled quotes
 * escape a quote. Rows with no data are dropped.
 */
export function parseDelimited(text: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"' && field === '') {
      quoted = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field.replace(/\r$/u, ''))
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field.replace(/\r$/u, ''))
    rows.push(row)
  }
  return rows.filter((entry) => entry.length > 0 && entry.some((cell) => cell !== ''))
}

export function guessHeader(rows: string[][], columns: ColumnDetail[]): boolean {
  const first = rows[0]
  if (first === undefined) return false
  const names = new Set(columns.map((column) => column.name.trim().toLowerCase()))
  const cells = first.map((cell) => cell.trim())
  const unique = new Set(cells.map((cell) => cell.toLowerCase())).size === cells.length
  const matches = cells.some((cell) => names.has(cell.toLowerCase()))
  const numeric = cells.some((cell) => /^[-+]?\d+(?:\.\d+)?$/u.test(cell))
  return unique && (matches || !numeric)
}

/** One target column per source column, or null to skip it. */
export type ImportMapping = Array<string | null>

export function autoMapColumns(
  source: string[],
  columns: ColumnDetail[],
  hasHeader: boolean,
): ImportMapping {
  const used = new Set<string>()
  return source.map((header, index) => {
    const trimmed = hasHeader ? header.trim().toLowerCase() : ''
    const byName = trimmed === '' ? undefined : columns.find((column) => column.name.toLowerCase() === trimmed)
    if (byName !== undefined && !used.has(byName.name)) {
      used.add(byName.name)
      return byName.name
    }
    const byPosition = columns[index]
    if (byPosition !== undefined && !used.has(byPosition.name)) {
      used.add(byPosition.name)
      return byPosition.name
    }
    return null
  })
}

export type MappingIssue = 'no-target' | 'duplicate-target' | 'unknown-target'

export function validateMapping(mapping: ImportMapping, columns: ColumnDetail[]): MappingIssue | null {
  const known = new Set(columns.map((column) => column.name))
  const used = new Set<string>()
  let count = 0
  for (const target of mapping) {
    if (target === null || target === '') continue
    if (!known.has(target)) return 'unknown-target'
    if (used.has(target)) return 'duplicate-target'
    used.add(target)
    count += 1
  }
  return count === 0 ? 'no-target' : null
}

/** Rows that carry no mapped value at all are ignored (trailing separators). */
function emptyRow(row: string[], mapping: ImportMapping): boolean {
  return mapping.every((target, index) => target === null || (row[index] ?? '').trim() === '')
}

export function importRowCount(rows: string[][], hasHeader: boolean): number {
  return Math.max(rows.length - (hasHeader ? 1 : 0), 0)
}

/**
 * Batched INSERT statements; an empty cell becomes NULL. Each batch keeps the
 * mapped column list, so one statement can carry many rows without a round trip.
 */
export function buildInsertBatches(options: {
  dialect: SqlDialect
  schema: string
  table: string
  columns: ColumnDetail[]
  mapping: ImportMapping
  rows: string[][]
  hasHeader?: boolean
  batchSize?: number
}): string[] {
  const { dialect, schema, table, columns, mapping } = options
  const byName = new Map(columns.map((column) => [column.name, column]))
  const targets = mapping.flatMap((name, sourceIndex) => {
    const column = name === null ? undefined : byName.get(name)
    return column === undefined ? [] : [{ column, sourceIndex }]
  })
  if (targets.length === 0) return []
  const names = targets.map((entry) => quoteIdent(dialect, entry.column.name)).join(', ')
  const data = options.rows.slice(options.hasHeader === true ? 1 : 0).filter((row) => !emptyRow(row, mapping))
  const batchSize = Math.max(1, options.batchSize ?? 100)
  const statements: string[] = []
  for (let start = 0; start < data.length; start += batchSize) {
    const tuples = data.slice(start, start + batchSize).map((row) => {
      const values = targets.map(({ column, sourceIndex }) => {
        const text = (row[sourceIndex] ?? '').trim()
        return sqlValue(dialect, column, text === '' ? null : text)
      })
      return `  (${values.join(', ')})`
    })
    statements.push(
      `INSERT INTO ${qualifiedName(dialect, schema, table)} (${names}) VALUES\n${tuples.join(',\n')}`,
    )
  }
  return statements
}
