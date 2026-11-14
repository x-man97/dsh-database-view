import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { loadTls } from '../../lib/host/tls.js'

const dirs = []
function tempCa() {
  const dir = mkdtempSync(join(tmpdir(), 'dshdb-tls-'))
  dirs.push(dir)
  const file = join(dir, 'ca.pem')
  writeFileSync(file, '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n')
  return file
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('loadTls', () => {
  it('reads CA files and keeps full verification by default', () => {
    const loaded = loadTls({ mode: 'verify-full', caPath: tempCa() })
    expect(loaded?.rejectUnauthorized).toBe(true)
    expect(loaded?.verifyIdentity).toBe(true)
    expect(Buffer.isBuffer(loaded?.ca)).toBe(true)
  })

  it('can skip hostname verification and reads no files when disabled', () => {
    expect(loadTls({ mode: 'verify-ca', allowInvalidHostname: true })?.verifyIdentity).toBe(false)
    expect(loadTls({ mode: 'disable' })).toBeUndefined()
  })

  it('reports a readable error for a missing certificate', () => {
    expect(() => loadTls({ mode: 'verify-full', caPath: '/definitely/missing/ca.pem' })).toThrow(/CA 证书/)
  })
})
