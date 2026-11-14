import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ConfigStore } from '../../lib/host/config.js'
import { SecretStore } from '../../lib/host/secrets.js'

const dirs = []

function store() {
  const dir = mkdtempSync(join(tmpdir(), 'dshdb-config-'))
  dirs.push(dir)
  const secrets = new SecretStore(join(dir, 'secrets.json'))
  const config = new ConfigStore(join(dir, 'connections.json'), secrets)
  config.load()
  return { config, secrets, dir }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('ConfigStore', () => {
  it('starts with safe defaults', () => {
    const { config } = store()
    expect(config.snapshot()).toMatchObject({
      connections: [],
      settings: { maxRows: 200, allowAgentWrites: false, connectTimeoutSec: 10 },
    })
  })

  it('saves a connection and keeps the password in the secret store', () => {
    const { config, secrets } = store()
    const saved = config.saveConnection({
      name: 'Local MySQL',
      driver: 'mysql',
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: 's3cret',
      database: 'app',
      readOnly: false,
    })
    expect(saved.hasPassword).toBe(true)
    expect(saved.secretName).toBeTruthy()
    expect(JSON.stringify(config.snapshot())).not.toContain('s3cret')
    expect(secrets.has(saved.secretName)).toBe(true)
    expect(secrets.resolve(saved.secretName)?.value).toBe('s3cret')
  })

  it('duplicates a connection with its password and SSH credentials', () => {
    const { config, secrets } = store()
    const saved = config.saveConnection({
      name: 'SSH MySQL',
      driver: 'mysql',
      host: '10.0.0.12',
      port: 3306,
      user: 'root',
      password: 'dbpass',
      database: 'app',
      readOnly: true,
      ssh: {
        enabled: true,
        host: 'bastion.example.com',
        port: 22,
        user: 'ops',
        auth: 'password',
        hostKeyPolicy: 'accept-new',
      },
      sshPassword: 'sshpass',
    })

    const copy = config.duplicateConnection(saved.id, 'SSH MySQL copy')
    expect(copy.id).not.toBe(saved.id)
    expect(copy.name).toBe('SSH MySQL copy')
    expect(copy.readOnly).toBe(true)
    expect(copy.secretName).not.toBe(saved.secretName)
    expect(secrets.resolve(copy.secretName)?.value).toBe('dbpass')
    expect(secrets.resolve(`DSH_DB_SSH_PASSWORD_${copy.id.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`)?.value).toBe('sshpass')
    expect(config.snapshot().connections).toHaveLength(2)
    expect(config.snapshot().connections[0].hasPassword).toBe(true)
  })

  it('copies a saved password when saving a new connection from copyFromId', () => {
    const { config, secrets } = store()
    const source = config.saveConnection({
      name: 'Source', driver: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', password: 'secret', database: 'app',
    })
    const copy = config.saveConnection({
      name: 'Copy', driver: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', database: 'app', copyFromId: source.id,
    })
    expect(copy.id).not.toBe(source.id)
    expect(secrets.resolve(copy.secretName)?.value).toBe('secret')
  })

  it('stores native engine and SSH settings without leaking SSH secrets', () => {
    const { config, secrets, dir } = store()
    const saved = config.saveConnection({
      name: 'SSH MySQL',
      driver: 'mysql',
      host: '10.0.0.12',
      port: 3306,
      user: 'root',
      password: 'dbpass',
      database: 'app',
      readOnly: false,
      ssh: {
        enabled: true,
        host: 'bastion.example.com',
        port: 22,
        user: 'ops',
        auth: 'key',
        privateKeyPath: '~/.ssh/id_ed25519',
        hostKeyPolicy: 'accept-new',
      },
      sshPassphrase: 'ssh-passphrase-value-42',
    })
    expect(saved.ssh?.host).toBe('bastion.example.com')
    expect(saved.ssh?.privateKeyPath).toBe('~/.ssh/id_ed25519')
    expect(secrets.has(SecretStore.nameForSshPassphrase(saved.id))).toBe(true)
    expect(JSON.stringify(config.snapshot())).not.toContain('ssh-passphrase-value-42')

    const reloaded = new ConfigStore(join(dir, 'connections.json'), new SecretStore(join(dir, 'secrets.json')))
    reloaded.load()
    expect(reloaded.connection(saved.id)?.ssh?.user).toBe('ops')
  })

  it('updates an existing connection and can clear its password', () => {
    const { config, secrets } = store()
    const saved = config.saveConnection({
      name: 'Local MySQL', driver: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', password: 'pw', database: 'app',
    })
    const updated = config.saveConnection({
      id: saved.id, name: 'Local MySQL 2', driver: 'mysql', host: '127.0.0.1', port: 3307, user: 'root',
      password: '', clearPassword: true, database: 'app2',
    })
    expect(updated.id).toBe(saved.id)
    expect(updated.port).toBe(3307)
    expect(updated.hasPassword).toBe(false)
    expect(secrets.has(saved.secretName)).toBe(false)
  })

  it('updates the read-only flag with the other connection fields', () => {
    const { config } = store()
    const readOnly = config.saveConnection({
      name: 'Report', driver: 'mysql', host: '127.0.0.1', port: 3306, user: 'ro', database: 'app', readOnly: true,
    })
    expect(readOnly.readOnly).toBe(true)

    const renamed = config.saveConnection({
      id: readOnly.id, name: 'Report 2', driver: 'mysql', host: '127.0.0.1', port: 3306, user: 'ro', database: 'app', readOnly: false,
    })
    expect(renamed.name).toBe('Report 2')
    expect(renamed.readOnly).toBe(false)

    const writable = config.saveConnection({ name: 'Writable', driver: 'mysql', host: '127.0.0.1', port: 3306, user: 'rw', database: 'app' })
    expect(writable.readOnly).toBe(false)
    const later = config.saveConnection({
      id: writable.id, name: 'Writable', driver: 'mysql', host: '127.0.0.1', port: 3306, user: 'rw', database: 'app', readOnly: true,
    })
    expect(later.readOnly).toBe(true)
  })

  it('round-trips a native SQLite connection without a host', () => {
    const { config, dir } = store()
    const saved = config.saveConnection({
      name: 'SQLite Demo',
      driver: 'sqlite',
      host: '',
      port: 0,
      user: '',
      database: '/tmp/demo.db',
      readOnly: false,
    })
    const reloaded = new ConfigStore(join(dir, 'connections.json'), new SecretStore(join(dir, 'secrets.json')))
    reloaded.load()
    expect(reloaded.connection(saved.id)).toMatchObject({
      driver: 'sqlite',
      host: '',
      database: '/tmp/demo.db',
    })
  })

  it('migrates v1 config and drops unsupported/JDBC-era connections', () => {
    const { dir } = store()
    const file = join(dir, 'connections.json')
    writeFileSync(file, JSON.stringify({
      version: 1,
      connections: [
        { id: 'conn-native', name: 'MySQL', driver: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', database: 'app', params: {}, nativeEngine: false },
        { id: 'conn-dm', name: 'DM', driver: 'dameng', host: '127.0.0.1', port: 5236, user: 'SYSDBA', database: 'x' },
        { id: 'conn-custom', name: 'Custom', driver: 'custom', customDriverId: 'c1', host: 'x', port: 1 },
      ],
      trash: [],
      drivers: [{ id: 'c1', name: 'H2', dialect: 'generic', driverClass: 'org.h2.Driver', urlTemplate: 'jdbc:h2:{{host}}', jars: [] }],
      settings: { javaPath: '/usr/bin/java', mavenMirror: 'central', maxRows: 100 },
    }))
    const config = new ConfigStore(file, new SecretStore(join(dir, 'secrets.json')))
    config.load()
    expect(config.snapshot().connections.map((entry) => entry.driver)).toEqual(['mysql'])
    const persisted = JSON.parse(readFileSync(file, 'utf8'))
    expect(persisted.version).toBe(2)
    expect(persisted.drivers).toBeUndefined()
    expect(persisted.settings.javaPath).toBeUndefined()
  })

  it('rejects invalid ports and oversized row limits', () => {
    const { config } = store()
    expect(() =>
      config.saveConnection({ name: 'bad', driver: 'mysql', host: 'x', port: 70000, user: 'u', database: 'd' }),
    ).toThrow(/端口/)
    expect(() => config.updateSettings({ maxRows: 5_001 })).toThrow(/最大返回行数/)
  })

  it('saves a SQLite connection without host and port', () => {
    const { config } = store()
    const saved = config.saveConnection({ name: 'Local SQLite', driver: 'sqlite', database: 'D:/data/app.db' })
    expect(saved).toMatchObject({ dialect: 'sqlite', host: '', port: 0, database: 'D:/data/app.db' })
    expect(() => config.saveConnection({ name: 'no file', driver: 'sqlite' })).toThrow(/database/)
  })

  it('fills the preset default port when the agent omits it', () => {
    const { config } = store()
    const saved = config.saveConnection({ name: 'Local PG', driver: 'postgres', host: '127.0.0.1', database: 'app' })
    expect(saved.port).toBe(5432)
  })

  it('stores rebindings, drops unusable ones on load and refuses bad saves', () => {
    const { config, dir } = store()
    config.updateSettings({ keybindings: { 'console.clear': 'MOD+K' } })
    expect(config.snapshot().settings.keybindings).toEqual({ 'console.clear': 'mod+k' })
    expect(() => config.updateSettings({ keybindings: { 'console.clear': 'mod+enter' } })).toThrow(/同时绑给了/)
    expect(() => config.updateSettings({ keybindings: { nope: 'mod+k' } })).toThrow(/未知的快捷键/)
    expect(config.snapshot().settings.keybindings).toEqual({ 'console.clear': 'mod+k' })

    const secrets = new SecretStore(join(dir, 'secrets.json'))
    const reloaded = new ConfigStore(join(dir, 'connections.json'), secrets)
    reloaded.load()
    expect(reloaded.snapshot().settings.keybindings).toEqual({ 'console.clear': 'mod+k' })
  })

  it('stores the console toolbar order and reloads it without unknown ids', () => {
    const { config, dir } = store()
    config.updateSettings({ consoleActions: ['export', 'nope', 'run', 'export', 'save'] })
    expect(config.snapshot().settings.consoleActions).toEqual(['export', 'run', 'save'])
    expect(() => config.updateSettings({ consoleActions: 'export' })).toThrow(/consoleActions/)

    const secrets = new SecretStore(join(dir, 'secrets.json'))
    const reloaded = new ConfigStore(join(dir, 'connections.json'), secrets)
    reloaded.load()
    expect(reloaded.snapshot().settings.consoleActions).toEqual(['export', 'run', 'save'])
  })

  it('defaults console auto-complete on and persists the switch', () => {
    const { config, dir } = store()
    expect(config.snapshot().settings.consoleAutoComplete).toBe(true)
    expect(() => config.updateSettings({ consoleAutoComplete: 'yes' })).toThrow(/consoleAutoComplete/)

    config.updateSettings({ consoleAutoComplete: false })
    expect(config.snapshot().settings.consoleAutoComplete).toBe(false)

    const secrets = new SecretStore(join(dir, 'secrets.json'))
    const reloaded = new ConfigStore(join(dir, 'connections.json'), secrets)
    reloaded.load()
    expect(reloaded.snapshot().settings.consoleAutoComplete).toBe(false)
  })

  it('persists settings to disk', () => {
    const { config, dir } = store()
    config.updateSettings({ allowAgentWrites: true, maxRows: 50 })
    const secrets = new SecretStore(join(dir, 'secrets.json'))
    const reloaded = new ConfigStore(join(dir, 'connections.json'), secrets)
    reloaded.load()
    expect(reloaded.snapshot().settings).toMatchObject({ allowAgentWrites: true, maxRows: 50 })
  })

  it('trashes a connection but keeps its password and persists it', () => {
    const { config, secrets, dir } = store()
    const saved = config.saveConnection({
      name: 'Soft delete', driver: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', password: 'pw', database: 'app',
    })

    const trashed = config.trashConnection(saved.id)

    expect(trashed.deletedAt).toBeTruthy()
    expect(config.snapshot().connections).toHaveLength(0)
    expect(config.snapshot().trash).toMatchObject([{ id: saved.id, name: 'Soft delete', hasPassword: true }])
    expect(secrets.has(saved.secretName)).toBe(true)

    const reloaded = new ConfigStore(join(dir, 'connections.json'), new SecretStore(join(dir, 'secrets.json')))
    reloaded.load()
    expect(reloaded.snapshot().connections).toHaveLength(0)
    expect(reloaded.snapshot().trash[0]).toMatchObject({ id: saved.id, deletedAt: trashed.deletedAt })
  })

  it('restores a trashed connection with its password intact', () => {
    const { config, secrets } = store()
    const saved = config.saveConnection({
      name: 'Restore me', driver: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', password: 'pw', database: 'app',
    })
    config.trashConnection(saved.id)

    const restored = config.restoreConnection(saved.id)

    expect(restored.id).toBe(saved.id)
    expect(config.snapshot().trash).toHaveLength(0)
    expect(config.snapshot().connections).toMatchObject([{ id: saved.id, hasPassword: true }])
    expect(secrets.has(saved.secretName)).toBe(true)
    expect(() => config.restoreConnection('missing')).toThrow(/回收站中没有/)
  })

  it('purges a trashed connection and deletes its password', () => {
    const { config, secrets } = store()
    const saved = config.saveConnection({
      name: 'Purge me', driver: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', password: 'pw', database: 'app',
    })
    config.trashConnection(saved.id)

    const purged = config.purgeConnection(saved.id)

    expect(purged.id).toBe(saved.id)
    expect(config.snapshot().connections).toHaveLength(0)
    expect(config.snapshot().trash).toHaveLength(0)
    expect(secrets.has(saved.secretName)).toBe(false)
    expect(() => config.purgeConnection(saved.id)).toThrow(/不存在/)
  })

  it('empties the recycle bin and forgets every password', () => {
    const { config, secrets } = store()
    const first = config.saveConnection({
      name: 'One', driver: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', password: 'a', database: 'app',
    })
    const second = config.saveConnection({
      name: 'Two', driver: 'postgres', host: '127.0.0.1', port: 5432, user: 'root', password: 'b', database: 'app',
    })
    config.trashConnection(first.id)
    config.trashConnection(second.id)

    expect(config.emptyTrash()).toBe(2)
    expect(config.snapshot().trash).toEqual([])
    expect(secrets.has(first.secretName)).toBe(false)
    expect(secrets.has(second.secretName)).toBe(false)
  })

  it('reorders connections and remembers the order after a reload', () => {
    const { config, dir } = store()
    const first = config.saveConnection({
      name: 'One', driver: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', database: 'app',
    })
    const second = config.saveConnection({
      name: 'Two', driver: 'mysql', host: '127.0.0.2', port: 3306, user: 'root', database: 'app',
    })
    const third = config.saveConnection({
      name: 'Three', driver: 'mysql', host: '127.0.0.3', port: 3306, user: 'root', database: 'app',
    })

    const reordered = config.reorderConnections([third.id, first.id, second.id])

    expect(reordered.connections.map((connection) => connection.name)).toEqual(['Three', 'One', 'Two'])
    const reloaded = new ConfigStore(join(dir, 'connections.json'), new SecretStore(join(dir, 'secrets.json')))
    reloaded.load()
    expect(reloaded.snapshot().connections.map((connection) => connection.name)).toEqual(['Three', 'One', 'Two'])
  })

  it('ignores unknown ids and keeps unmentioned connections at the end', () => {
    const { config } = store()
    const first = config.saveConnection({
      name: 'One', driver: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', database: 'app',
    })
    const second = config.saveConnection({
      name: 'Two', driver: 'mysql', host: '127.0.0.2', port: 3306, user: 'root', database: 'app',
    })

    const reordered = config.reorderConnections(['ghost', second.id, second.id])

    expect(reordered.connections.map((connection) => connection.id)).toEqual([second.id, first.id])
  })

  it('stores the data-source toolbar order and rejects malformed values', () => {
    const { config, dir } = store()
    expect(config.snapshot().settings.toolbarActions).toEqual([])
    expect(() => config.updateSettings({ toolbarActions: 'settings' })).toThrow(/toolbarActions/)

    config.updateSettings({ toolbarActions: ['duplicate', 'add', 'ghost', 'duplicate'] })

    expect(config.snapshot().settings.toolbarActions).toEqual(['duplicate', 'add'])
    const reloaded = new ConfigStore(join(dir, 'connections.json'), new SecretStore(join(dir, 'secrets.json')))
    reloaded.load()
    expect(reloaded.snapshot().settings.toolbarActions).toEqual(['duplicate', 'add'])
  })
})
