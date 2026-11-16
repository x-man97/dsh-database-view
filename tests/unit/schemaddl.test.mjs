import { describe, expect, it } from 'vitest'

import { createSchemaSql, dropSchemaSql, supportsSchemaDdl } from '../../src/client/schemaddl'

describe('schema DDL statements', () => {
  it('quotes the name per dialect', () => {
    expect(createSchemaSql('mysql', 'audit')).toBe('CREATE DATABASE `audit`')
    expect(createSchemaSql('postgres', 'audit')).toBe('CREATE SCHEMA "audit"')
    expect(createSchemaSql('mssql', 'audit')).toBe('CREATE SCHEMA [audit]')
    expect(dropSchemaSql('mysql', 'audit')).toBe('DROP DATABASE `audit`')
    expect(dropSchemaSql('postgres', 'audit')).toBe('DROP SCHEMA "audit"')
    expect(dropSchemaSql('mssql', 'audit')).toBe('DROP SCHEMA [audit]')
  })

  it('trims the name and escapes quotes', () => {
    expect(createSchemaSql('mysql', '  a`b  ')).toBe('CREATE DATABASE `a``b`')
    expect(createSchemaSql('postgres', 'a"b')).toBe('CREATE SCHEMA "a""b"')
    expect(createSchemaSql('mssql', 'a]b')).toBe('CREATE SCHEMA [a]]b]')
    expect(dropSchemaSql('mysql', 'a`b')).toBe('DROP DATABASE `a``b`')
    expect(dropSchemaSql('postgres', 'a"b')).toBe('DROP SCHEMA "a""b"')
    expect(dropSchemaSql('mssql', 'a]b')).toBe('DROP SCHEMA [a]]b]')
  })

  it('only offers the actions where a schema is a plain namespace', () => {
    for (const dialect of ['mysql', 'postgres', 'mssql']) {
      expect(supportsSchemaDdl(dialect)).toBe(true)
      expect(dropSchemaSql(dialect, 'audit')).not.toBeNull()
    }
    for (const dialect of ['sqlite', 'oracle', 'redis']) {
      expect(supportsSchemaDdl(dialect)).toBe(false)
      expect(createSchemaSql(dialect, 'audit')).toBeNull()
      expect(dropSchemaSql(dialect, 'audit')).toBeNull()
    }
  })

  it('rejects an empty name', () => {
    expect(createSchemaSql('mysql', '   ')).toBeNull()
    expect(dropSchemaSql('postgres', '   ')).toBeNull()
  })
})
