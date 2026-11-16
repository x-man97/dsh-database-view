import { describe, expect, it } from 'vitest'

import { diffTableStructures } from '../../src/client/structurediff.ts'

function table(overrides = {}) {
  return {
    schema: 'app',
    table: 'users',
    kind: 'table',
    columns: [
      { name: 'id', typeName: 'INT', nullable: false, primaryKey: true },
      { name: 'name', typeName: 'VARCHAR(50)', nullable: false },
    ],
    indexes: [{ name: 'idx_name', columns: ['name'], unique: false }],
    ...overrides,
  }
}

describe('diffTableStructures', () => {
  it('reports no differences for identical structures', () => {
    const diff = diffTableStructures(table(), table())
    expect(diff).toEqual({ columns: [], indexes: [], equal: true })
  })

  it('reports added, removed and changed columns with field details', () => {
    const right = table({
      columns: [
        { name: 'id', typeName: 'BIGINT', nullable: false, primaryKey: true },
        { name: 'email', typeName: 'VARCHAR(100)', nullable: true },
      ],
    })
    const diff = diffTableStructures(table(), right)
    expect(diff.columns).toEqual([
      {
        name: 'id',
        status: 'changed',
        changes: [{ field: 'type', left: 'int', right: 'bigint' }],
      },
      { name: 'name', status: 'removed', changes: [] },
      { name: 'email', status: 'added', changes: [] },
    ])
    expect(diff.equal).toBe(false)
  })

  it('compares defaults, comments, nullability and auto increment', () => {
    const right = table({
      columns: [
        { name: 'id', typeName: 'INT', nullable: false, primaryKey: true, autoIncrement: true },
        { name: 'name', typeName: 'VARCHAR(50)', nullable: true, defaultValue: 'x', comment: 'display' },
      ],
    })
    const diff = diffTableStructures(table(), right)
    expect(diff.columns).toEqual([
      {
        name: 'id',
        status: 'changed',
        changes: [{ field: 'autoIncrement', left: 'false', right: 'true' }],
      },
      {
        name: 'name',
        status: 'changed',
        changes: [
          { field: 'nullable', left: 'false', right: 'true' },
          { field: 'default', left: '', right: 'x' },
          { field: 'comment', left: '', right: 'display' },
        ],
      },
    ])
  })

  it('compares index columns, uniqueness and presence', () => {
    const right = table({
      indexes: [
        { name: 'idx_name', columns: ['name', 'id'], unique: true },
        { name: 'idx_id', columns: ['id'], unique: false },
      ],
    })
    const diff = diffTableStructures(table(), right)
    expect(diff.indexes).toEqual([
      {
        name: 'idx_name',
        status: 'changed',
        changes: [
          { field: 'columns', left: 'name', right: 'name, id' },
          { field: 'unique', left: 'false', right: 'true' },
        ],
      },
      { name: 'idx_id', status: 'added', changes: [] },
    ])
  })
})