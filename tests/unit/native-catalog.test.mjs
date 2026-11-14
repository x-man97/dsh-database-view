import { describe, expect, it } from 'vitest'

import { coreEngines, nativeKindFor } from '../../lib/host/db/catalog.js'

describe('native engine catalog', () => {
  it('registers the five SQL engines with bundled driver ids', () => {
    const byKind = Object.fromEntries(coreEngines.map((entry) => [entry.descriptor.kind, entry.descriptor]))
    expect(Object.keys(byKind).sort()).toEqual(['mssql', 'mysql', 'oracle', 'postgres', 'sqlite'])
    expect(byKind.mysql.driverId).toBe('mysql2')
    expect(byKind.postgres.driverId).toBe('pg')
    expect(byKind.mssql.driverId).toBe('tedious')
    expect(byKind.oracle.driverId).toBe('oracledb-thin')
    expect(byKind.sqlite.driverId).toBe('node:sqlite')
  })

  it('maps database presets to engine kinds', () => {
    expect(nativeKindFor('mariadb')).toBe('mysql')
    expect(nativeKindFor('postgres')).toBe('postgres')
    expect(nativeKindFor('sqlite')).toBe('sqlite')
    expect(nativeKindFor('mssql')).toBe('mssql')
    expect(nativeKindFor('oracle')).toBe('oracle')
    expect(nativeKindFor('redis')).toBeUndefined()
  })
})
