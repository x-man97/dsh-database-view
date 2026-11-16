/**
 * Types shared by the host half and the browser half of the plugin.
 * Everything here must stay JSON-serialisable: the same shapes cross the
 * /dsh-database-view/api boundary and are stored in the profile data file.
 */

import type { ConsoleActionId } from './consoleactions.js'
import type { ToolbarActionId } from './toolbaractions.js'

export type Dialect = 'mysql' | 'oracle' | 'postgres' | 'sqlite' | 'mssql' | 'redis'

export type SqlDialect = Exclude<Dialect, 'redis'>

export type PresetId = 'mysql' | 'mariadb' | 'oracle' | 'postgres' | 'sqlite' | 'mssql' | 'redis'

export interface PresetSpec {
  id: PresetId
  dialect: Dialect
  defaultPort: number
  /** Shown in the connection form under the database field. */
  databaseHint: string
  /** File-based engines (SQLite) do not use host or port. */
  hostOptional?: boolean
}

export interface DbSettings {
  /** Hard cap for rows returned by the panel and the agent tools. */
  maxRows: number
  queryTimeoutSec: number
  connectTimeoutSec: number
  /** Agent tools may run INSERT/UPDATE/DELETE/DDL on non-read-only connections. */
  allowAgentWrites: boolean
  redisScanCount: number
  /** Confirm destructive actions in the panel. */
  confirmDestructive: boolean
  /**
   * Panel shortcuts the user rebound, keyed by shortcut id; only the changed
   * ones are stored, the rest fall back to the defaults in shared/keymap.ts.
   */
  keybindings: Record<string, string>
  /**
   * Console toolbar order chosen in settings. Empty keeps the default order;
   * orderConsoleActions() appends actions this saved order does not mention.
   */
  consoleActions?: ConsoleActionId[]
  /**
   * Open the completion popup while typing in the console. Missing counts as
   * enabled, matching the host defaults.
   */
  consoleAutoComplete?: boolean
  /**
   * Data-source toolbar order chosen in settings. Empty keeps the default
   * order; orderToolbarActions() appends actions it does not mention.
   */
  toolbarActions?: ToolbarActionId[]
}


export type SshAuth = 'password' | 'key' | 'agent'
export type SshHostKeyPolicy = 'ask' | 'strict' | 'accept-new'

export interface SshConfig {
  enabled: true
  host: string
  port: number
  user: string
  auth: SshAuth
  privateKeyPath?: string
  hostKeyPolicy: SshHostKeyPolicy
  connectTimeoutMs?: number
  keepaliveIntervalMs?: number
}

export interface TlsConfig {
  mode: 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full'
  caPath?: string
  certPath?: string
  keyPath?: string
  servername?: string
  allowInvalidHostname?: boolean
}

export interface ConnectionConfig {
  id: string
  name: string
  driver: PresetId
  dialect: Dialect
  host: string
  port: number
  user: string
  /** Name of the layered secret (env-style); never the password itself. */
  secretName?: string
  hasPassword: boolean
  /** SQL: database/schema/service name. Redis: unused. */
  database: string
  /** Redis logical database index. */
  redisDb: number
  readOnly: boolean
  ssh?: SshConfig
  tls?: TlsConfig
  createdAt: string
  lastUsedAt?: string
}

export interface ClientConnection {
  id: string
  name: string
  driver: PresetId
  dialect: Dialect
  host: string
  port: number
  user: string
  hasPassword: boolean
  database: string
  redisDb: number
  readOnly: boolean
  ssh?: SshConfig
  tls?: TlsConfig
  hasSshPassword?: boolean
  hasSshPassphrase?: boolean
  createdAt: string
  lastUsedAt?: string
}

/** A connection removed from the list, kept recoverable in the recycle bin. */
export interface TrashedConnection extends ConnectionConfig {
  /** When the user deleted it; ISO timestamp. */
  deletedAt: string
}

export interface ClientTrashedConnection extends ClientConnection {
  deletedAt: string
}

export interface ConnectionDraft {
  id?: string
  /** New connections may copy the saved credentials of this connection. */
  copyFromId?: string
  name: string
  driver: PresetId
  host: string
  port: number
  user: string
  password?: string
  clearPassword?: boolean
  database: string
  redisDb: number
  readOnly: boolean
  ssh?: SshConfig
  tls?: TlsConfig
  sshPassword?: string
  sshPassphrase?: string
}

export interface DbConfigFile {
  version: 2
  connections: ConnectionConfig[]
  /** Deleted connections, newest first; purged or restored from the recycle bin. */
  trash: TrashedConnection[]
  settings: DbSettings
}

export interface ClientConfig {
  connections: ClientConnection[]
  /** Deleted connections shown in the recycle bin, newest first. */
  trash: ClientTrashedConnection[]
  settings: DbSettings
}

export interface EnvStatus {
  dataDir: string
  configPath: string
  pluginVersion: string
  platform: string
}

export interface ConfigSnapshot {
  config: ClientConfig
  env: EnvStatus
}

export interface ApiErrorBody {
  code: string
  message: string
  detail?: string
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiErrorBody }

export interface ColumnInfo {
  name: string
  typeName: string
  nullable?: boolean
}

export type CellValue = string | number | boolean | null
export type Row = CellValue[]

export interface QueryResult {
  columns: ColumnInfo[]
  rows: Row[]
  rowCount: number
  truncated: boolean
  updateCount?: number
  elapsedMs: number
  warnings: string[]
  sql: string
  /** Client-chosen id usable with POST /query/cancel while the query runs. */
  stmtKey?: string
}

export interface SchemaInfo {
  name: string
  system?: boolean
}

export type ObjectKind =
  | 'table'
  | 'view'
  | 'procedure'
  | 'function'
  | 'sequence'
  | 'trigger'
  | 'other'

export interface SchemaObject {
  name: string
  kind: ObjectKind
  comment?: string
}

/**
 * Structure snapshot kept on disk: written after every successful live read and
 * served when the data source is not connected (JetBrains Database behaviour).
 */
export interface CachedStructure {
  fetchedAt: string
  schemas: SchemaInfo[]
  objects: Record<string, SchemaObject[]>
  /**
   * `schema.table` → described columns and indexes. The host keeps these in
   * per-connection logs and the tree snapshot no longer ships them, so this is
   * only present when a caller builds the shape itself.
   *
   * TODO(0.5.0): 旧版单文件缓存迁移（StructureStore.migrateDescriptions）移除后删除该字段。
   */
  descriptions?: Record<string, TableDescription>
  /** Redis key-space cache, per logical database. */
  redis?: RedisStructureCache
}

export interface RedisDbCache {
  /** Keys last seen by SCAN, in scan order. */
  keys: RedisKeyInfo[]
  /** Cursor to continue paging from, `0` when the scan finished. */
  cursor: string
  fetchedAt: string
}

export interface RedisStructureCache {
  /** Number of logical databases (`CONFIG GET databases`). */
  databases: number
  dbs: Record<string, RedisDbCache>
}

export interface RedisDatabasesResult {
  databases: number
  /** The database the connection opens by default. */
  redisDb: number
  cached?: boolean
  error?: string
}

export interface StructureSnapshot {
  [connectionId: string]: CachedStructure
}

/** Live progress of one connection's background description walk. */
export interface PrefetchProgress {
  connectionId: string
  /** Tables/views that still need a (re)read when the walk started. */
  total: number
  /** Items finished so far. */
  done: number
}

export interface DescribeResult extends TableDescription {
  cached?: boolean
  fetchedAt?: string
}

/**
 * DDL for a table or view: the server's own definition when the dialect can
 * return it, otherwise a reconstruction from the described columns/indexes.
 */
/** Result of an execution-plan (EXPLAIN) request. */
export interface ExplainResult {
  dialect: SqlDialect
  statements: string[]
  plan?: QueryResult
  warnings: string[]
}

export interface DdlResult {
  schema: string
  table: string
  kind: ObjectKind
  ddl: string
  source: 'server' | 'generated'
  warnings: string[]
}

export interface SchemaListResult {
  schemas: SchemaInfo[]
  cached?: boolean
  fetchedAt?: string
  error?: string
}

export interface ObjectListResult {
  objects: SchemaObject[]
  cached?: boolean
  fetchedAt?: string
  error?: string
}

export interface ColumnDetail extends ColumnInfo {
  defaultValue?: string
  comment?: string
  ordinal?: number
  primaryKey?: boolean
  autoIncrement?: boolean
}

export interface IndexInfo {
  name: string
  columns: string[]
  unique?: boolean
  primary?: boolean
}

export interface TableDescription {
  schema: string
  table: string
  kind: ObjectKind
  columns: ColumnDetail[]
  indexes: IndexInfo[]
  /**
   * Inline DDL for objects without a column structure (routines, sequences,
   * triggers), fetched on demand so the detail panel can show its definition.
   */
  ddl?: string
  ddlSource?: 'server' | 'generated'
  ddlWarnings?: string[]
  /**
   * When the columns/indexes were last read from the server. Set by the
   * structure cache only; the background prefetcher uses it to refresh stale
   * entries instead of re-reading everything on each connection.
   */
  describedAt?: string
}

export interface ServerInfo {
  product: string
  version: string
  user?: string
  database?: string
  url?: string
}


export interface DriverPackStatus {
  id: string
  engine: string
  version: string
  license: string
  installed: boolean
  path?: string
  bytes?: number
  downloadAvailable: boolean
  error?: string
}

export interface ConnectionTestResult {
  ok: boolean
  server?: ServerInfo
  latencyMs: number
  message?: string
  code?: string
  /** Extra remark shown next to a successful result (for example a SQLite file that will be created). */
  note?: string
}

export interface RedisKeyInfo {
  key: string
  type: string
  ttl: number
  size?: number
}

export interface RedisScanResult {
  cursor: string
  done: boolean
  keys: RedisKeyInfo[]
  scanned: number
}

export interface RedisValue {
  key: string
  type: string
  ttl: number
  size?: number
  value: JsonValue
  truncated: boolean
  preview: string
}

export interface RedisCommandResult {
  command: string
  value: JsonValue
  elapsedMs: number
  readOnly: boolean
}

export type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue }
export type JsonScalar = string | number | boolean | null

export interface ToolOk<T> {
  ok: true
  data: T
}

export interface ToolFail {
  ok: false
  error: { code: string; message: string }
}

export type ToolResult<T> = ToolOk<T> | ToolFail
