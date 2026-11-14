import { readFileSync } from 'node:fs'
import { createServer, connect, type Server, type Socket } from 'node:net'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { Client, type ConnectConfig } from 'ssh2'

import type { SshConfig } from '../../shared/types.js'
import { DbError, errorMessage } from '../errors.js'
import { KnownHostsStore } from './known-hosts.js'

export interface SshSecret {
  password?: string
  passphrase?: string
}

export interface LocalEndpoint {
  host: string
  port: number
  close(): Promise<void>
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2))
  return resolve(path)
}

/**
 * One SSH client per database connection. The database is reached through a
 * loopback-only local server; each local socket is forwarded with forwardOut.
 */
export class SshTransport {
  private client: Client | undefined
  private server: Server | undefined
  private readonly sockets = new Set<Socket>()
  private readonly knownHosts: KnownHostsStore
  fingerprint: string | undefined

  constructor(
    private readonly config: SshConfig,
    private readonly secret: SshSecret,
    knownHostsFile: string,
    private readonly log: (message: string) => void = () => {},
  ) {
    this.knownHosts = new KnownHostsStore(knownHostsFile)
  }

  async open(): Promise<void> {
    if (this.client !== undefined) return
    const client = new Client()
    this.client = client
    await new Promise<void>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        client.end()
        reject(new DbError('connect-failed', `SSH 连接超时（${this.config.host}:${this.config.port}）`))
      }, this.config.connectTimeoutMs ?? 15000)
      timer.unref()
      client.once('ready', () => {
        clearTimeout(timer)
        resolvePromise()
      })
      client.once('error', (error) => {
        clearTimeout(timer)
        reject(new DbError('connect-failed', `SSH 连接失败：${errorMessage(error)}`))
      })
      try {
        client.connect(this.connectConfig())
      } catch (error) {
        clearTimeout(timer)
        reject(new DbError('connect-failed', `SSH 配置无效：${errorMessage(error)}`))
      }
    })
    this.log(`ssh connected ${this.config.host}:${this.config.port}${this.fingerprint === undefined ? '' : ` (${this.fingerprint})`}`)
  }

  private connectConfig(): ConnectConfig {
    const base: ConnectConfig = {
      host: this.config.host,
      port: this.config.port,
      username: this.config.user,
      readyTimeout: this.config.connectTimeoutMs ?? 15000,
      keepaliveInterval: this.config.keepaliveIntervalMs ?? 30000,
      hostVerifier: (key: Buffer, callback?: (valid: boolean) => void) => {
        const result = this.knownHosts.accepts(this.config.host, this.config.port, 'ssh-host-key', key, this.config.hostKeyPolicy)
        this.fingerprint = result.fingerprint
        const accepted = result.accepted
        if (callback !== undefined) callback(accepted)
        return accepted
      },
    }
    if (this.config.auth === 'password') {
      if (this.secret.password === undefined || this.secret.password === '') {
        throw new DbError('connect-failed', 'SSH 密码未配置')
      }
      return { ...base, password: this.secret.password }
    }
    if (this.config.auth === 'agent') {
      const agent = process.env.SSH_AUTH_SOCK
      if (agent === undefined || agent === '') throw new DbError('connect-failed', '未找到 SSH_AUTH_SOCK，无法使用 ssh-agent')
      return { ...base, agent }
    }
    if (this.config.privateKeyPath === undefined || this.config.privateKeyPath === '') {
      throw new DbError('connect-failed', 'SSH 私钥路径未配置')
    }
    const privateKey = readFileSync(expandHome(this.config.privateKeyPath))
    return { ...base, privateKey, ...(this.secret.passphrase === undefined || this.secret.passphrase === '' ? {} : { passphrase: this.secret.passphrase }) }
  }

  async forwardTo(host: string, port: number): Promise<LocalEndpoint> {
    await this.open()
    if (this.server !== undefined) throw new DbError('connect-failed', 'SSH 隧道已存在')
    const server = createServer((local) => {
      this.sockets.add(local)
      local.once('close', () => this.sockets.delete(local))
      const client = this.client
      if (client === undefined) {
        local.destroy()
        return
      }
      client.forwardOut(local.remoteAddress ?? '127.0.0.1', local.remotePort ?? 0, host, port, (error, remote) => {
        if (error !== null && error !== undefined) {
          this.log(`ssh forward failed ${host}:${port}: ${errorMessage(error)}`)
          local.destroy()
          return
        }
        local.pipe(remote).pipe(local)
        local.on('error', () => remote.destroy())
        remote.on('error', () => local.destroy())
        remote.on('close', () => local.destroy())
      })
    })
    this.server = server
    await new Promise<void>((resolvePromise, reject) => {
      server.once('error', (error) => reject(new DbError('connect-failed', `SSH 本地端口监听失败：${errorMessage(error)}`)))
      server.listen(0, '127.0.0.1', () => resolvePromise())
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new DbError('connect-failed', 'SSH 本地端口分配失败')
    return {
      host: '127.0.0.1',
      port: address.port,
      close: async () => {
        await this.close()
      },
    }
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    const server = this.server
    this.server = undefined
    if (server !== undefined) {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
    }
    const client = this.client
    this.client = undefined
    if (client !== undefined) client.end()
  }
}
