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
  /** Existing SQL Server default constraint, dropped when the default changes. */
  originalDefaultConstraint?: string
}

export interface TableIndexDraft {
  /** Set for indexes read from the server; undefined for new indexes. */
  originalName?: string
  name: string
  unique: boolean
  columns: string[]
}

export interface TableForeignKeyDraft {
  /** Set for foreign keys read from the server; undefined for new ones. */
  originalName?: string
  name: string
  columns: string[]
  referencedSchema: string
  referencedTable: string
  referencedColumns: string[]
  onDelete: string
  onUpdate: string
}

export interface TableDraft {
  schema: string
  table: string
  columns: TableColumnDraft[]
  indexes: TableIndexDraft[]
  foreignKeys: TableForeignKeyDraft[]
  /** Name of the existing primary-key constraint, when the server reported one. */
  primaryKeyName?: string
  /** Constraint-backed unique indexes that the editor must not change but a rebuild has to keep. */
  preservedIndexes?: TableIndexDraft[]
  /** Trigger definitions replayed after an engine rebuilds the table. */
  preservedTriggers?: string[]
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
  | 'foreign-key-name'
  | 'duplicate-foreign-key'
  | 'foreign-key-columns'
  | 'unknown-foreign-key-column'
  | 'foreign-key-target'
  | 'auto-increment'
  | 'identity-change'

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

function foreignKeyConstraintSql(fk: TableForeignKeyDraft, defaultSchema: string): string {
  const referencedSchema = fk.referencedSchema.trim() === '' ? defaultSchema : fk.referencedSchema.trim()
  const parts = [
    `CONSTRAINT ${quoteMysqlIdent(fk.name.trim())} FOREIGN KEY (${fk.columns.map(quoteMysqlIdent).join(', ')})`,
    `REFERENCES ${qualified(referencedSchema, fk.referencedTable.trim())} (${fk.referencedColumns.map(quoteMysqlIdent).join(', ')})`,
  ]
  if (fk.onDelete.trim() !== '') parts.push(`ON DELETE ${fk.onDelete.trim().toUpperCase()}`)
  if (fk.onUpdate.trim() !== '') parts.push(`ON UPDATE ${fk.onUpdate.trim().toUpperCase()}`)
  return parts.join(' ')
}

function foreignKeySignature(fk: TableForeignKeyDraft, defaultSchema: string): string {
  const referencedSchema = fk.referencedSchema.trim() === '' ? defaultSchema : fk.referencedSchema.trim()
  return [
    fk.name.trim(),
    fk.columns.join(','),
    referencedSchema,
    fk.referencedTable.trim(),
    fk.referencedColumns.join(','),
    fk.onDelete.trim().toUpperCase(),
    fk.onUpdate.trim().toUpperCase(),
  ].join('|')
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
  const primaryIndex = description.indexes.find((index) => index.primary === true)
  const renamableIndex = (index: TableDescription['indexes'][number]): boolean =>
    index.primary !== true &&
    index.columns.length > 0 &&
    (index.definition === undefined || !/\bWHERE\b/i.test(index.definition))
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
      ...(column.defaultConstraint === undefined ? {} : { originalDefaultConstraint: column.defaultConstraint }),
    })),
    indexes: description.indexes
      .filter((index) => index.constraint !== true && renamableIndex(index))
      .map((index) => ({
        originalName: index.name,
        name: index.name,
        unique: index.unique === true,
        columns: [...index.columns],
      })),
    foreignKeys: (description.foreignKeys ?? []).map((foreignKey) => ({
      originalName: foreignKey.name,
      name: foreignKey.name,
      columns: [...foreignKey.columns],
      referencedSchema: foreignKey.referencedSchema,
      referencedTable: foreignKey.referencedTable,
      referencedColumns: [...foreignKey.referencedColumns],
      onDelete: foreignKey.onDelete ?? 'RESTRICT',
      onUpdate: foreignKey.onUpdate ?? 'RESTRICT',
    })),
    ...(primaryIndex === undefined ? {} : { primaryKeyName: primaryIndex.name }),
    ...(() => {
      const preserved = description.indexes
        .filter((index) => index.constraint === true && index.primary !== true && renamableIndex(index))
        .map((index) => ({
          originalName: index.name,
          name: index.name,
          unique: index.unique === true,
          columns: [...index.columns],
        }))
      return preserved.length === 0 ? {} : { preservedIndexes: preserved }
    })(),
    ...(description.triggers === undefined || description.triggers.length === 0
      ? {}
      : { preservedTriggers: [...description.triggers] }),
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
  const foreignKeyNames = new Set<string>()
  for (const foreignKey of draft.foreignKeys ?? []) {
    const name = foreignKey.name.trim()
    if (name === '') return 'foreign-key-name'
    if (foreignKeyNames.has(name.toLowerCase())) return 'duplicate-foreign-key'
    foreignKeyNames.add(name.toLowerCase())
    if (foreignKey.columns.length === 0) return 'foreign-key-columns'
    for (const column of foreignKey.columns) {
      if (!names.has(column.trim().toLowerCase())) return 'unknown-foreign-key-column'
    }
    if (
      foreignKey.referencedTable.trim() === '' ||
      foreignKey.referencedColumns.length !== foreignKey.columns.length ||
      foreignKey.referencedColumns.some((column) => column.trim() === '')
    ) {
      return 'foreign-key-target'
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
  for (const foreignKey of draft.foreignKeys ?? []) {
    lines.push(`  ${foreignKeyConstraintSql(foreignKey, draft.schema)}`)
  }
  return `CREATE TABLE ${qualified(draft.schema, draft.table)} (\n${lines.join(',\n')}\n)`
}

/**
 * One or more ALTER TABLE statements needed to turn `original` into `next`.
 * Foreign-key drops go in their own statement: MySQL rejects dropping and
 * re-adding the same constraint name inside one ALTER. Returns [] when nothing
 * changed. Column renames are expressed as CHANGE.
 */
export function alterTableStatements(original: TableDraft, next: TableDraft): string[] {
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
  const nextForeignKeys = (next.foreignKeys ?? []).map((foreignKey) => ({
    ...foreignKey,
    columns: foreignKey.columns.map((column) => renames.get(column) ?? column),
  }))
  const originalIndexes = new Map(original.indexes.map((index) => [index.originalName ?? index.name, index]))
  const originalForeignKeys = new Map(
    (original.foreignKeys ?? []).map((foreignKey) => [foreignKey.originalName ?? foreignKey.name, foreignKey]),
  )

  const clauses: string[] = []
  const foreignDropClauses: string[] = []
  // Foreign keys go first: dropping a referenced column or index fails while
  // the constraint still exists.
  for (const foreignKey of original.foreignKeys ?? []) {
    const key = foreignKey.originalName ?? foreignKey.name
    const match = nextForeignKeys.find((entry) => (entry.originalName ?? entry.name) === key)
    if (match === undefined || foreignKeySignature(match, original.schema) !== foreignKeySignature(foreignKey, original.schema)) {
      foreignDropClauses.push(`DROP FOREIGN KEY ${quoteMysqlIdent(key)}`)
    }
  }
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

  const foreignAddClauses: string[] = []
  for (const foreignKey of nextForeignKeys) {
    const key = foreignKey.originalName ?? foreignKey.name
    const match = originalForeignKeys.get(key)
    if (match === undefined || foreignKeySignature(foreignKey, original.schema) !== foreignKeySignature(match, original.schema)) {
      foreignAddClauses.push(`ADD ${foreignKeyConstraintSql(foreignKey, original.schema)}`)
    }
  }

  const table = qualified(original.schema, original.table)
  const statements: string[] = []
  if (foreignDropClauses.length > 0) statements.push(`ALTER TABLE ${table}\n  ${foreignDropClauses.join(',\n  ')}`)
  if (clauses.length > 0) statements.push(`ALTER TABLE ${table}\n  ${clauses.join(',\n  ')}`)
  if (foreignAddClauses.length > 0) statements.push(`ALTER TABLE ${table}\n  ${foreignAddClauses.join(',\n  ')}`)
  return statements
}

/** Preview form: the statements joined by blank lines. */
export function alterTableSql(original: TableDraft, next: TableDraft): string {
  return alterTableStatements(original, next).join(';\n\n')
}

/** Dialects whose object designer this client can generate SQL for. */
export function supportsSqlDesign(dialect: string | undefined): boolean {
  return (
    dialect === 'mysql' ||
    dialect === 'postgres' ||
    dialect === 'sqlite' ||
    dialect === 'mssql' ||
    dialect === 'oracle'
  )
}

function quotePgIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

function quoteMssqlIdent(name: string): string {
  return `[${name.replaceAll(']', ']]')}]`
}

function quoteMssqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function qualifiedFor(dialect: string | undefined, schema: string, table: string): string {
  if (dialect === 'postgres' || dialect === 'sqlite' || dialect === 'oracle') {
    return `${quotePgIdent(schema)}.${quotePgIdent(table)}`
  }
  if (dialect === 'mssql') return `${quoteMssqlIdent(schema)}.${quoteMssqlIdent(table)}`
  return qualified(schema, table)
}

export function dropObjectSql(dialect: string | undefined, schema: string, table: string, kind: ObjectKind): string {
  return `DROP ${kind === 'view' ? 'VIEW' : 'TABLE'} ${qualifiedFor(dialect, schema, table)}`
}

export function renameTableSql(dialect: string | undefined, schema: string, table: string, nextName: string): string {
  const next = nextName.trim()
  if (dialect === 'postgres' || dialect === 'sqlite' || dialect === 'oracle') {
    return `ALTER TABLE ${qualifiedFor(dialect, schema, table)} RENAME TO ${quotePgIdent(next)}`
  }
  if (dialect === 'mssql') {
    return `EXEC sp_rename ${quoteMssqlLiteral(`${schema}.${table}`)}, ${quoteMssqlLiteral(next)}`
  }
  return `RENAME TABLE ${qualified(schema, table)} TO ${qualified(schema, next)}`
}
