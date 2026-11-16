import { describe, expect, it } from 'vitest'

import { createSchemaSql, supportsCreateSchema } from '../../src/client/schemaddl'

describe('CREATE SCHEMA statements', () => {
  it('quotes the name per dialect', () => {
    expect(createSchemaSql('mysql', 'audit')).toBe('CREATE DATABASE `audit`')
    expect(createSchemaSql('postgres', 'audit')).toBe('CREATE SCHEMA "audit"')
    expect(createSchemaSql('mssql', 'audit')).toBe('CREATE SCHEMA [audit]')
  })

  it('trims the name and escapes quotes', () => {
    expect(createSchemaSql('mysql', '  a`b  ')).toBe('CREATE DATABASE `a``b`')
    expect(createSchemaSql('postgres', 'a"b')).toBe('CREATE SCHEMA "a""b"')
    expect(createSchemaSql('mssql', 'a]b')).toBe('CREATE SCHEMA [a]]b]')
  })

  it('only offers the action where a schema is a plain namespace', () => {
    expect(supportsCreateSchema('mysql')).toBe(true)
    expect(supportsCreateSchema('postgres')).toBe(true)
    expect(supportsCreateSchema('mssql')).toBe(true)
    expect(supportsCreateSchema('sqlite')).toBe(false)
    expect(supportsCreateSchema('oracle')).toBe(false)
    expect(supportsCreateSchema('redis')).toBe(false)
    expect(createSchemaSql('sqlite', 'audit')).toBeNull()
    expect(createSchemaSql('oracle', 'audit')).toBeNull()
  })

  it('rejects an empty name', () => {
    expect(createSchemaSql('mysql', '   ')).toBeNull()
  })
})
