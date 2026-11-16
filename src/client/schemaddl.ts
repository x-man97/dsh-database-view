/**
 * CREATE SCHEMA for the dialects where a schema is a plain namespace.
 *
 * MySQL calls it a database, PostgreSQL and SQL Server call it a schema.
 * SQLite has no schema creation and an Oracle schema is a user, so the action
 * stays hidden on those sources.
 */

export function supportsCreateSchema(dialect: string | undefined): boolean {
  return dialect === 'mysql' || dialect === 'postgres' || dialect === 'mssql'
}

/** User input ends up in the statement, so every quote flavour is doubled. */
function quoteName(dialect: 'mysql' | 'postgres' | 'mssql', name: string): string {
  if (dialect === 'mysql') return `\`${name.replaceAll('`', '``')}\``
  if (dialect === 'mssql') return `[${name.replaceAll(']', ']]')}]`
  return `"${name.replaceAll('"', '""')}"`
}

/** `null` when the dialect has no simple CREATE SCHEMA statement. */
export function createSchemaSql(dialect: string | undefined, name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return null
  if (dialect === 'mysql') return `CREATE DATABASE ${quoteName('mysql', trimmed)}`
  if (dialect === 'postgres') return `CREATE SCHEMA ${quoteName('postgres', trimmed)}`
  if (dialect === 'mssql') return `CREATE SCHEMA ${quoteName('mssql', trimmed)}`
  return null
}
