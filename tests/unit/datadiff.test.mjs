import { describe, expect, it } from 'vitest'

import { diffTableData } from '../../src/client/datadiff.ts'

const columns = [
  { name: 'id', typeName: 'INT' },
  { name: 'name', typeName: 'VARCHAR(50)' },
  { name: 'email', typeName: 'VARCHAR(100)' },
]

describe('diffTableData', () => {
  it('aligns rows by key and reports left, right and changed rows', () => {
    const diff = diffTableData({
      left: {
        columns,
        rows: [
          [1, 'Alice', 'a@example.com'],
          [2, 'Bob', 'b@example.com'],
          [3, 'Cara', 'c@example.com'],
        ],
      },
      right: {
        columns,
        rows: [
          [1, 'Alice', 'a@example.com'],
          [2, 'Robert', 'b@example.com'],
          [4, 'Dave', 'd@example.com'],
        ],
      },
      keyColumns: ['id'],
    })
    expect(diff.columns).toEqual(['id', 'name', 'email'])
    expect(diff.keyColumns).toEqual(['id'])
    expect(diff.onlyLeft.map((row) => row.key)).toEqual(['id = 3'])
    expect(diff.onlyRight.map((row) => row.key)).toEqual(['id = 4'])
    expect(diff.changed).toEqual([
      {
        key: 'id = 2',
        keyValues: ['2'],
        values: ['2', 'Robert', 'b@example.com'],
        changes: [{ column: 'name', left: 'Bob', right: 'Robert' }],
      },
    ])
    expect(diff.equal).toBe(false)
    expect(diff.leftDuplicates).toBe(0)
    expect(diff.rightDuplicates).toBe(0)
  })

  it('supports composite keys', () => {
    const diff = diffTableData({
      left: {
        columns: [{ name: 'a', typeName: 'INT' }, { name: 'b', typeName: 'INT' }, { name: 'value', typeName: 'TEXT' }],
        rows: [[1, 1, 'x'], [1, 2, 'y']],
      },
      right: {
        columns: [{ name: 'a', typeName: 'INT' }, { name: 'b', typeName: 'INT' }, { name: 'value', typeName: 'TEXT' }],
        rows: [[1, 2, 'y'], [1, 3, 'z']],
      },
      keyColumns: ['a', 'b'],
    })
    expect(diff.onlyLeft.map((row) => row.key)).toEqual(['a = 1, b = 1'])
    expect(diff.onlyRight.map((row) => row.key)).toEqual(['a = 1, b = 3'])
    expect(diff.changed).toEqual([])
  })

  it('falls back to all common columns as the key', () => {
    const diff = diffTableData({
      left: { columns, rows: [[1, 'Alice', 'a@x']] },
      right: { columns, rows: [[1, 'Alice', 'b@x']] },
      keyColumns: [],
    })
    expect(diff.keyColumns).toEqual(['id', 'name', 'email'])
    expect(diff.onlyLeft).toHaveLength(1)
    expect(diff.onlyRight).toHaveLength(1)
    expect(diff.changed).toHaveLength(0)
  })

  it('counts duplicate keys and compares the last row', () => {
    const diff = diffTableData({
      left: { columns, rows: [[1, 'Alice', 'a@x'], [1, 'Alice2', 'a@x']] },
      right: { columns, rows: [[1, 'Alice', 'a@x']] },
      keyColumns: ['id'],
    })
    expect(diff.leftDuplicates).toBe(1)
    expect(diff.changed).toEqual([
      {
        key: 'id = 1',
        keyValues: ['1'],
        values: ['1', 'Alice', 'a@x'],
        changes: [{ column: 'name', left: 'Alice2', right: 'Alice' }],
      },
    ])
  })

  it('normalises NULL and empty values for comparison', () => {
    const diff = diffTableData({
      left: { columns, rows: [[1, null, null]] },
      right: { columns, rows: [[1, '', null]] },
      keyColumns: ['id'],
    })
    expect(diff.changed[0]?.changes).toEqual([{ column: 'name', left: 'NULL', right: '' }])
  })
})