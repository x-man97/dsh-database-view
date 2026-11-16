/**
 * Copy result rows into another table: map source columns onto target columns
 * and emit batched INSERTs with the original typed values (NULL stays NULL).
 */
import type { ColumnInfo, Row, SqlDialect } from '../shared/types'
import { sqlValue } from './rowedit'
import { qualifiedName, quoteIdent } from './tablesql'

export type CopyMapping = Array<string | null>

export type CopyMappingIssue = 'no-target' | 'duplicate-target' | 'unknown-target'

export function validateCopyMapping(mapping: CopyMapping, targetColumns: ColumnInfo[]): CopyMappingIssue | null {
  const known = new Set(targetColumns.map((column) => column.name))
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

export function autoCopyMapping(sourceColumns: ColumnInfo[], targetColumns: ColumnInfo[]): CopyMapping {
  const targets = new Map(targetColumns.map((column) => [column.name.toLowerCase(), column.name]))
  const used = new Set<string>()
  return sourceColumns.map((column) => {
    const name = targets.get(column.name.toLowerCase())
    if (name === undefined || used.has(name)) return null
    used.add(name)
    return name
  })
}

export function buildCopyInsertBatches(options: {
  dialect: SqlDialect
  schema: string
  table: string
  sourceColumns: ColumnInfo[]
  targetColumns: ColumnInfo[]
  mapping: CopyMapping
  rows: Row[]
  batchSize?: number
}): string[] {
  const { dialect, schema, table, targetColumns, sourceColumns, mapping } = options
  const byName = new Map(targetColumns.map((column) => [column.name, column]))
  const targets = mapping.flatMap((name, sourceIndex) => {
    const column = name === null ? undefined : byName.get(name)
    return column === undefined ? [] : [{ column, sourceIndex }]
  })
  if (targets.length === 0 || options.rows.length === 0) return []
  const names = targets.map((entry) => quoteIdent(dialect, entry.column.name)).join(', ')
  const batchSize = Math.max(1, options.batchSize ?? 100)
  const statements: string[] = []
  for (let start = 0; start < options.rows.length; start += batchSize) {
    const tuples = options.rows.slice(start, start + batchSize).map((row) => {
      const values = targets.map(({ column, sourceIndex }) =>
        sqlValue(dialect, column, row[sourceIndex] ?? null),
      )
      return `  (${values.join(', ')})`
    })
    statements.push(
      `INSERT INTO ${qualifiedName(dialect, schema, table)} (${names}) VALUES\n${tuples.join(',\n')}`,
    )
  }
  return statements
}