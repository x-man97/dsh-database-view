/**
 * SQL Generator: build one DDL script for a set of tables and views. Server
 * DDL is preferred because it preserves engine-specific clauses; dialects
 * without a server-side CREATE TABLE fall back to the table-designer builders.
 */
import type { ClientConnection, ObjectKind, SchemaObject } from '../shared/types'
import { api } from './api'
import { dropObjectSql, supportsSqlDesign, tableDraftFromDescription } from './tableddl'
import { createTableStatements as createPgTableStatements } from './tableddl-pg'
import { createSqliteTableStatements } from './tableddl-sqlite'
import { createMssqlTableStatements } from './tableddl-mssql'
import { createOracleTableStatements } from './tableddl-oracle'

export interface GeneratedEntry {
  schema: string
  object: SchemaObject
  ddl: string
}

function ensureSemicolon(sql: string): string {
  const text = sql.trim()
  return text.endsWith(';') ? text : `${text};`
}

/** Join generated DDL into one script, optionally preceded by DROP statements. */
export function composeScript(
  dialect: string | undefined,
  entries: GeneratedEntry[],
  includeDrop: boolean,
): string {
  const parts: string[] = []
  for (const entry of entries) {
    const ddl = entry.ddl.trim()
    if (ddl === '') continue
    parts.push(`-- ${entry.schema}.${entry.object.name}`)
    if (includeDrop) {
      const kind: ObjectKind = entry.object.kind === 'view' ? 'view' : 'table'
      parts.push(`${ensureSemicolon(dropObjectSql(dialect, entry.schema, entry.object.name, kind))}`)
    }
    parts.push(ensureSemicolon(ddl), '')
  }
  return parts.join('\n').trimEnd()
}

export async function generateObjectDdl(
  connection: ClientConnection,
  schema: string,
  object: SchemaObject,
): Promise<string> {
  const kind: ObjectKind = object.kind === 'view' ? 'view' : 'table'
  // SQLite's sqlite_master text has no indexes or triggers and Oracle's
  // DBMS_METADATA table DDL omits standalone indexes, comments and foreign
  // keys, so rebuild full CREATE scripts from the structure for those.
  const usesBuilder = kind === 'table' && (connection.dialect === 'sqlite' || connection.dialect === 'oracle')
  const result = usesBuilder ? undefined : await api.ddl(connection.id, schema, object.name, kind)
  if (result !== undefined && (kind === 'view' || result.source === 'server')) {
    const ddl = result.ddl.trim()
    if (ddl === '') throw new Error('server returned empty DDL')
    return ddl
  }
  if (!supportsSqlDesign(connection.dialect)) throw new Error('dialect does not support SQL generation')
  const description = await api.describe(connection.id, schema, object.name, 'table')
  const draft = tableDraftFromDescription(description)
  const statements =
    connection.dialect === 'postgres'
      ? createPgTableStatements(draft)
      : connection.dialect === 'sqlite'
        ? createSqliteTableStatements(draft)
        : connection.dialect === 'mssql'
          ? createMssqlTableStatements(draft)
          : connection.dialect === 'oracle'
            ? createOracleTableStatements(draft)
            : [result?.ddl ?? '']
  return [...statements, ...(description.triggers ?? [])].join(';\n\n')
}