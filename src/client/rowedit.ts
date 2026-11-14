import type { CellValue, ColumnInfo, SqlDialect } from '../shared/types'
import { isNumericType, quoteIdent, quoteLiteral, qualifiedName, temporalLiteral } from './tablesql'

export interface RowValue {
  column: ColumnInfo
  value: CellValue | null
}

export function sqlValue(dialect: SqlDialect, column: ColumnInfo, value: CellValue | null): string {
  if (value === null) return 'NULL'
  if (typeof value === 'boolean') {
    if (dialect === 'mysql' || dialect === 'mssql') return value ? '1' : '0'
    return value ? 'TRUE' : 'FALSE'
  }
  if (typeof value === 'number') return String(value)
  if (isNumericType(column.typeName) && /^[-+]?\d+(?:\.\d+)?$/u.test(value.trim())) return value.trim()
  if (dialect === 'oracle' && /date|time/i.test(column.typeName)) return temporalLiteral(dialect, column.typeName, value)
  return quoteLiteral(value, dialect)
}

export function whereForRow(
  dialect: SqlDialect,
  columns: ColumnInfo[],
  values: ReadonlyMap<string, CellValue | null>,
): string {
  return columns
    .map((column) => {
      const value = values.get(column.name) ?? null
      const ident = quoteIdent(dialect, column.name)
      return value === null ? `${ident} IS NULL` : `${ident} = ${sqlValue(dialect, column, value)}`
    })
    .join(' AND ')
}

export function insertRowSql(
  dialect: SqlDialect,
  schema: string,
  table: string,
  values: RowValue[],
): string {
  if (values.length === 0) throw new Error('至少选择一个要写入的列')
  const names = values.map((entry) => quoteIdent(dialect, entry.column.name)).join(', ')
  const literals = values.map((entry) => sqlValue(dialect, entry.column, entry.value)).join(', ')
  return `INSERT INTO ${qualifiedName(dialect, schema, table)} (${names}) VALUES (${literals})`
}

export function updateRowSql(
  dialect: SqlDialect,
  schema: string,
  table: string,
  values: RowValue[],
  keyColumns: ColumnInfo[],
  original: ReadonlyMap<string, CellValue | null>,
): string {
  if (values.length === 0) throw new Error('没有可修改的列')
  const sets = values.map((entry) => `${quoteIdent(dialect, entry.column.name)} = ${sqlValue(dialect, entry.column, entry.value)}`).join(', ')
  return `UPDATE ${qualifiedName(dialect, schema, table)} SET ${sets} WHERE ${whereForRow(dialect, keyColumns, original)}`
}

export function deleteRowSql(
  dialect: SqlDialect,
  schema: string,
  table: string,
  keyColumns: ColumnInfo[],
  original: ReadonlyMap<string, CellValue | null>,
): string {
  return `DELETE FROM ${qualifiedName(dialect, schema, table)} WHERE ${whereForRow(dialect, keyColumns, original)}`
}
