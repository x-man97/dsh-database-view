import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('bundled driver packs', () => {
  const manifest = JSON.parse(readFileSync('drivers.json', 'utf8'))

  it('references existing files with matching size and sha256', () => {
    expect(manifest.version).toBe(1)
    expect(manifest.packs.length).toBeGreaterThan(0)
    for (const pack of manifest.packs) {
      expect(pack.delivery).toBe('bundled')
      const payload = readFileSync(pack.file)
      expect(payload.length).toBe(pack.bytes)
      expect(createHash('sha256').update(payload).digest('hex')).toBe(pack.sha256)
    }
  })

  it('loads every pack and exposes its expected API', async () => {
    const expected = {
      mysql2: ['createConnection'],
      pg: ['Client', 'types'],
      tedious: ['Connection', 'Request'],
      'oracledb-thin': ['getConnection', 'DATE'],
    }
    for (const [id, names] of Object.entries(expected)) {
      const pack = manifest.packs.find((entry) => entry.id === id)
      expect(pack, id).toBeDefined()
      const module = await import(pathToFileURL(pack.file).href)
      for (const name of names) expect(typeof module[name], `${id}.${name}`).not.toBe('undefined')
    }
  })
})
