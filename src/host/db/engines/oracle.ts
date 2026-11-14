import type { Connection as OracleConnection } from 'oracledb'

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
import type { DatabaseEngine, EngineConnectContext, EngineDescriptor, EngineQueryOptions } from '../types.js'

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
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
    const parts = [quoteIdent(column.name), column.typeName || 'VARCHAR2(255)']
    if (column.nullable === false) parts.push('NOT NULL')
    return `  ${parts.join(' ')}`
  })
  const primary = description.indexes.find((index) => index.primary)
  if (primary !== undefined && primary.columns.length > 0) lines.push(`  PRIMARY KEY (${primary.columns.map(quoteIdent).join(', ')})`)
  return `CREATE TABLE ${quoteIdent(description.schema)}.${quoteIdent(description.table)} (\n${lines.join(',\n')}\n)`
}

export class OracleEngine implements DatabaseEngine {
  readonly descriptor: EngineDescriptor = {
    apiVersion: 1,
    kind: 'oracle',
    label: 'Oracle',
    dialect: 'oracle',
    defaultPort: 1521,
    driverId: 'oracledb-thin',
    capabilities: { schemas: true, ddl: 'server', explain: true, transaction: true, cancel: true, tls: 'optional', ssh: true },
  }

  private connection: OracleConnection | undefined
  private oracledb: typeof import('oracledb') | undefined

  async connect(ctx: EngineConnectContext): Promise<ServerInfo> {
    const loaded = await ctx.drivers.load<typeof import('oracledb')>('oracledb')
    const oracledb = ((loaded as unknown as { default?: typeof import('oracledb') }).default ?? loaded)
    oracledb.fetchAsString = [oracledb.DATE, oracledb.NUMBER, oracledb.CLOB]
    this.oracledb = oracledb
    const connectString = `${ctx.endpoint.host}:${ctx.endpoint.port}/${ctx.connection.database}`
    try {
      this.connection = await oracledb.getConnection({
        user: ctx.connection.user,
        password: ctx.credentials.password,
        connectString,
      })
      let version = 'unknown'
      try {
        const result = await this.connection.execute("SELECT banner AS version FROM v$version WHERE ROWNUM = 1")
        const row = (result.rows?.[0] ?? []) as unknown[]
        version = String(row[0] ?? 'unknown').split('\n')[0]
      } catch {
        try {
          const result = await this.connection.execute("SELECT version FROM product_component_version WHERE product LIKE 'Oracle Database%' AND ROWNUM = 1")
          const row = (result.rows?.[0] ?? []) as unknown[]
          version = String(row[0] ?? 'unknown')
        } catch {
          // keep unknown; the user may lack v$version privileges
        }
      }
      return {
        product: 'Oracle',
        version,
        user: ctx.connection.user,
        database: ctx.connection.database,
        url: connectString,
      }
    } catch (error) {
      await this.connection?.close().catch(() => undefined)
      this.connection = undefined
      throw new DbError('connect-failed', `Oracle 连接失败：${errorMessage(error)}`)
    }
  }

  private requireConnection(): OracleConnection {
    if (this.connection === undefined) throw new DbError('not-connected', 'Oracle 连接尚未打开')
    return this.connection
  }

  async disconnect(): Promise<void> {
    const connection = this.connection
    this.connection = undefined
    if (connection !== undefined) await connection.close().catch(() => undefined)
  }

  async ping(): Promise<{ ok: boolean; version?: string }> {
    const result = await this.requireConnection().execute("SELECT banner AS version FROM v$version WHERE ROWNUM = 1")
    const rows = result.rows as unknown[] | undefined
    return { ok: true, ...(rows?.[0] === undefined ? {} : { version: String((rows[0] as unknown[])[0]) }) }
  }

  async listSchemas(filter = ''): Promise<SchemaInfo[]> {
    const result = await this.requireConnection().execute('SELECT username AS name FROM all_users ORDER BY username')
    const needle = filter.trim().toLowerCase()
    return (result.rows as Array<{ NAME: string }>)
      .map((row) => row.NAME)
      .filter((name) => needle === '' || name.toLowerCase().includes(needle))
      .map((name) => ({ name }))
  }

  async listObjects(schema: string): Promise<SchemaObject[]> {
    const result = await this.requireConnection().execute(
      `SELECT object_name AS name, object_type AS type FROM all_objects
       WHERE owner = :owner AND object_type IN ('TABLE','VIEW','PROCEDURE','FUNCTION','SEQUENCE','TRIGGER')
       ORDER BY object_name`,
      { owner: schema },
    )
    return (result.rows as Array<{ NAME: string; TYPE: string }>).map((row) => ({
      name: row.NAME,
      kind: row.TYPE === 'TABLE' ? 'table' : row.TYPE === 'VIEW' ? 'view' : row.TYPE.toLowerCase() as ObjectKind,
    }))
  }

  async setSchema(schema: string): Promise<void> {
    await this.requireConnection().execute(`ALTER SESSION SET CURRENT_SCHEMA = ${quoteIdent(schema)}`)
  }

  async describe(schema: string, table: string, kind: ObjectKind): Promise<TableDescription> {
    if (kind !== 'table' && kind !== 'view') return { schema, table, kind, columns: [], indexes: [] }
    const connection = this.requireConnection()
    const columns = await connection.execute(
      `SELECT column_name, data_type, data_length, data_precision, data_scale, nullable, data_default, column_id
       FROM all_tab_columns WHERE owner = :owner AND table_name = :table ORDER BY column_id`,
      { owner: schema, table },
    )
    const indexes = await connection.execute(
      `SELECT i.index_name, i.uniqueness, i.index_type, c.column_name, c.column_position
       FROM all_indexes i JOIN all_ind_columns c ON c.index_owner = i.owner AND c.index_name = i.index_name
       WHERE i.table_owner = :owner AND i.table_name = :table ORDER BY i.index_name, c.column_position`,
      { owner: schema, table },
    )
    const primary = await connection.execute(
      `SELECT cc.column_name FROM all_constraints c JOIN all_cons_columns cc
       ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
       WHERE c.owner = :owner AND c.table_name = :table AND c.constraint_type = 'P'`,
      { owner: schema, table },
    )
    const primaryColumns = new Set((primary.rows as Array<{ COLUMN_NAME: string }>).map((row) => row.COLUMN_NAME))
    const byName = new Map<string, IndexInfo>()
    for (const row of indexes.rows as Array<Record<string, unknown>>) {
      const name = String(row.INDEX_NAME)
      const entry = byName.get(name) ?? { name, columns: [], unique: row.UNIQUENESS === 'UNIQUE', primary: primaryColumns.size > 0 && name === name }
      entry.columns.push(String(row.COLUMN_NAME))
      byName.set(name, entry)
    }
    const primaryIndex = [...byName.values()].find((index) => index.columns.every((column) => primaryColumns.has(column)) && primaryColumns.size > 0)
    if (primaryIndex !== undefined) primaryIndex.primary = true
    return {
      schema,
      table,
      kind,
      columns: (columns.rows as Array<Record<string, unknown>>).map((row): ColumnDetail => ({
        name: String(row.COLUMN_NAME),
        typeName: String(row.DATA_TYPE) + (row.DATA_PRECISION === null ? '' : `(${String(row.DATA_PRECISION)}${row.DATA_SCALE === null ? '' : `,${String(row.DATA_SCALE)}`})`),
        nullable: row.NULLABLE === 'Y',
        ...(row.DATA_DEFAULT === null ? {} : { defaultValue: String(row.DATA_DEFAULT) }),
        ...(typeof row.COLUMN_ID === 'number' ? { ordinal: row.COLUMN_ID } : {}),
        ...(primaryColumns.has(String(row.COLUMN_NAME)) ? { primaryKey: true } : {}),
      })),
      indexes: [...byName.values()],
    }
  }

  async ddl(schema: string, table: string, kind: ObjectKind): Promise<DdlResult> {
    const objectType = kind === 'table' ? 'TABLE' : kind === 'view' ? 'VIEW' : kind.toUpperCase()
    try {
      const result = await this.requireConnection().execute(
        `SELECT DBMS_METADATA.GET_DDL(${quoteLiteral(objectType)}, ${quoteLiteral(table)}, ${quoteLiteral(schema)}) AS ddl FROM DUAL`,
      )
      const first = (result.rows as unknown[] | undefined)?.[0]
      const ddl = Array.isArray(first) ? String(first[0] ?? '') : String((first as Record<string, unknown> | undefined)?.DDL ?? '')
      if (ddl !== '') return { schema, table, kind, ddl, source: 'server', warnings: [] }
    } catch {
      // fall through
    }
    const description = await this.describe(schema, table, kind)
    return { schema, table, kind, ddl: generateDdl(description), source: 'generated', warnings: ['DBMS_METADATA 没有返回 DDL，已按结构生成'] }
  }

  async query(sql: string, options: EngineQueryOptions): Promise<QueryResult> {
    const started = Date.now()
    const maxRows = Math.max(1, Math.min(options.maxRows ?? 200, 5000))
    try {
      const result = await this.requireConnection().execute(sql, [], { maxRows, outFormat: this.oracledb?.OUT_FORMAT_OBJECT ?? 4002 })
      const meta = result.metaData ?? []
      if (!Array.isArray(result.rows) || meta.length === 0) {
        return { columns: [], rows: [], rowCount: 0, truncated: false, updateCount: result.rowsAffected ?? 0, elapsedMs: Date.now() - started, warnings: [], sql, ...(options.stmtKey === undefined ? {} : { stmtKey: options.stmtKey }) }
      }
      const rows = result.rows as Array<Record<string, unknown>>
      return {
        columns: meta.map((column) => ({ name: column.name, typeName: column.dbTypeName ?? '' })),
        rows: rows.map((row) => meta.map((column) => cell(row[column.name]))),
        rowCount: rows.length,
        truncated: rows.length >= maxRows,
        elapsedMs: Date.now() - started,
        warnings: [],
        sql,
        ...(options.stmtKey === undefined ? {} : { stmtKey: options.stmtKey }),
      }
    } catch (error) {
      throw new DbError('query-failed', `Oracle 查询失败：${errorMessage(error)}`)
    }
  }

  async explain(sql: string): Promise<ExplainResult> {
    const statements = [`EXPLAIN PLAN FOR ${sql}`, "SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, NULL, 'BASIC'))"]
    await this.requireConnection().execute(`EXPLAIN PLAN FOR ${sql}`)
    const plan = await this.query(statements[1], { maxRows: 500 })
    return { dialect: 'oracle', statements, plan, warnings: [] }
  }

  async transaction(action: 'begin' | 'commit' | 'rollback'): Promise<void> {
    const connection = this.requireConnection()
    if (action === 'begin') return
    if (action === 'commit') await connection.commit()
    else await connection.rollback()
  }

  async cancel(): Promise<boolean> {
    const connection = this.connection
    if (connection === undefined) return false
    const breakFn = (connection as unknown as { break?: () => Promise<void> }).break
    if (typeof breakFn === 'function') await breakFn.call(connection)
    return true
  }
}
