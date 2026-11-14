import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

import type {
  ConnectionConfig,
  ConnectionDraft,
  ConnectionTestResult,
  DdlResult,
  ExplainResult,
  ObjectKind,
  QueryResult,
  SchemaInfo,
  SchemaObject,
  ServerInfo,
  TableDescription,
} from '../shared/types.js'
import type { ConfigStore } from './config.js'
import type { DriverManager } from './drivers/manager.js'
import { coreEngines, nativeKindFor } from './db/catalog.js'
import { EngineRegistry } from './db/registry.js'
import type { DatabaseEngine } from './db/types.js'
import {
  isReadOnlySql,
  type QueryOptions,
} from './sql.js'
import { DbError, errorMessage } from './errors.js'
import type { PluginPaths } from './paths.js'
import type { SecretStore } from './secrets.js'
import { SecretStore as Secrets } from './secrets.js'
import { SshTransport } from './ssh/transport.js'

interface Session {
  config: ConnectionConfig
  engine: DatabaseEngine
  transport?: SshTransport
  server: ServerInfo
}

function probeId(): string {
  return `probe-${randomBytes(4).toString('hex')}`
}

function dialectFor(driver: string): ConnectionConfig['dialect'] {
  switch (driver) {
    case 'postgres': return 'postgres'
    case 'sqlite': return 'sqlite'
    case 'mssql': return 'mssql'
    case 'oracle': return 'oracle'
    default: return 'mysql'
  }
}

function draftConfig(draft: ConnectionDraft, id: string): ConnectionConfig {
  return {
    id,
    name: draft.name,
    driver: draft.driver,
    dialect: dialectFor(draft.driver),
    host: draft.host,
    port: draft.port,
    user: draft.user,
    hasPassword: false,
    database: draft.database,
    redisDb: 0,
    readOnly: true,
    ...(draft.ssh === undefined ? {} : { ssh: draft.ssh }),
    ...(draft.tls === undefined ? {} : { tls: draft.tls }),
    createdAt: new Date().toISOString(),
  }
}

/** Native SQL service: one bundled Node.js engine per SQL preset. */
export class NativeSqlService {
  private readonly sessions = new Map<string, Session>()
  private readonly engines = new EngineRegistry()

  constructor(
    private readonly paths: PluginPaths,
    private readonly config: ConfigStore,
    private readonly secrets: SecretStore,
    private readonly drivers: DriverManager,
    private readonly log: (message: string) => void = () => {},
  ) {
    for (const contribution of coreEngines) this.engines.register(contribution)
  }

  isConnected(id: string): boolean {
    return this.sessions.has(id)
  }

  connectedIds(): string[] {
    return [...this.sessions.keys()]
  }

  serverOf(id: string): ServerInfo | undefined {
    return this.sessions.get(id)?.server
  }

  private require(id: string): Session {
    const session = this.sessions.get(id)
    if (session === undefined) throw new DbError('not-connected', '连接尚未打开', '请先连接数据库。')
    return session
  }

  private async open(config: ConnectionConfig, password: string, sshPassword?: string, sshPassphrase?: string): Promise<Session> {
    if (this.sessions.has(config.id)) return this.sessions.get(config.id) as Session
    let transport: SshTransport | undefined
    let endpoint = { host: config.host, port: config.port }
    try {
      if (config.ssh !== undefined) {
        transport = new SshTransport(config.ssh, { password: sshPassword, passphrase: sshPassphrase }, join(this.paths.dataDir, 'ssh-known-hosts.json'), this.log)
        const local = await transport.forwardTo(config.host, config.port)
        endpoint = { host: local.host, port: local.port }
      }
      const kind = nativeKindFor(config.driver)
      if (kind === undefined) throw new DbError('unsupported', `该数据库尚未启用内置引擎：${config.driver}`)
      if (config.driver === 'sqlite' && config.ssh !== undefined) throw new DbError('unsupported', 'SQLite 不支持 SSH 隧道')
      const contribution = this.engines.get(kind)
      if (contribution === undefined) throw new DbError('unsupported', `内置引擎未注册：${kind}`)
      if (!contribution.descriptor.driverId.startsWith('node:')) await this.drivers.ensure(contribution.descriptor.driverId)
      const engine = this.engines.create(kind)
      const server = await engine.connect({
        connection: config,
        endpoint,
        credentials: { password },
        settings: {
          maxRows: this.config.settings().maxRows,
          queryTimeoutSec: this.config.settings().queryTimeoutSec,
          connectTimeoutSec: this.config.settings().connectTimeoutSec,
        },
        drivers: this.drivers,
        log: this.log,
      })
      const session: Session = { config, engine, ...(transport === undefined ? {} : { transport }), server }
      this.sessions.set(config.id, session)
      return session
    } catch (error) {
      if (transport !== undefined) await transport.close().catch(() => undefined)
      throw error instanceof DbError ? error : new DbError('connect-failed', `连接失败：${errorMessage(error)}`)
    }
  }

  private passwordFor(config: ConnectionConfig, draftPassword?: string): string {
    if (draftPassword !== undefined && draftPassword !== '') return draftPassword
    if (config.secretName === undefined) return ''
    return this.secrets.resolve(config.secretName)?.value ?? ''
  }

  async test(draft: ConnectionDraft): Promise<ConnectionTestResult> {
    const started = Date.now()
    const id = draft.id ?? probeId()
    let config = draftConfig(draft, id)
    const existing = draft.id === undefined ? undefined : this.config.connection(draft.id)
    if (existing?.secretName !== undefined) config = { ...config, secretName: existing.secretName }
    let session: Session | undefined
    try {
      const password = this.passwordFor(config, draft.password)
      const sshPassword = draft.sshPassword !== undefined && draft.sshPassword !== ''
        ? draft.sshPassword
        : draft.id === undefined ? undefined : this.secrets.resolve(Secrets.nameForSshPassword(draft.id))?.value
      const sshPassphrase = draft.sshPassphrase !== undefined && draft.sshPassphrase !== ''
        ? draft.sshPassphrase
        : draft.id === undefined ? undefined : this.secrets.resolve(Secrets.nameForSshPassphrase(draft.id))?.value
      session = await this.open(config, password, sshPassword, sshPassphrase)
      return { ok: true, server: session.server, latencyMs: Date.now() - started }
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: errorMessage(error),
        ...(error instanceof DbError ? { code: error.code } : {}),
      }
    } finally {
      if (session !== undefined) await session.engine.disconnect().catch(() => undefined)
      await session?.transport?.close().catch(() => undefined)
      this.sessions.delete(id)
    }
  }

  async connect(id: string): Promise<ServerInfo> {
    const config = this.config.connection(id)
    if (config === undefined) throw new DbError('not-found', `连接不存在：${id}`)
    if (nativeKindFor(config.driver) === undefined) throw new DbError('unsupported', '该数据库不支持内置引擎')
    const session = this.sessions.get(id)
    if (session !== undefined) return session.server
    const password = this.passwordFor(config)
    const sshPassword = this.secrets.resolve(Secrets.nameForSshPassword(id))?.value
    const sshPassphrase = this.secrets.resolve(Secrets.nameForSshPassphrase(id))?.value
    const created = await this.open(config, password, sshPassword, sshPassphrase)
    this.config.touchConnection(id)
    return created.server
  }

  async disconnect(id: string): Promise<void> {
    const session = this.sessions.get(id)
    if (session === undefined) return
    this.sessions.delete(id)
    await session.engine.disconnect().catch(() => undefined)
    await session.transport?.close().catch(() => undefined)
  }

  async schemas(id: string, filter = ''): Promise<SchemaInfo[]> {
    return this.require(id).engine.listSchemas(filter)
  }

  async objects(id: string, schema: string): Promise<SchemaObject[]> {
    return this.require(id).engine.listObjects(schema)
  }

  async setSchema(id: string, schema: string): Promise<void> {
    await this.require(id).engine.setSchema(schema)
  }

  async describe(id: string, schema: string, table: string, kind: ObjectKind = 'table'): Promise<TableDescription> {
    return this.require(id).engine.describe(schema, table, kind)
  }

  async ddl(id: string, schema: string, table: string, kind: ObjectKind = 'table'): Promise<DdlResult> {
    return this.require(id).engine.ddl(schema, table, kind)
  }

  async explain(id: string, sql: string): Promise<ExplainResult> {
    return this.require(id).engine.explain(sql)
  }

  async transaction(id: string, action: 'begin' | 'commit' | 'rollback'): Promise<void> {
    const session = this.require(id)
    await session.engine.transaction(action === 'begin' ? 'begin' : action)
  }

  async query(id: string, sql: string, options: QueryOptions = {}): Promise<QueryResult> {
    const session = this.require(id)
    const statement = sql.trim()
    if (statement === '') throw new DbError('invalid', 'SQL 不能为空')
    if (session.config.readOnly && options.allowWrite === true) {
      throw new DbError('read-only', '只读连接不允许写操作')
    }
    if (options.allowWrite !== true && !isReadOnlySql(statement)) {
      throw new DbError('read-only', '该操作只允许只读语句（SELECT/SHOW/DESCRIBE/EXPLAIN 等）', '请打开连接或先在面板中确认执行。')
    }
    if (options.schema !== undefined && options.schema !== '') await session.engine.setSchema(options.schema)
    const stmtKey = options.stmtKey ?? `stmt-${randomBytes(6).toString('hex')}`
    return session.engine.query(statement, {
      maxRows: options.maxRows,
      timeoutSec: options.timeoutSec,
      stmtKey,
      schema: options.schema,
    })
  }

  async cancel(stmtKey: string): Promise<boolean> {
    let cancelled = false
    for (const session of this.sessions.values()) {
      if (await session.engine.cancel(stmtKey)) cancelled = true
    }
    return cancelled
  }

  async dispose(): Promise<void> {
    const ids = [...this.sessions.keys()]
    for (const id of ids) await this.disconnect(id)
  }
}
