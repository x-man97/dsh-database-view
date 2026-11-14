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

  it('loads the mysql2 pack and exposes createConnection', async () => {
    const pack = manifest.packs.find((entry) => entry.id === 'mysql2')
    expect(pack).toBeDefined()
    const module = await import(pathToFileURL(pack.file).href)
    expect(typeof module.createConnection).toBe('function')
  })
})
