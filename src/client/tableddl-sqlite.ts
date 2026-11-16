/**
 * SQLite table DDL for the designer. SQLite can only alter a few column
 * properties in place, so every structural change rebuilds the table inside a
 * transaction, copying the shared columns and restoring indexes and triggers.
 */
import type { TableColumnDraft, TableDraft, TableForeignKeyDraft, TableIndexDraft, TableDraftIssue } from './tableddl'

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

function qualified(schema: string, table: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`
}

function columnDefault(column: TableColumnDraft): string | undefined {
  const value = column.defaultValue.trim()
  return value === '' ? undefined : value
}

function primaryKeyOf(draft: TableDraft): TableColumnDraft[] {
  return draft.columns.filter((column) => column.primaryKey)
}

function inlinePrimaryColumn(draft: TableDraft): TableColumnDraft | undefined {
  const primary = primaryKeyOf(draft)
  if (primary.length !== 1) return undefined
  const column = primary[0]
  if (column === undefined) return undefined
  return column.autoIncrement || column.typeName.trim().toUpperCase() === 'INTEGER' ? column : undefined
}

function columnDefinition(column: TableColumnDraft, inlinePrimary: boolean): string {
  const parts = [quoteIdent(column.name), column.typeName.trim() || 'TEXT']
  if (!column.nullable) parts.push('NOT NULL')
  const fallback = columnDefault(column)
  if (fallback !== undefined && !column.autoIncrement) parts.push(`DEFAULT ${fallback}`)
  if (inlinePrimary) parts.push(column.autoIncrement ? 'PRIMARY KEY AUTOINCREMENT' : 'PRIMARY KEY')
  return parts.join(' ')
}

function foreignKeySql(foreignKey: TableForeignKeyDraft): string {
  const parts = [
    `CONSTRAINT ${quoteIdent(foreignKey.name.trim())} FOREIGN KEY (${foreignKey.columns.map(quoteIdent).join(', ')})`,
    `REFERENCES ${quoteIdent(foreignKey.referencedTable.trim())} (${foreignKey.referencedColumns.map(quoteIdent).join(', ')})`,
  ]
  if (foreignKey.onDelete.trim() !== '') parts.push(`ON DELETE ${foreignKey.onDelete.trim().toUpperCase()}`)
  if (foreignKey.onUpdate.trim() !== '') parts.push(`ON UPDATE ${foreignKey.onUpdate.trim().toUpperCase()}`)
  return parts.join(' ')
}

function indexSql(table: string, index: TableIndexDraft): string {
  return `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdent(index.name)} ON ${quoteIdent(table)} (${index.columns.map(quoteIdent).join(', ')})`
}

function preservedIndexSql(table: string, index: TableIndexDraft): string | null {
  if (index.name.startsWith('sqlite_autoindex_')) return null
  return indexSql(table, index)
}

function tableBody(draft: TableDraft): string {
  const inline = inlinePrimaryColumn(draft)
  const lines = draft.columns.map((column) => `  ${columnDefinition(column, column === inline)}`)
  const primary = primaryKeyOf(draft)
  if (inline === undefined && primary.length > 0) {
    lines.push(`  PRIMARY KEY (${primary.map((column) => quoteIdent(column.name)).join(', ')})`)
  }
  for (const index of draft.preservedIndexes ?? []) {
    if (index.name.startsWith('sqlite_autoindex_')) {
      lines.push(`  UNIQUE (${index.columns.map(quoteIdent).join(', ')})`)
    }
  }
  for (const foreignKey of draft.foreignKeys ?? []) lines.push(`  ${foreignKeySql(foreignKey)}`)
  return lines.join(',\n')
}

export function createSqliteTableSql(draft: TableDraft, table = draft.table): string {
  return `CREATE TABLE ${quoteIdent(table)} (\n${tableBody(draft)}\n)`
}

export function createSqliteTableStatements(draft: TableDraft): string[] {
  const statements = [createSqliteTableSql(draft)]
  for (const index of draft.indexes) statements.push(indexSql(draft.table, index))
  for (const index of draft.preservedIndexes ?? []) {
    const sql = preservedIndexSql(draft.table, index)
    if (sql !== null) statements.push(sql)
  }
  return statements
}

function columnShape(draft: TableDraft): string {
  return JSON.stringify(
    draft.columns.map((column) => [
      column.name,
      column.typeName.trim().toLowerCase(),
      column.nullable,
      columnDefault(column) ?? '',
      column.autoIncrement,
      column.primaryKey,
    ]),
  )
}

function foreignKeySignature(foreignKey: TableForeignKeyDraft): string {
  return [
    foreignKey.name.trim(),
    foreignKey.columns.join(','),
    foreignKey.referencedTable.trim(),
    foreignKey.referencedColumns.join(','),
    foreignKey.onDelete.trim().toUpperCase(),
    foreignKey.onUpdate.trim().toUpperCase(),
  ].join('|')
}

function tableShape(draft: TableDraft): string {
  return JSON.stringify({
    columns: columnShape(draft),
    foreignKeys: (draft.foreignKeys ?? []).map(foreignKeySignature).sort(),
  })
}

function indexSignature(index: TableIndexDraft): string {
  return `${index.name}:${index.unique ? 'unique' : 'index'}:${index.columns.join(',')}`
}

/**
 * Trigger bodies are stored as text and are dropped with the table during a
 * rebuild. Rewrite renamed column identifiers outside string literals so the
 * recreated trigger still compiles.
 */
function rewriteTrigger(sql: string, renames: Map<string, string>, lookup: Map<string, string>): string {
  if (lookup.size === 0) return sql
  const replaceCode = (code: string): string => {
    const quoted = code.replace(/(["`])([^"`]+)\1|\[([^\]]+)\]/g, (match, quote: string | undefined, doubleQuoted: string | undefined, bracketed: string | undefined) => {
      const name = doubleQuoted ?? bracketed ?? ''
      const next = lookup.get(name.toLowerCase())
      if (next === undefined) return match
      return quote === undefined || quote === '' ? `[${next}]` : `${quote}${next}${quote}`
    })
    const pattern = new RegExp(`\\b(${[...renames.keys()].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi')
    return quoted.replace(pattern, (match) => lookup.get(match.toLowerCase()) ?? match)
  }
  let result = ''
  let codeStart = 0
  let index = 0
  while (index < sql.length) {
    if (sql[index] !== "'") {
      index += 1
      continue
    }
    result += replaceCode(sql.slice(codeStart, index))
    const literalStart = index
    index += 1
    while (index < sql.length) {
      if (sql[index] === "'") {
        if (sql[index + 1] === "'") {
          index += 2
          continue
        }
        index += 1
        break
      }
      index += 1
    }
    result += sql.slice(literalStart, index)
    codeStart = index
  }
  return result + replaceCode(sql.slice(codeStart))
}

function rebuildStatements(original: TableDraft, next: TableDraft): string[] {
  const temporary = `${original.table}__dsh_new`
  const renames = new Map<string, string>()
  for (const column of next.columns) {
    if (column.originalName !== undefined && column.originalName !== column.name) {
      renames.set(column.originalName, column.name)
    }
  }
  const renameLookup = new Map([...renames].map(([from, to]) => [from.toLowerCase(), to]))
  const originalNames = new Set(original.columns.map((column) => column.originalName ?? column.name))
  const nextIndexes = next.indexes.map((index) => ({
    ...index,
    columns: index.columns.map((column) => renames.get(column) ?? column),
  }))
  const nextForeignKeys = (next.foreignKeys ?? []).map((foreignKey) => ({
    ...foreignKey,
    columns: foreignKey.columns.map((column) => renames.get(column) ?? column),
  }))
  const translateIndex = (index: TableIndexDraft): TableIndexDraft => ({
    ...index,
    columns: index.columns.map((column) => renames.get(column) ?? column),
  })
  const rebuilt: TableDraft = {
    ...next,
    table: temporary,
    indexes: nextIndexes,
    foreignKeys: nextForeignKeys,
    preservedIndexes: [
      ...(next.preservedIndexes ?? []).map(translateIndex),
      ...(original.preservedIndexes ?? [])
        .filter((index) => !(next.preservedIndexes ?? []).some((entry) => entry.name === index.name))
        .map(translateIndex),
    ],
  }
  const statements = ['PRAGMA foreign_keys = OFF', 'BEGIN TRANSACTION', createSqliteTableSql(rebuilt, temporary)]
  const sourceColumns: string[] = []
  const targetColumns: string[] = []
  for (const column of next.columns) {
    const originalName = column.originalName
    if (originalName === undefined || !originalNames.has(originalName)) continue
    sourceColumns.push(quoteIdent(originalName))
    targetColumns.push(quoteIdent(column.name))
  }
  if (sourceColumns.length > 0) {
    statements.push(
      `INSERT INTO ${quoteIdent(temporary)} (${targetColumns.join(', ')}) SELECT ${sourceColumns.join(', ')} FROM ${quoteIdent(original.table)}`,
    )
  }
  statements.push(`DROP TABLE ${quoteIdent(original.table)}`)
  statements.push(`ALTER TABLE ${quoteIdent(temporary)} RENAME TO ${quoteIdent(original.table)}`)
  for (const index of nextIndexes) statements.push(indexSql(original.table, index))
  for (const index of rebuilt.preservedIndexes ?? []) {
    const sql = preservedIndexSql(original.table, index)
    if (sql !== null) statements.push(sql)
  }
  for (const trigger of next.preservedTriggers ?? original.preservedTriggers ?? []) {
    statements.push(rewriteTrigger(trigger.replace(/;\s*$/u, ''), renames, renameLookup))
  }
  statements.push('COMMIT', 'PRAGMA foreign_keys = ON')
  return statements
}

export function alterSqliteTableStatements(original: TableDraft, next: TableDraft): string[] {
  if (tableShape(original) === tableShape(next)) {
    const originalIndexes = new Map(original.indexes.map((index) => [index.originalName ?? index.name, index]))
    const statements: string[] = []
    for (const index of original.indexes) {
      const key = index.originalName ?? index.name
      const match = next.indexes.find((entry) => (entry.originalName ?? entry.name) === key)
      if (match === undefined || indexSignature(match) !== indexSignature(index)) {
        statements.push(`DROP INDEX ${quoteIdent(key)}`)
      }
    }
    const nextIndexes = next.indexes.map((index) => {
      const renames = new Map<string, string>()
      for (const column of next.columns) {
        if (column.originalName !== undefined && column.originalName !== column.name) renames.set(column.originalName, column.name)
      }
      return { ...index, columns: index.columns.map((column) => renames.get(column) ?? column) }
    })
    for (const index of nextIndexes) {
      const key = index.originalName ?? index.name
      const match = originalIndexes.get(key)
      if (match === undefined || indexSignature(match) !== indexSignature(index)) {
        statements.push(indexSql(original.table, index))
      }
    }
    return statements
  }
  return rebuildStatements(original, next)
}

/** SQLite only supports AUTOINCREMENT on a single INTEGER primary key. */
export function validateSqliteDraft(draft: TableDraft): TableDraftIssue | null {
  const primary = primaryKeyOf(draft)
  const identity = draft.columns.filter((column) => column.autoIncrement)
  if (identity.length === 0) return null
  if (identity.length > 1) return 'auto-increment'
  const column = identity[0]
  if (column === undefined || primary.length !== 1 || !column.primaryKey) return 'auto-increment'
  if (column.typeName.trim().toUpperCase() !== 'INTEGER') return 'auto-increment'
  return null
}