import type { Client, FieldDef } from 'pg'

import type {
  ColumnDetail,
  DdlResult,
  ExplainResult,
  IndexInfo,
  ObjectKind,
  QueryResult,
  SchemaInfo,
  SchemaObject,
  ServerInfo,
  TableDescription,
} from '../../../shared/types.js'
import { DbError, errorMessage } from '../../errors.js'
import { loadTls } from '../../tls.js'
import type { DatabaseEngine, EngineConnectContext, EngineDescriptor, EngineQueryOptions } from '../types.js'

const TYPE_NAMES: Record<number, string> = {
  16: 'BOOLEAN', 17: 'BYTEA', 20: 'BIGINT', 21: 'SMALLINT', 23: 'INTEGER', 25: 'TEXT',
  114: 'JSON', 700: 'REAL', 701: 'DOUBLE PRECISION', 1042: 'CHAR', 1043: 'VARCHAR',
  1082: 'DATE', 1083: 'TIME', 1114: 'TIMESTAMP', 1184: 'TIMESTAMPTZ', 1700: 'NUMERIC',
  2950: 'UUID', 3802: 'JSONB',
}

function typeName(field: FieldDef): string {
  return TYPE_NAMES[field.dataTypeID] ?? `TYPE_${String(field.dataTypeID)}`
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

function cell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (Buffer.isBuffer(value)) return `0x${value.subarray(0, 4096).toString('hex')}`
  if (value instanceof Date) return value.toISOString()
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function generateDdl(description: TableDescription): string {
  const lines = description.columns.map((column) => {
    const parts = [quoteIdent(column.name), column.typeName || 'TEXT']
    if (column.nullable === false) parts.push('NOT NULL')
    if (column.defaultValue !== undefined && column.defaultValue !== '') parts.push(`DEFAULT ${column.defaultValue}`)
    return `  ${parts.join(' ')}`
  })
  const primary = description.indexes.find((index) => index.primary)
  if (primary !== undefined && primary.columns.length > 0) {
    lines.push(`  PRIMARY KEY (${primary.columns.map(quoteIdent).join(', ')})`)
  }
  return `CREATE TABLE ${quoteIdent(description.schema)}.${quoteIdent(description.table)} (\n${lines.join(',\n')}\n)`
}

export class PostgresEngine implements DatabaseEngine {
  readonly descriptor: EngineDescriptor = {
    apiVersion: 1,
    kind: 'postgres',
    label: 'PostgreSQL',
    dialect: 'postgres',
    defaultPort: 5432,
    driverId: 'pg',
    capabilities: { schemas: true, ddl: 'generated', explain: true, transaction: true, cancel: true, tls: 'optional', ssh: true },
  }

  private client: Client | undefined

  async connect(ctx: EngineConnectContext): Promise<ServerInfo> {
    const pg = await ctx.drivers.load<typeof import('pg')>('pg')
    for (const oid of [20, 1082, 1083, 1114, 1184, 1700]) {
      pg.types.setTypeParser(oid, (value: string) => value)
    }
    const tls = loadTls(ctx.connection.tls)
    const ssl = tls === undefined
      ? undefined
      : {
          rejectUnauthorized: tls.rejectUnauthorized,
          ...(tls.ca === undefined ? {} : { ca: tls.ca }),
          ...(tls.cert === undefined ? {} : { cert: tls.cert }),
          ...(tls.key === undefined ? {} : { key: tls.key }),
          ...(tls.verifyIdentity ? {} : { checkServerIdentity: () => undefined }),
        }
    const client = new pg.Client({
      host: ctx.endpoint.host,
      port: ctx.endpoint.port,
      user: ctx.connection.user,
      password: ctx.credentials.password,
      ...(ctx.connection.database.trim() === '' ? {} : { database: ctx.connection.database }),
      application_name: 'dsh-database-view',
      connectionTimeoutMillis: ctx.settings.connectTimeoutSec * 1000,
      statement_timeout: ctx.settings.queryTimeoutSec * 1000,
      ...(ssl === undefined ? {} : { ssl }),
    })
    try {
      await client.connect()
      this.client = client
      const result = await client.query('SELECT version() AS version, current_database() AS db, current_user AS username')
      const row = result.rows[0] as Record<string, unknown> | undefined
      return {
        product: 'PostgreSQL',
        version: typeof row?.version === 'string' ? row.version.split(' ').slice(0, 2).join(' ') : 'unknown',
        ...(typeof row?.username === 'string' ? { user: row.username } : {}),
        ...(typeof row?.db === 'string' ? { database: row.db } : {}),
        url: `${ctx.endpoint.host}:${ctx.endpoint.port}`,
      }
    } catch (error) {
      await client.end().catch(() => undefined)
      throw new DbError('connect-failed', `PostgreSQL 连接失败：${errorMessage(error)}`)
    }
  }

  private requireClient(): Client {
    if (this.client === undefined) throw new DbError('not-connected', 'PostgreSQL 连接尚未打开')
    return this.client
  }

  async disconnect(): Promise<void> {
    const client = this.client
    this.client = undefined
    if (client !== undefined) await client.end().catch(() => undefined)
  }

  async ping(): Promise<{ ok: boolean; version?: string }> {
    const result = await this.requireClient().query('SELECT version() AS version')
    return { ok: true, ...(typeof result.rows[0]?.version === 'string' ? { version: result.rows[0].version } : {}) }
  }

  async listSchemas(filter = ''): Promise<SchemaInfo[]> {
    const result = await this.requireClient().query(
      `SELECT schema_name AS name FROM information_schema.schemata
       WHERE schema_name <> 'information_schema' AND schema_name NOT LIKE 'pg_%'
       ORDER BY schema_name`,
    )
    const needle = filter.trim().toLowerCase()
    return (result.rows as Array<{ name: string }>)
      .filter((row) => needle === '' || row.name.toLowerCase().includes(needle))
      .map((row) => ({ name: row.name }))
  }

  async listObjects(schema: string): Promise<SchemaObject[]> {
    const result = await this.requireClient().query(
      `SELECT table_name AS name, table_type AS type
       FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
      [schema],
    )
    return (result.rows as Array<{ name: string; type: string }>).map((row) => ({
      name: row.name,
      kind: row.type.toUpperCase().includes('VIEW') ? 'view' : 'table',
    }))
  }

  async setSchema(schema: string): Promise<void> {
    await this.requireClient().query(`SET search_path TO ${quoteIdent(schema)}`)
  }

  async describe(schema: string, table: string, kind: ObjectKind): Promise<TableDescription> {
    if (kind !== 'table' && kind !== 'view') return { schema, table, kind, columns: [], indexes: [] }
    const client = this.requireClient()
    const columns = await client.query(
      `SELECT column_name AS name, data_type AS type, is_nullable AS nullable,
              column_default AS "defaultValue", ordinal_position AS ordinal
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
      [schema, table],
    )
    const indexes = await client.query(
      `SELECT indexname AS name, indexdef AS definition FROM pg_indexes
       WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`,
      [schema, table],
    )
    const pk = await client.query(
      `SELECT a.attname AS column FROM pg_index i
       JOIN pg_class c ON c.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
       WHERE n.nspname = $1 AND c.relname = $2 AND i.indisprimary`,
      [schema, table],
    )
    const primaryColumns = new Set((pk.rows as Array<{ column: string }>).map((row) => row.column))
    return {
      schema,
      table,
      kind,
      columns: (columns.rows as Array<Record<string, unknown>>).map((row): ColumnDetail => ({
        name: String(row.name),
        typeName: String(row.type ?? ''),
        nullable: row.nullable !== 'NO',
        ...(row.defaultValue === null ? {} : { defaultValue: String(row.defaultValue) }),
        ...(typeof row.ordinal === 'number' ? { ordinal: row.ordinal } : {}),
        ...(primaryColumns.has(String(row.name)) ? { primaryKey: true } : {}),
      })),
      indexes: (indexes.rows as Array<{ name: string; definition: string }>).map((row): IndexInfo => {
        const match = /\(([^)]+)\)/.exec(row.definition)
        const columns = match === null ? [] : match[1].split(',').map((item) => item.trim().replace(/^"|"$/g, ''))
        return {
          name: row.name,
          columns,
          unique: /\bUNIQUE\b/i.test(row.definition),
          primary: row.name.endsWith('_pkey'),
        }
      }),
    }
  }

  async ddl(schema: string, table: string, kind: ObjectKind): Promise<DdlResult> {
    const client = this.requireClient()
    if (kind === 'view') {
      const result = await client.query('SELECT pg_get_viewdef(to_regclass($1), true) AS ddl', [`${quoteIdent(schema)}.${quoteIdent(table)}`])
      const ddl = String(result.rows[0]?.ddl ?? '')
      if (ddl.trim() !== '') return { schema, table, kind, ddl, source: 'server', warnings: [] }
    }
    if (kind === 'function' || kind === 'procedure') {
      const result = await client.query('SELECT pg_get_functiondef(to_regprocedure($1)) AS ddl', [`${quoteIdent(schema)}.${quoteIdent(table)}`])
      const ddl = String(result.rows[0]?.ddl ?? '')
      if (ddl.trim() !== '') return { schema, table, kind, ddl, source: 'server', warnings: [] }
    }
    const description = await this.describe(schema, table, kind)
    return { schema, table, kind, ddl: generateDdl(description), source: 'generated', warnings: ['PostgreSQL 没有内置的建表语句查询，已按结构生成'] }
  }

  async query(sql: string, options: EngineQueryOptions): Promise<QueryResult> {
    const started = Date.now()
    const maxRows = Math.max(1, Math.min(options.maxRows ?? 200, 5000))
    try {
      const result = await this.requireClient().query(sql)
      const elapsedMs = Date.now() - started
      if (!Array.isArray(result.rows) || result.fields.length === 0) {
        return { columns: [], rows: [], rowCount: 0, truncated: false, updateCount: result.rowCount ?? 0, elapsedMs, warnings: [], sql, ...(options.stmtKey === undefined ? {} : { stmtKey: options.stmtKey }) }
      }
      const shown = (result.rows as Array<Record<string, unknown>>).slice(0, maxRows)
      const columns = result.fields.map((field) => ({ name: field.name, typeName: typeName(field), nullable: true }))
      return {
        columns,
        rows: shown.map((row) => columns.map((column) => cell(row[column.name]))),
        rowCount: shown.length,
        truncated: result.rows.length > maxRows,
        elapsedMs,
        warnings: [],
        sql,
        ...(options.stmtKey === undefined ? {} : { stmtKey: options.stmtKey }),
      }
    } catch (error) {
      throw new DbError('query-failed', `PostgreSQL 查询失败：${errorMessage(error)}`)
    }
  }

  async explain(sql: string): Promise<ExplainResult> {
    const plan = await this.query(`EXPLAIN (FORMAT TEXT) ${sql}`, { maxRows: 500 })
    return { dialect: 'postgres', statements: [`EXPLAIN (FORMAT TEXT) ${sql}`], plan, warnings: [] }
  }

  async transaction(action: 'begin' | 'commit' | 'rollback'): Promise<void> {
    const client = this.requireClient()
    if (action === 'begin') await client.query('BEGIN')
    else if (action === 'commit') await client.query('COMMIT')
    else await client.query('ROLLBACK')
  }

  async cancel(): Promise<boolean> {
    const client = this.client
    if (client === undefined) return false
    await client.end().catch(() => undefined)
    this.client = undefined
    return true
  }
}
