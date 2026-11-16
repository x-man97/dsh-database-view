/**
 * Table designer SQL for MySQL: render a table draft as CREATE TABLE, diff two
 * drafts into one ALTER TABLE, and cover the drop/rename operations. The editor
 * works on drafts so previews stay instant and no extra host endpoint is needed.
 */
import type { ObjectKind, TableDescription } from '../shared/types'

export interface TableColumnDraft {
  /** Set for columns read from the server; undefined for new columns. */
  originalName?: string
  name: string
  typeName: string
  nullable: boolean
  defaultValue: string
  comment: string
  autoIncrement: boolean
  primaryKey: boolean
}

export interface TableIndexDraft {
  /** Set for indexes read from the server; undefined for new indexes. */
  originalName?: string
  name: string
  unique: boolean
  columns: string[]
}

export interface TableDraft {
  schema: string
  table: string
  columns: TableColumnDraft[]
  indexes: TableIndexDraft[]
}

export type TableDraftIssue =
  | 'table-name'
  | 'no-columns'
  | 'column-name'
  | 'duplicate-column'
  | 'column-type'
  | 'index-name'
  | 'duplicate-index'
  | 'index-columns'
  | 'unknown-index-column'

/** Identifiers are always backtick-quoted; embedded backticks are doubled. */
export function quoteMysqlIdent(name: string): string {
  return `\`${name.replaceAll('`', '``')}\``
}

function qualified(schema: string, table: string): string {
  return `${quoteMysqlIdent(schema)}.${quoteMysqlIdent(table)}`
}

function stringLiteral(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
}

const RAW_DEFAULT =
  /^(?:null|true|false|current_timestamp(?:\(\d*\))?|current_date|current_time|localtimestamp(?:\(\d*\))?|[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?|b'[01]+'|x'[0-9a-f]+')$/i
const NUMERIC_TYPE = /\b(?:tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|bit|year)\b/i

/**
 * `information_schema` returns literal defaults without quotes, so a value that
 * is not a keyword or number is re-quoted unless the type is numeric.
 */
export function defaultValueSql(value: string, typeName: string): string | undefined {
  const text = value.trim()
  if (text === '') return undefined
  if (RAW_DEFAULT.test(text)) return text
  if (NUMERIC_TYPE.test(typeName) && /^[+-]?\d+(?:\.\d+)?$/.test(text)) return text
  return stringLiteral(text)
}

function columnDefinition(column: TableColumnDraft): string {
  const parts = [quoteMysqlIdent(column.name), column.typeName.trim()]
  if (!column.nullable) parts.push('NOT NULL')
  const fallback = defaultValueSql(column.defaultValue, column.typeName)
  if (fallback !== undefined) parts.push(`DEFAULT ${fallback}`)
  if (column.autoIncrement) parts.push('AUTO_INCREMENT')
  const comment = column.comment.trim()
  if (comment !== '') parts.push(`COMMENT ${stringLiteral(comment)}`)
  return parts.join(' ')
}

function sameColumn(left: TableColumnDraft, right: TableColumnDraft): boolean {
  // The primary key is emitted as its own table-level clause, so toggling it
  // must not also send a no-op CHANGE for every column it belongs to.
  return (
    left.name === right.name &&
    left.typeName.trim().toLowerCase() === right.typeName.trim().toLowerCase() &&
    left.nullable === right.nullable &&
    left.defaultValue.trim() === right.defaultValue.trim() &&
    left.comment === right.comment &&
    left.autoIncrement === right.autoIncrement
  )
}

function primaryKeyOf(draft: TableDraft): string[] {
  return draft.columns.filter((column) => column.primaryKey).map((column) => column.name)
}

function indexSignature(index: TableIndexDraft): string {
  return `${index.name}:${index.unique ? 'unique' : 'index'}:${index.columns.join(',')}`
}

/** Build the editable draft from the structure the server described. */
export function tableDraftFromDescription(description: TableDescription): TableDraft {
  return {
    schema: description.schema,
    table: description.table,
    columns: description.columns.map((column) => ({
      originalName: column.name,
      name: column.name,
      typeName: column.typeName,
      nullable: column.nullable !== false,
      defaultValue: column.defaultValue ?? '',
      comment: column.comment ?? '',
      autoIncrement: column.autoIncrement === true,
      primaryKey: column.primaryKey === true,
    })),
    indexes: description.indexes
      .filter((index) => index.primary !== true)
      .map((index) => ({
        originalName: index.name,
        name: index.name,
        unique: index.unique === true,
        columns: [...index.columns],
      })),
  }
}

export function validateTableDraft(draft: TableDraft, requireTableName = true): TableDraftIssue | null {
  if (requireTableName && draft.table.trim() === '') return 'table-name'
  if (draft.columns.length === 0) return 'no-columns'
  const names = new Set<string>()
  for (const column of draft.columns) {
    const name = column.name.trim()
    if (name === '') return 'column-name'
    if (names.has(name.toLowerCase())) return 'duplicate-column'
    names.add(name.toLowerCase())
    if (column.typeName.trim() === '') return 'column-type'
  }
  const indexNames = new Set<string>()
  for (const index of draft.indexes) {
    const name = index.name.trim()
    if (name === '') return 'index-name'
    if (indexNames.has(name.toLowerCase())) return 'duplicate-index'
    indexNames.add(name.toLowerCase())
    if (index.columns.length === 0) return 'index-columns'
    for (const column of index.columns) {
      if (!names.has(column.trim().toLowerCase())) return 'unknown-index-column'
    }
  }
  return null
}

export function createTableSql(draft: TableDraft): string {
  const lines = draft.columns.map((column) => `  ${columnDefinition(column)}`)
  const primary = primaryKeyOf(draft)
  if (primary.length > 0) lines.push(`  PRIMARY KEY (${primary.map(quoteMysqlIdent).join(', ')})`)
  for (const index of draft.indexes) {
    lines.push(
      `  ${index.unique ? 'UNIQUE ' : ''}INDEX ${quoteMysqlIdent(index.name)} (${index.columns.map(quoteMysqlIdent).join(', ')})`,
    )
  }
  return `CREATE TABLE ${qualified(draft.schema, draft.table)} (\n${lines.join(',\n')}\n)`
}

/**
 * One ALTER TABLE with the clauses needed to turn `original` into `next`.
 * Returns '' when nothing changed. Column renames are expressed as CHANGE.
 */
export function alterTableSql(original: TableDraft, next: TableDraft): string {
  const originalColumns = new Map(original.columns.map((column) => [column.originalName ?? column.name, column]))
  const nextOriginalNames = new Set(next.columns.map((column) => column.originalName ?? column.name))
  // Index text the user did not edit still references the old column name after
  // a rename; translate it before comparing and emitting.
  const renames = new Map<string, string>()
  for (const column of next.columns) {
    if (column.originalName !== undefined && column.originalName !== column.name) renames.set(column.originalName, column.name)
  }
  const nextIndexes = next.indexes.map((index) => ({
    ...index,
    columns: index.columns.map((column) => renames.get(column) ?? column),
  }))
  const originalIndexes = new Map(original.indexes.map((index) => [index.originalName ?? index.name, index]))

  const clauses: string[] = []
  for (const index of original.indexes) {
    const key = index.originalName ?? index.name
    const match = nextIndexes.find((entry) => (entry.originalName ?? entry.name) === key)
    if (match === undefined || indexSignature(match) !== indexSignature(index)) {
      clauses.push(`DROP INDEX ${quoteMysqlIdent(key)}`)
    }
  }

  const originalPrimary = primaryKeyOf(original)
  const nextPrimary = primaryKeyOf(next)
  const primaryChanged = originalPrimary.join(',') !== nextPrimary.join(',')
  if (primaryChanged && originalPrimary.length > 0) clauses.push('DROP PRIMARY KEY')

  for (const column of original.columns) {
    if (!nextOriginalNames.has(column.originalName ?? column.name)) {
      clauses.push(`DROP COLUMN ${quoteMysqlIdent(column.originalName ?? column.name)}`)
    }
  }

  for (const column of next.columns) {
    const previous = column.originalName === undefined ? undefined : originalColumns.get(column.originalName)
    if (previous === undefined) {
      clauses.push(`ADD COLUMN ${columnDefinition(column)}`)
      continue
    }
    if (!sameColumn(previous, column)) {
      clauses.push(`CHANGE COLUMN ${quoteMysqlIdent(previous.name)} ${columnDefinition(column)}`)
    }
  }

  if (primaryChanged && nextPrimary.length > 0) {
    clauses.push(`ADD PRIMARY KEY (${nextPrimary.map(quoteMysqlIdent).join(', ')})`)
  }

  for (const index of nextIndexes) {
    const key = index.originalName ?? index.name
    const match = originalIndexes.get(key)
    if (match === undefined || indexSignature(match) !== indexSignature(index)) {
      clauses.push(
        `ADD ${index.unique ? 'UNIQUE ' : ''}INDEX ${quoteMysqlIdent(index.name)} (${index.columns.map(quoteMysqlIdent).join(', ')})`,
      )
    }
  }

  if (clauses.length === 0) return ''
  return `ALTER TABLE ${qualified(original.schema, original.table)}\n  ${clauses.join(',\n  ')}`
}

export function dropObjectSql(schema: string, table: string, kind: ObjectKind): string {
  return `DROP ${kind === 'view' ? 'VIEW' : 'TABLE'} ${qualified(schema, table)}`
}

export function renameTableSql(schema: string, table: string, nextName: string): string {
  return `RENAME TABLE ${qualified(schema, table)} TO ${qualified(schema, nextName.trim())}`
}
