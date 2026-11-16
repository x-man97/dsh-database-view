import type {
  ColumnDetail,
  ConnectionConfig,
  DriverPackStatus,
  DdlResult,
  ExplainResult,
  IndexInfo,
  ObjectKind,
  QueryResult,
  SchemaInfo,
  SchemaObject,
  ServerInfo,
  SqlDialect,
  TableDescription,
} from '../../shared/types.js'

export interface EngineEndpoint {
  host: string
  port: number
}

export interface EngineSettings {
  maxRows: number
  queryTimeoutSec: number
  connectTimeoutSec: number
}

export interface DriverLoader {
  ensure(id: string): Promise<DriverPackStatus>
  load<T = unknown>(id: string): Promise<T>
}

export interface EngineLogger {
  (message: string): void
}

export interface EngineConnectContext {
  connection: Readonly<ConnectionConfig>
  endpoint: EngineEndpoint
  credentials: { password: string }
  settings: Readonly<EngineSettings>
  drivers: DriverLoader
  log: EngineLogger
}

export interface EngineQueryOptions {
  maxRows?: number
  timeoutSec?: number
  stmtKey?: string
  schema?: string
}

export interface EngineCapabilities {
  schemas: boolean
  ddl: 'server' | 'generated' | 'none'
  explain: boolean
  transaction: boolean
  cancel: boolean
  tls: 'none' | 'optional' | 'required'
  ssh: boolean
}

export interface EngineDescriptor {
  apiVersion: 1
  kind: string
  label: string
  dialect: SqlDialect
  defaultPort: number
  driverId: string
  capabilities: EngineCapabilities
}

export interface DatabaseEngine {
  readonly descriptor: EngineDescriptor
  connect(ctx: EngineConnectContext): Promise<ServerInfo>
  disconnect(): Promise<void>
  isOpen(): boolean
  ping(): Promise<{ ok: boolean; version?: string }>
  listSchemas(filter?: string): Promise<SchemaInfo[]>
  listObjects(schema: string): Promise<SchemaObject[]>
  setSchema(schema: string): Promise<void>
  describe(schema: string, table: string, kind: ObjectKind): Promise<TableDescription>
  ddl(schema: string, table: string, kind: ObjectKind): Promise<DdlResult>
  query(sql: string, options: EngineQueryOptions): Promise<QueryResult>
  explain(sql: string): Promise<ExplainResult>
  transaction(action: 'begin' | 'commit' | 'rollback'): Promise<void>
  cancel(stmtKey: string): Promise<boolean>
}

export interface EngineContribution {
  apiVersion: 1
  descriptor: EngineDescriptor
  create(): DatabaseEngine
}

export function defineEngine(contribution: EngineContribution): EngineContribution {
  return contribution
}

export type { ColumnDetail, IndexInfo }
