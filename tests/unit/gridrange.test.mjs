import { describe, expect, it } from 'vitest'

import {
  normalizeGridRange,
  rangeContains,
  rangeToTsv,
  summarizeRange,
} from '../../src/client/gridrange.ts'

const columns = [
  { name: 'id', typeName: 'INT' },
  { name: 'name', typeName: 'VARCHAR(50)' },
  { name: 'amount', typeName: 'DECIMAL(10,2)' },
]

const rows = [
  [1, 'Alice', '10.5'],
  [2, 'Bob', null],
  [3, 'Carol', '4'],
]

describe('normalizeGridRange', () => {
  it('orders an anchor/focus pair whichever way it was dragged', () => {
    expect(normalizeGridRange({ rowIndex: 4, columnIndex: 3 }, { rowIndex: 1, columnIndex: 5 })).toEqual({
      startRow: 1,
      endRow: 4,
      startColumn: 3,
      endColumn: 5,
    })
  })

  it('answers membership for a range', () => {
    const range = normalizeGridRange({ rowIndex: 1, columnIndex: 1 }, { rowIndex: 2, columnIndex: 2 })
    expect(rangeContains(range, 2, 1)).toBe(true)
    expect(rangeContains(range, 3, 1)).toBe(false)
    expect(rangeContains(range, 1, 3)).toBe(false)
  })
})

describe('rangeToTsv', () => {
  it('copies the rectangle with NULL as an empty cell', () => {
    expect(rangeToTsv(columns, rows, { startRow: 0, endRow: 2, startColumn: 1, endColumn: 2 })).toBe(
      'Alice\t10.5\nBob\t\nCarol\t4',
    )
  })

  it('uses the pending-value override when one is supplied', () => {
    const text = rangeToTsv(columns, rows, { startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 }, () => 'edited')
    expect(text).toBe('edited')
  })

  it('flattens tabs and newlines so the block keeps its shape', () => {
    const dirty = [['line\nbreak', 'a\tb']]
    expect(rangeToTsv([columns[1], columns[1]], dirty, { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 })).toBe(
      'line break\ta b',
    )
  })
})

describe('summarizeRange', () => {
  it('counts cells and only sums numeric columns', () => {
    expect(summarizeRange(columns, rows, { startRow: 0, endRow: 2, startColumn: 1, endColumn: 2 })).toEqual({
      rows: 3,
      columns: 2,
      nonNull: 5,
      numeric: 2,
      sum: 14.5,
      average: 7.25,
      min: 4,
      max: 10.5,
    })
  })

  it('honours pending values and treats non-numeric text as not numeric', () => {
    const summary = summarizeRange(columns, rows, { startRow: 0, endRow: 1, startColumn: 2, endColumn: 2 }, (rowIndex) =>
      rowIndex === 0 ? 'n/a' : '2',
    )
    expect(summary).toMatchObject({ nonNull: 2, numeric: 1, sum: 2, average: 2, min: 2, max: 2 })
  })

  it('reports row and column counts for a single cell', () => {
    expect(summarizeRange(columns, rows, { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 })).toMatchObject({
      rows: 1,
      columns: 1,
      nonNull: 1,
      numeric: 1,
      sum: 1,
    })
  })
})
