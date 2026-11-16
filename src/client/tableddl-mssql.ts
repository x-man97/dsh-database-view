/**
 * SQL Server table DDL for the designer: named default constraints, extended
 * properties for comments, IDENTITY columns and sp_rename for renames.
 */
import type {
  TableColumnDraft,
  TableDraft,
  TableDraftIssue,
  TableForeignKeyDraft,
  TableIndexDraft,
} from './tableddl'

function quoteIdent(name: string): string {
  return `[${name.replaceAll(']', ']]')}]`
}

function qualified(schema: string, table: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`
}

function stringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function defaultConstraintName(table: string, column: string): string {
  return `DF_${table}_${column}`.slice(0, 120)
}

function columnDefault(column: TableColumnDraft): string | undefined {
  const value = column.defaultValue.trim()
  return value === '' ? undefined : value
}

function columnDefinition(column: TableColumnDraft, table: string): string {
  const parts = [quoteIdent(column.name), column.typeName.trim() || 'nvarchar(255)']
  if (column.autoIncrement) {
    parts.push('IDENTITY(1,1)', 'NOT NULL')
  } else {
    const fallback = columnDefault(column)
    if (fallback !== undefined) {
      const constraintName = column.originalDefaultConstraint ?? defaultConstraintName(table, column.name)
      parts.push(`CONSTRAINT ${quoteIdent(constraintName)} DEFAULT ${fallback}`)
    }
    if (!column.nullable) parts.push('NOT NULL')
  }
  return parts.join(' ')
}

function primaryKeyOf(draft: TableDraft): string[] {
  return draft.columns.filter((column) => column.primaryKey).map((column) => column.name)
}

function actionSql(action: string): string {
  const upper = action.trim().toUpperCase()
  return upper === '' || upper === 'RESTRICT' ? 'NO ACTION' : upper
}

function foreignKeySql(foreignKey: TableForeignKeyDraft, defaultSchema: string): string {
  const referencedSchema = foreignKey.referencedSchema.trim() === '' ? defaultSchema : foreignKey.referencedSchema.trim()
  const parts = [
    `CONSTRAINT ${quoteIdent(foreignKey.name.trim())} FOREIGN KEY (${foreignKey.columns.map(quoteIdent).join(', ')})`,
    `REFERENCES ${qualified(referencedSchema, foreignKey.referencedTable.trim())} (${foreignKey.referencedColumns.map(quoteIdent).join(', ')})`,
  ]
  if (foreignKey.onDelete.trim() !== '') parts.push(`ON DELETE ${actionSql(foreignKey.onDelete)}`)
  if (foreignKey.onUpdate.trim() !== '') parts.push(`ON UPDATE ${actionSql(foreignKey.onUpdate)}`)
  return parts.join(' ')
}

function indexSql(schema: string, table: string, index: TableIndexDraft): string {
  return `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdent(index.name)} ON ${qualified(schema, table)} (${index.columns.map(quoteIdent).join(', ')})`
}

function commentTargets(schema: string, table: string, column?: string): string {
  const parts = [
    `@level0type=N'SCHEMA', @level0name=N${stringLiteral(schema)}`,
    `@level1type=N'TABLE', @level1name=N${stringLiteral(table)}`,
  ]
  if (column !== undefined) parts.push(`@level2type=N'COLUMN', @level2name=N${stringLiteral(column)}`)
  return parts.join(', ')
}

function addCommentSql(schema: string, table: string, column: string, comment: string): string {
  return `EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=N${stringLiteral(comment)}, ${commentTargets(schema, table, column)}`
}

function updateCommentSql(schema: string, table: string, column: string, comment: string): string {
  return `EXEC sys.sp_updateextendedproperty @name=N'MS_Description', @value=N${stringLiteral(comment)}, ${commentTargets(schema, table, column)}`
}

function dropCommentSql(schema: string, table: string, column: string): string {
  return `EXEC sys.sp_dropextendedproperty @name=N'MS_Description', ${commentTargets(schema, table, column)}`
}

export function createMssqlTableStatements(draft: TableDraft): string[] {
  const lines = draft.columns.map((column) => `  ${columnDefinition(column, draft.table)}`)
  const primary = primaryKeyOf(draft)
  if (primary.length > 0) {
    const named = draft.primaryKeyName === undefined ? '' : `CONSTRAINT ${quoteIdent(draft.primaryKeyName)} `
    lines.push(`  ${named}PRIMARY KEY (${primary.map(quoteIdent).join(', ')})`)
  }
  for (const index of draft.preservedIndexes ?? []) {
    lines.push(`  CONSTRAINT ${quoteIdent(index.name)} UNIQUE (${index.columns.map(quoteIdent).join(', ')})`)
  }
  for (const foreignKey of draft.foreignKeys ?? []) lines.push(`  ${foreignKeySql(foreignKey, draft.schema)}`)
  const statements = [`CREATE TABLE ${qualified(draft.schema, draft.table)} (\n${lines.join(',\n')}\n)`]
  for (const index of draft.indexes) statements.push(indexSql(draft.schema, draft.table, index))
  for (const column of draft.columns) {
    if (column.comment !== '') statements.push(addCommentSql(draft.schema, draft.table, column.name, column.comment))
  }
  return statements
}

function indexSignature(index: TableIndexDraft): string {
  return `${index.name}:${index.unique ? 'unique' : 'index'}:${index.columns.join(',')}`
}

function foreignKeySignature(foreignKey: TableForeignKeyDraft, defaultSchema: string): string {
  const referencedSchema = foreignKey.referencedSchema.trim() === '' ? defaultSchema : foreignKey.referencedSchema.trim()
  return [
    foreignKey.name.trim(),
    foreignKey.columns.join(','),
    referencedSchema,
    foreignKey.referencedTable.trim(),
    foreignKey.referencedColumns.join(','),
    actionSql(foreignKey.onDelete),
    actionSql(foreignKey.onUpdate),
  ].join('|')
}

export function alterMssqlTableStatements(original: TableDraft, next: TableDraft): string[] {
  const table = qualified(original.schema, original.table)
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
  const originalColumns = new Map(original.columns.map((column) => [column.originalName ?? column.name, column]))
  const originalIndexes = new Map(original.indexes.map((index) => [index.originalName ?? index.name, index]))
  const originalForeignKeys = new Map(
    (original.foreignKeys ?? []).map((foreignKey) => [foreignKey.originalName ?? foreignKey.name, foreignKey]),
  )
  const nextOriginalNames = new Set(next.columns.map((column) => column.originalName ?? column.name))
  const statements: string[] = []

  for (const foreignKey of original.foreignKeys ?? []) {
    const key = foreignKey.originalName ?? foreignKey.name
    const match = nextForeignKeys.find((entry) => (entry.originalName ?? entry.name) === key)
    if (match === undefined || foreignKeySignature(match, original.schema) !== foreignKeySignature(foreignKey, original.schema)) {
      statements.push(`ALTER TABLE ${table} DROP CONSTRAINT ${quoteIdent(key)}`)
    }
  }

  for (const index of original.indexes) {
    const key = index.originalName ?? index.name
    const match = nextIndexes.find((entry) => (entry.originalName ?? entry.name) === key)
    if (match === undefined || indexSignature(match) !== indexSignature(index)) {
      statements.push(`DROP INDEX ${quoteIdent(key)} ON ${table}`)
    }
  }

  const originalPrimary = primaryKeyOf(original)
  const nextPrimary = primaryKeyOf(next)
  const primaryChanged = originalPrimary.join(',') !== nextPrimary.join(',')
  if (primaryChanged && originalPrimary.length > 0) {
    const name = original.primaryKeyName ?? `PK_${original.table}`
    statements.push(`ALTER TABLE ${table} DROP CONSTRAINT ${quoteIdent(name)}`)
  }

  for (const column of next.columns) {
    const previous = column.originalName === undefined ? undefined : originalColumns.get(column.originalName)
    if (previous === undefined) continue
    if (previous.defaultValue.trim() !== column.defaultValue.trim()) {
      if (previous.originalDefaultConstraint !== undefined) {
        statements.push(`ALTER TABLE ${table} DROP CONSTRAINT ${quoteIdent(previous.originalDefaultConstraint)}`)
      }
    }
  }

  for (const column of next.columns) {
    if (column.originalName !== undefined && column.originalName !== column.name) {
      const target = `${quoteIdent(original.schema)}.${quoteIdent(original.table)}.${quoteIdent(column.originalName)}`
      statements.push(`EXEC sp_rename ${stringLiteral(target)}, ${stringLiteral(column.name)}, N'COLUMN'`)
    }
  }

  for (const column of original.columns) {
    if (!nextOriginalNames.has(column.originalName ?? column.name)) {
      statements.push(`ALTER TABLE ${table} DROP COLUMN ${quoteIdent(column.originalName ?? column.name)}`)
    }
  }

  for (const column of next.columns) {
    if (column.originalName === undefined) {
      statements.push(`ALTER TABLE ${table} ADD ${columnDefinition(column, original.table)}`)
    }
  }

  for (const column of next.columns) {
    const previous = column.originalName === undefined ? undefined : originalColumns.get(column.originalName)
    if (previous === undefined) continue
    const typeChanged = previous.typeName.trim().toLowerCase() !== column.typeName.trim().toLowerCase()
    const nullableChanged = previous.nullable !== column.nullable
    if (typeChanged || nullableChanged) {
      const nullability = column.autoIncrement || !column.nullable ? 'NOT NULL' : 'NULL'
      statements.push(`ALTER TABLE ${table} ALTER COLUMN ${quoteIdent(column.name)} ${column.typeName.trim() || 'nvarchar(255)'} ${nullability}`)
    }
  }

  for (const column of next.columns) {
    const previous = column.originalName === undefined ? undefined : originalColumns.get(column.originalName)
    if (previous === undefined) continue
    const fallback = columnDefault(column)
    if (fallback !== undefined && fallback !== columnDefault(previous)) {
      const constraintName = previous.originalDefaultConstraint ?? defaultConstraintName(original.table, column.name)
      statements.push(`ALTER TABLE ${table} ADD CONSTRAINT ${quoteIdent(constraintName)} DEFAULT ${fallback} FOR ${quoteIdent(column.name)}`)
    }
  }

  if (primaryChanged && nextPrimary.length > 0) {
    const name = original.primaryKeyName ?? `PK_${original.table}`
    statements.push(`ALTER TABLE ${table} ADD CONSTRAINT ${quoteIdent(name)} PRIMARY KEY (${nextPrimary.map(quoteIdent).join(', ')})`)
  }

  for (const index of nextIndexes) {
    const key = index.originalName ?? index.name
    const match = originalIndexes.get(key)
    if (match === undefined || indexSignature(match) !== indexSignature(index)) {
      statements.push(indexSql(original.schema, original.table, index))
    }
  }

  for (const foreignKey of nextForeignKeys) {
    const key = foreignKey.originalName ?? foreignKey.name
    const match = originalForeignKeys.get(key)
    if (match === undefined || foreignKeySignature(foreignKey, original.schema) !== foreignKeySignature(match, original.schema)) {
      statements.push(`ALTER TABLE ${table} ADD ${foreignKeySql(foreignKey, original.schema)}`)
    }
  }

  for (const column of next.columns) {
    const previous = column.originalName === undefined ? undefined : originalColumns.get(column.originalName)
    const before = previous?.comment ?? ''
    if (before === column.comment) continue
    if (column.comment === '') {
      if (before !== '') statements.push(dropCommentSql(original.schema, original.table, column.name))
    } else if (before === '') {
      statements.push(addCommentSql(original.schema, original.table, column.name, column.comment))
    } else {
      statements.push(updateCommentSql(original.schema, original.table, column.name, column.comment))
    }
  }

  return statements
}

/** SQL Server cannot add or remove IDENTITY after a table exists. */
export function validateMssqlDraft(original: TableDraft | null, next: TableDraft): TableDraftIssue | null {
  const identity = next.columns.filter((column) => column.autoIncrement)
  if (identity.length > 1) return 'auto-increment'
  if (original === null) return null
  const previous = new Map(original.columns.map((column) => [column.originalName ?? column.name, column]))
  for (const column of next.columns) {
    if (column.originalName === undefined) continue
    const before = previous.get(column.originalName)
    if (before !== undefined && before.autoIncrement !== column.autoIncrement) return 'identity-change'
  }
  return null
}