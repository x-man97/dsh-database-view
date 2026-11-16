import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ConfigStore } from '../../lib/host/config.js'
import { DriverManager } from '../../lib/host/drivers/manager.js'
import { NativeSqlService } from '../../lib/host/native.js'
import { SecretStore } from '../../lib/host/secrets.js'

const dirs = []
const services = []

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'dshdb-native-'))
  dirs.push(dir)
  const secrets = new SecretStore(join(dir, 'secrets.json'))
  const config = new ConfigStore(join(dir, 'connections.json'), secrets)
  config.load()
  const paths = { root: process.cwd(), dataDir: dir, configFile: join(dir, 'connections.json'), version: '0.0.0' }
  const sql = new NativeSqlService(paths, config, secrets, new DriverManager(paths), () => undefined)
  services.push(sql)
  const connection = config.saveConnection({
    name: 'Local SQLite',
    driver: 'sqlite',
    host: '',
    port: 0,
    user: '',
    database: join(dir, 'data.sqlite'),
    readOnly: false,
  })
  return { sql, id: connection.id }
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('statement cancellation', () => {
  it('ignores a key whose statement already finished', async () => {
    const { sql, id } = setup()
    await sql.connect(id)

    const result = await sql.query(id, 'SELECT 1 AS n', { stmtKey: 'console-finished' })
    expect(result.rows[0][0]).toBe(1)

    expect(await sql.cancel('console-finished')).toBe(false)
    expect(sql.isConnected(id)).toBe(true)
  })
})

describe('session liveness', () => {
  it('reopens a session whose engine connection was dropped', async () => {
    const { sql, id } = setup()
    await sql.connect(id)

    const engine = sql.sessions.get(id).engine
    await engine.disconnect()
    expect(engine.isOpen()).toBe(false)

    const server = await sql.connect(id)
    expect(server.product).toBe('SQLite')
    expect(sql.sessions.get(id).engine.isOpen()).toBe(true)

    const result = await sql.query(id, 'SELECT 1 AS n')
    expect(result.rows[0][0]).toBe(1)
  })
})
