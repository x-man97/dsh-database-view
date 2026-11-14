import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface KnownHostEntry {
  keyType: string
  fingerprint: string
  firstSeenAt: string
}

interface KnownHostsFile {
  version: 1
  hosts: Record<string, KnownHostEntry>
}

function fingerprintOf(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
}

export class KnownHostsStore {
  private data: KnownHostsFile = { version: 1, hosts: {} }
  private loaded = false

  constructor(private readonly file: string) {}

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    if (!existsSync(this.file)) return
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as KnownHostsFile
      if (parsed.version === 1 && parsed.hosts !== undefined) this.data = parsed
    } catch {
      // start empty; the UI can surface a warning in a later milestone
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const temp = `${this.file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
    writeFileSync(temp, `${JSON.stringify(this.data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(temp, this.file)
  }

  key(host: string, port: number): string {
    return `${host}:${port}`
  }

  get(host: string, port: number): KnownHostEntry | undefined {
    this.load()
    return this.data.hosts[this.key(host, port)]
  }

  accepts(host: string, port: number, keyType: string, key: Buffer, policy: 'ask' | 'strict' | 'accept-new'): { accepted: boolean; fingerprint: string; changed: boolean } {
    this.load()
    const fingerprint = fingerprintOf(key)
    const existing = this.data.hosts[this.key(host, port)]
    if (existing !== undefined) {
      const changed = existing.fingerprint !== fingerprint || existing.keyType !== keyType
      return { accepted: !changed, fingerprint, changed }
    }
    if (policy === 'strict') return { accepted: false, fingerprint, changed: false }
    this.data.hosts[this.key(host, port)] = { keyType, fingerprint, firstSeenAt: new Date().toISOString() }
    this.persist()
    return { accepted: true, fingerprint, changed: false }
  }
}
