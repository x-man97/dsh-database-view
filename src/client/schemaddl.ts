/**
 * Schema DDL for the dialects where a schema is a plain namespace.
 *
 * MySQL calls it a database, PostgreSQL and SQL Server call it a schema.
 * SQLite has no schema creation and an Oracle schema is a user, so both
 * CREATE and DROP stay hidden on those sources.
 */

export function supportsSchemaDdl(dialect: string | undefined): boolean {
  return dialect === 'mysql' || dialect === 'postgres' || dialect === 'mssql'
}

/** User input ends up in the statement, so every quote flavour is doubled. */
function quoteName(dialect: 'mysql' | 'postgres' | 'mssql', name: string): string {
  if (dialect === 'mysql') return `\`${name.replaceAll('`', '``')}\``
  if (dialect === 'mssql') return `[${name.replaceAll(']', ']]')}]`
  return `"${name.replaceAll('"', '""')}"`
}

function trimmedName(name: string): string | null {
  const trimmed = name.trim()
  return trimmed === '' ? null : trimmed
}

/** `null` when the dialect has no simple CREATE SCHEMA statement. */
export function createSchemaSql(dialect: string | undefined, name: string): string | null {
  const trimmed = trimmedName(name)
  if (trimmed === null) return null
  if (dialect === 'mysql') return `CREATE DATABASE ${quoteName('mysql', trimmed)}`
  if (dialect === 'postgres') return `CREATE SCHEMA ${quoteName('postgres', trimmed)}`
  if (dialect === 'mssql') return `CREATE SCHEMA ${quoteName('mssql', trimmed)}`
  return null
}

/**
 * No CASCADE: PostgreSQL and SQL Server reject a non-empty schema instead of
 * silently dropping everything in it. MySQL databases always drop with their
 * tables, which the confirmation dialog spells out.
 */
export function dropSchemaSql(dialect: string | undefined, name: string): string | null {
  const trimmed = trimmedName(name)
  if (trimmed === null) return null
  if (dialect === 'mysql') return `DROP DATABASE ${quoteName('mysql', trimmed)}`
  if (dialect === 'postgres') return `DROP SCHEMA ${quoteName('postgres', trimmed)}`
  if (dialect === 'mssql') return `DROP SCHEMA ${quoteName('mssql', trimmed)}`
  return null
}
