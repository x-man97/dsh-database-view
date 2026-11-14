import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

import { isPresetId, PRESETS, presetOf } from '../shared/presets.js'
import { lenientKeybindings, parseKeybindings } from '../shared/keymap.js'
import { readConsoleActionOrder } from '../shared/consoleactions.js'
import { readToolbarActionOrder } from '../shared/toolbaractions.js'
import type {
  ClientConfig,
  ClientConnection,
  ClientTrashedConnection,
  ConnectionConfig,
  ConnectionDraft,
  DbConfigFile,
  DbSettings,
  SshConfig,
  TlsConfig,
  TrashedConnection,
} from '../shared/types.js'
import { DbError, errorMessage } from './errors.js'
import type { SecretStore } from './secrets.js'
import { SecretStore as Store } from './secrets.js'

export const DEFAULT_SETTINGS: DbSettings = {
  maxRows: 200,
  queryTimeoutSec: 30,
  connectTimeoutSec: 10,
  allowAgentWrites: false,
  redisScanCount: 200,
  confirmDestructive: true,
  keybindings: {},
  consoleActions: [],
  consoleAutoComplete: true,
  toolbarActions: [],
}

const NAME_MAX = 80
const TEXT_MAX = 255
const DATABASE_MAX = 256
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export const SETTING_KEYS: (keyof DbSettings)[] = [
  'maxRows',
  'queryTimeoutSec',
  'connectTimeoutSec',
  'allowAgentWrites',
  'redisScanCount',
  'confirmDestructive',
  'keybindings',
  'consoleActions',
  'consoleAutoComplete',
  'toolbarActions',
]

function nowIso(): string {
  return new Date().toISOString()
}

function randId(prefix: string): string {
  return `${prefix}-${randomBytes(5).toString('hex')}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown, field: string, max = TEXT_MAX, required = false): string {
  if (typeof value !== 'string') {
    if (required) throw new DbError('invalid', `${field} 必须是字符串`)
    return ''
  }
  const trimmed = value.trim()
  if (trimmed.length > max) throw new DbError('invalid', `${field} 不能超过 ${max} 个字符`)
  if (required && trimmed === '') throw new DbError('invalid', `${field} 不能为空`)
  return trimmed
}

/** Ports are optional when the preset says so (SQLite); absent/0 means "use the preset default". */
function asPortOptional(value: unknown, field: string, fallback: number): number {
  if (value === undefined || value === null || value === '' || value === 0) return fallback
  return asPort(value, field)
}

function asPort(value: unknown, field: string, fallback?: number): number {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback
    throw new DbError('invalid', `${field} 不能为空`)
  }
  const port = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new DbError('invalid', `${field} 必须是 1-65535 的整数`)
  return port
}

function asInt(value: unknown, field: string, min: number, max: number, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new DbError('invalid', `${field} 必须是 ${min}-${max} 的整数`)
  return parsed
}

function sanitizeSsh(raw: unknown): SshConfig | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!isRecord(raw)) throw new DbError('invalid', 'SSH 配置必须是对象')
  if (raw.enabled !== true) return undefined
  const host = asString(raw.host, 'SSH 主机', TEXT_MAX, true)
  const port = asPort(raw.port, 'SSH 端口', 22)
  const user = asString(raw.user, 'SSH 用户名', 128, true)
  const authRaw = asString(raw.auth, 'SSH 认证方式', 16, true)
  const auth = authRaw === 'password' || authRaw === 'key' || authRaw === 'agent' ? authRaw : undefined
  if (auth === undefined) throw new DbError('invalid', 'SSH 认证方式只能是 password、key 或 agent')
  const policyRaw = asString(raw.hostKeyPolicy, 'SSH 主机密钥策略', 16)
  const hostKeyPolicy = policyRaw === 'strict' || policyRaw === 'accept-new' || policyRaw === 'ask' ? policyRaw : 'ask'
  const privateKeyPath = asString(raw.privateKeyPath, 'SSH 私钥路径', 1024)
  return {
    enabled: true,
    host,
    port,
    user,
    auth,
    hostKeyPolicy,
    ...(privateKeyPath === '' ? {} : { privateKeyPath }),
    connectTimeoutMs: asInt(raw.connectTimeoutMs, 'SSH 连接超时', 1000, 120000, 15000),
    keepaliveIntervalMs: asInt(raw.keepaliveIntervalMs, 'SSH keepalive', 5000, 300000, 30000),
  }
}

function sanitizeTls(raw: unknown): TlsConfig | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!isRecord(raw)) throw new DbError('invalid', 'TLS 配置必须是对象')
  const modeRaw = asString(raw.mode, 'TLS 模式', 16)
  const mode = modeRaw === 'disable' || modeRaw === 'prefer' || modeRaw === 'require' || modeRaw === 'verify-ca' || modeRaw === 'verify-full'
    ? modeRaw
    : undefined
  if (mode === undefined) throw new DbError('invalid', 'TLS 模式不合法')
  if (mode === 'disable') return undefined
  const caPath = asString(raw.caPath, 'CA 证书路径', 1024)
  const certPath = asString(raw.certPath, '客户端证书路径', 1024)
  const keyPath = asString(raw.keyPath, '客户端私钥路径', 1024)
  const servername = asString(raw.servername, 'TLS servername', TEXT_MAX)
  return {
    mode,
    ...(caPath === '' ? {} : { caPath }),
    ...(certPath === '' ? {} : { certPath }),
    ...(keyPath === '' ? {} : { keyPath }),
    ...(servername === '' ? {} : { servername }),
    ...(raw.allowInvalidHostname === true ? { allowInvalidHostname: true } : {}),
  }
}

export class ConfigStore {
  private data: DbConfigFile = { version: 2, connections: [], trash: [], settings: { ...DEFAULT_SETTINGS } }

  constructor(
    readonly file: string,
    private readonly secrets: SecretStore,
    private readonly log: (message: string) => void = () => {},
  ) {}

  load(): void {
    if (!existsSync(this.file)) {
      this.data = { version: 2, connections: [], trash: [], settings: { ...DEFAULT_SETTINGS } }
      return
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      if (!isRecord(parsed)) throw new Error('config root is not an object')
      const connections = Array.isArray(parsed.connections) ? parsed.connections : []
      const trash = Array.isArray(parsed.trash) ? parsed.trash : []
      const settings = isRecord(parsed.settings) ? parsed.settings : {}
      this.data = {
        version: 2,
        connections: [],
        trash: [],
        settings: this.hydrateSettings(settings),
      }
      // Legacy/unsupported connections are dropped here.
      this.data.connections = connections.flatMap((entry) => this.hydrateConnection(entry))
      const active = new Set(this.data.connections.map((entry) => entry.id))
      this.data.trash = trash
        .flatMap((entry) => this.hydrateTrash(entry))
        .filter((entry) => !active.has(entry.id))
    } catch (error) {
      const backup = `${this.file}.corrupt-${Date.now()}`
      try {
        renameSync(this.file, backup)
      } catch {
        // keep the original if the backup cannot be written
      }
      this.log(`connections.json is corrupt (${errorMessage(error)}); moved to ${backup}`)
      this.data = { version: 2, connections: [], trash: [], settings: { ...DEFAULT_SETTINGS } }
    }
  }

  private hydrateSettings(raw: Record<string, unknown>): DbSettings {
    const settings = { ...DEFAULT_SETTINGS }
    for (const key of SETTING_KEYS) {
      const value = raw[key]
      try {
        switch (key) {
          case 'maxRows':
            settings.maxRows = asInt(value, 'maxRows', 1, 5000, settings.maxRows)
            break
          case 'queryTimeoutSec':
            settings.queryTimeoutSec = asInt(value, 'queryTimeoutSec', 1, 600, settings.queryTimeoutSec)
            break
          case 'connectTimeoutSec':
            settings.connectTimeoutSec = asInt(value, 'connectTimeoutSec', 1, 120, settings.connectTimeoutSec)
            break
          case 'redisScanCount':
            settings.redisScanCount = asInt(value, 'redisScanCount', 10, 10000, settings.redisScanCount)
            break
          case 'allowAgentWrites':
            settings.allowAgentWrites = value === true
            break
          case 'confirmDestructive':
            settings.confirmDestructive = value !== false
            break
          case 'keybindings':
            settings.keybindings = lenientKeybindings(value)
            break
          case 'consoleActions':
            settings.consoleActions = readConsoleActionOrder(value)
            break
          case 'consoleAutoComplete':
            settings.consoleAutoComplete = value !== false
            break
          case 'toolbarActions':
            settings.toolbarActions = readToolbarActionOrder(value)
            break
        }
      } catch {
        // ignore a single bad setting
      }
    }
    return settings
  }

  private hydrateConnection(raw: unknown): ConnectionConfig[] {
    if (!isRecord(raw)) return []
    try {
      const id = asString(raw.id, 'connection.id', 64, true)
      if (!ID_PATTERN.test(id)) return []
      const driverRaw = asString(raw.driver, 'connection.driver', 64, true)
      if (!isPresetId(driverRaw)) return []
      const preset = PRESETS[driverRaw]
      const secretName = typeof raw.secretName === 'string' && raw.secretName !== '' ? raw.secretName : undefined
      const ssh = sanitizeSsh(raw.ssh)
      const tls = sanitizeTls(raw.tls)
      const hostOptional = preset.hostOptional === true
      return [{
        id,
        name: asString(raw.name, 'connection.name', NAME_MAX, true),
        driver: driverRaw,
        dialect: preset.dialect,
        host: asString(raw.host, 'connection.host', TEXT_MAX, !hostOptional),
        port: hostOptional ? asPortOptional(raw.port, 'connection.port', 0) : asPort(raw.port, 'connection.port', 0),
        user: asString(raw.user, 'connection.user', 128),
        ...(secretName === undefined ? {} : { secretName }),
        hasPassword: typeof secretName === 'string' && this.secrets.has(secretName),
        database: asString(raw.database, 'connection.database', DATABASE_MAX),
        redisDb: asInt(raw.redisDb, 'connection.redisDb', 0, 255, 0),
        readOnly: raw.readOnly === true,
        ...(ssh === undefined ? {} : { ssh }),
        ...(tls === undefined ? {} : { tls }),
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowIso(),
        ...(typeof raw.lastUsedAt === 'string' ? { lastUsedAt: raw.lastUsedAt } : {}),
      }]
    } catch {
      return []
    }
  }

  private hydrateTrash(raw: unknown): TrashedConnection[] {
    const [connection] = this.hydrateConnection(raw)
    if (connection === undefined || !isRecord(raw)) return []
    return [{ ...connection, deletedAt: typeof raw.deletedAt === 'string' ? raw.deletedAt : nowIso() }]
  }

  get(): DbConfigFile {
    return this.data
  }

  settings(): DbSettings {
    return this.data.settings
  }

  private toClient(conn: ConnectionConfig): ClientConnection {
    return {
      id: conn.id,
      name: conn.name,
      driver: conn.driver,
      dialect: conn.dialect,
      host: conn.host,
      port: conn.port,
      user: conn.user,
      hasPassword: conn.secretName !== undefined && this.secrets.has(conn.secretName),
      database: conn.database,
      redisDb: conn.redisDb,
      readOnly: conn.readOnly,
      ...(conn.ssh === undefined ? {} : { ssh: { ...conn.ssh } }),
      ...(conn.tls === undefined ? {} : { tls: { ...conn.tls } }),
      hasSshPassword: conn.ssh !== undefined && this.secrets.has(Store.nameForSshPassword(conn.id)),
      hasSshPassphrase: conn.ssh !== undefined && this.secrets.has(Store.nameForSshPassphrase(conn.id)),
      createdAt: conn.createdAt,
      ...(conn.lastUsedAt === undefined ? {} : { lastUsedAt: conn.lastUsedAt }),
    }
  }

  snapshot(): ClientConfig {
    const connections: ClientConnection[] = this.data.connections.map((conn) => this.toClient(conn))
    const trash: ClientTrashedConnection[] = this.data.trash.map((conn) => ({
      ...this.toClient(conn),
      deletedAt: conn.deletedAt,
    }))
    return {
      connections,
      trash,
      settings: { ...this.data.settings },
    }
  }

  connection(id: string): ConnectionConfig | undefined {
    return this.data.connections.find((connection) => connection.id === id)
  }

  saveConnection(raw: unknown): ConnectionConfig {
    if (!isRecord(raw)) throw new DbError('invalid', '连接内容无效')
    const existingId = typeof raw.id === 'string' && raw.id !== '' ? raw.id : undefined
    const existing = existingId === undefined ? undefined : this.connection(existingId)
    if (existingId !== undefined && existing === undefined) throw new DbError('not-found', `连接不存在：${existingId}`)

    const draft = raw as unknown as ConnectionDraft
    const name = asString(draft.name, '名称', NAME_MAX, true)
    const driverRaw = asString(draft.driver, '驱动', 64, true)
    if (!isPresetId(driverRaw)) throw new DbError('invalid', `不支持的数据库驱动：${driverRaw}`)
    const driver = driverRaw
    const dialect = PRESETS[driver].dialect
    const preset = PRESETS[driver]
    const hostOptional = preset.hostOptional === true
    const host = asString(draft.host, '主机', TEXT_MAX, !hostOptional)
    const port = hostOptional ? asPortOptional(draft.port, '端口', preset.defaultPort) : asPort(draft.port, '端口', preset.defaultPort)
    const user = asString(draft.user, '用户名', 128)
    const database = dialect === 'redis' ? '' : asString(draft.database, '数据库', DATABASE_MAX)
    if (dialect === 'sqlite' && database.trim() === '') {
      throw new DbError('invalid', 'SQLite 连接需要数据库文件路径（database），例如 D:/data/app.db 或 :memory:')
    }
    const redisDb = dialect === 'redis' ? asInt(draft.redisDb, 'Redis 库序号', 0, 255, 0) : 0
    // The read-only flag is decided when the connection is created and is immutable
    // afterwards: edits always keep the stored value, even if a caller sends another.
    const readOnly = existing === undefined ? draft.readOnly === true : existing.readOnly
    const ssh = sanitizeSsh(draft.ssh)
    const tls = sanitizeTls(draft.tls)

    const id = existing?.id ?? randId('conn')
    const secretName = existing?.secretName ?? Store.nameForConnection(id)
    if (typeof draft.password === 'string' && draft.password !== '') this.secrets.set(secretName, draft.password)
    else if (draft.clearPassword === true) this.secrets.delete(secretName)

    if (ssh !== undefined) {
      const sshPasswordName = Store.nameForSshPassword(id)
      const sshPassphraseName = Store.nameForSshPassphrase(id)
      if (typeof draft.sshPassword === 'string' && draft.sshPassword !== '') this.secrets.set(sshPasswordName, draft.sshPassword)
      if (typeof draft.sshPassphrase === 'string' && draft.sshPassphrase !== '') this.secrets.set(sshPassphraseName, draft.sshPassphrase)
    }

    const connection: ConnectionConfig = {
      id,
      name,
      driver,
      dialect,
      host,
      port,
      user,
      secretName,
      hasPassword: this.secrets.has(secretName),
      database,
      redisDb,
      readOnly,
      ...(ssh === undefined ? {} : { ssh }),
      ...(tls === undefined ? {} : { tls }),
      createdAt: existing?.createdAt ?? nowIso(),
      ...(existing?.lastUsedAt === undefined ? {} : { lastUsedAt: existing.lastUsedAt }),
    }
    if (existing === undefined) this.data.connections.push(connection)
    else this.data.connections = this.data.connections.map((entry) => (entry.id === id ? connection : entry))
    this.persist()
    return connection
  }

  /** Connections currently in the recycle bin, newest first. */
  trashed(id: string): TrashedConnection | undefined {
    return this.data.trash.find((connection) => connection.id === id)
  }

  /** Soft delete: move the connection out of the list, keeping password and cache. */
  trashConnection(id: string): TrashedConnection {
    const connection = this.connection(id)
    if (connection === undefined) throw new DbError('not-found', `连接不存在：${id}`)
    this.data.connections = this.data.connections.filter((entry) => entry.id !== id)
    const trashed: TrashedConnection = { ...connection, deletedAt: nowIso() }
    this.data.trash = [trashed, ...this.data.trash]
    this.persist()
    return trashed
  }

  /** Bring a trashed connection back into the list, unchanged. */
  restoreConnection(id: string): ConnectionConfig {
    const trashed = this.trashed(id)
    if (trashed === undefined) throw new DbError('not-found', `回收站中没有该连接：${id}`)
    this.data.trash = this.data.trash.filter((entry) => entry.id !== id)
    const { deletedAt: _deletedAt, ...connection } = trashed
    this.data.connections.push(connection)
    this.persist()
    return connection
  }

  /** Delete for good: works on active or trashed connections, drops the password. */
  purgeConnection(id: string): ConnectionConfig {
    const connection = this.connection(id) ?? this.trashed(id)
    if (connection === undefined) throw new DbError('not-found', `连接不存在：${id}`)
    this.data.connections = this.data.connections.filter((entry) => entry.id !== id)
    this.data.trash = this.data.trash.filter((entry) => entry.id !== id)
    if (connection.secretName !== undefined) this.secrets.delete(connection.secretName)
    this.secrets.delete(Store.nameForSshPassword(connection.id))
    this.secrets.delete(Store.nameForSshPassphrase(connection.id))
    this.persist()
    return connection
  }

  /** Purge every trashed connection; returns how many were removed. */
  emptyTrash(): number {
    const count = this.data.trash.length
    for (const connection of this.data.trash) {
      if (connection.secretName !== undefined) this.secrets.delete(connection.secretName)
      this.secrets.delete(Store.nameForSshPassword(connection.id))
      this.secrets.delete(Store.nameForSshPassphrase(connection.id))
    }
    this.data.trash = []
    this.persist()
    return count
  }

  /** Apply a new display order. Unknown ids are ignored and unmentioned connections keep their order at the end. */
  reorderConnections(ids: string[]): ClientConfig {
    const byId = new Map(this.data.connections.map((connection) => [connection.id, connection]))
    const ordered: ConnectionConfig[] = []
    const seen = new Set<string>()
    for (const id of ids) {
      const connection = byId.get(id)
      if (connection === undefined || seen.has(id)) continue
      seen.add(id)
      ordered.push(connection)
    }
    for (const connection of this.data.connections) if (!seen.has(connection.id)) ordered.push(connection)
    const changed = ordered.some((connection, index) => connection.id !== this.data.connections[index]?.id)
    if (changed) {
      this.data.connections = ordered
      this.persist()
    }
    return this.snapshot()
  }

  touchConnection(id: string): void {
    const connection = this.connection(id)
    if (connection === undefined) return
    connection.lastUsedAt = nowIso()
    this.persist()
  }

  updateSettings(raw: unknown): DbSettings {
    if (!isRecord(raw)) throw new DbError('invalid', '设置内容无效')
    const next = { ...this.data.settings }
    for (const key of SETTING_KEYS) {
      if (!(key in raw)) continue
      const value = raw[key]
      switch (key) {
        case 'maxRows':
          next.maxRows = asInt(value, '最大返回行数', 1, 5000, next.maxRows)
          break
        case 'queryTimeoutSec':
          next.queryTimeoutSec = asInt(value, '查询超时（秒）', 1, 600, next.queryTimeoutSec)
          break
        case 'connectTimeoutSec':
          next.connectTimeoutSec = asInt(value, '连接超时（秒）', 1, 120, next.connectTimeoutSec)
          break
        case 'redisScanCount':
          next.redisScanCount = asInt(value, 'Redis SCAN 数量', 10, 10000, next.redisScanCount)
          break
        case 'allowAgentWrites':
          if (typeof value !== 'boolean') throw new DbError('invalid', 'allowAgentWrites 必须是布尔值')
          next.allowAgentWrites = value
          break
        case 'confirmDestructive':
          if (typeof value !== 'boolean') throw new DbError('invalid', 'confirmDestructive 必须是布尔值')
          next.confirmDestructive = value
          break
        case 'keybindings':
          // 组合键是否冲突由共享注册表判断，这里只负责报错信息。
          try {
            next.keybindings = parseKeybindings(value)
          } catch (error) {
            throw new DbError('invalid', errorMessage(error))
          }
          break
        case 'consoleActions':
          if (!Array.isArray(value)) throw new DbError('invalid', 'consoleActions 必须是数组')
          next.consoleActions = readConsoleActionOrder(value)
          break
        case 'consoleAutoComplete':
          if (typeof value !== 'boolean') throw new DbError('invalid', 'consoleAutoComplete 必须是布尔值')
          next.consoleAutoComplete = value
          break
        case 'toolbarActions':
          if (!Array.isArray(value)) throw new DbError('invalid', 'toolbarActions 必须是数组')
          next.toolbarActions = readToolbarActionOrder(value)
          break
      }
    }
    this.data.settings = next
    this.persist()
    return next
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const temp = `${this.file}.tmp-${process.pid}`
    writeFileSync(temp, `${JSON.stringify(this.data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(temp, this.file)
  }
}
