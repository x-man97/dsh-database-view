import { describe, expect, it } from 'vitest'

import {
  autoMapColumns,
  buildInsertBatches,
  detectDelimiter,
  guessHeader,
  importRowCount,
  parseDelimited,
  validateMapping,
} from '../../src/client/dataimport.ts'

const columns = [
  { name: 'id', typeName: 'INT', nullable: false, primaryKey: true },
  { name: 'name', typeName: 'VARCHAR(50)', nullable: false },
  { name: 'amount', typeName: 'DECIMAL(10,2)' },
]

describe('detectDelimiter and parseDelimited', () => {
  it('recognises common delimiters', () => {
    expect(detectDelimiter('a,b\n1,2')).toBe(',')
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t')
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(detectDelimiter('a|b\n1|2')).toBe('|')
  })

  it('parses quotes, escaped quotes and embedded newlines', () => {
    const rows = parseDelimited('id,name\n1,"Smith, John"\n2,"say ""hi"""\n3,"two\nlines"', ',')
    expect(rows).toEqual([
      ['id', 'name'],
      ['1', 'Smith, John'],
      ['2', 'say "hi"'],
      ['3', 'two\nlines'],
    ])
  })

  it('drops fully empty rows and trailing newlines', () => {
    expect(parseDelimited('a,b\r\n\r\n1,2\r\n', ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('header and mapping', () => {
  it('guesses a header when the first row names columns', () => {
    expect(guessHeader([['id', 'name'], ['1', 'Alice']], columns)).toBe(true)
    expect(guessHeader([['1', 'Alice'], ['2', 'Bob']], columns)).toBe(false)
  })

  it('maps by header name first and falls back to position', () => {
    expect(autoMapColumns(['NAME', 'unknown'], columns, true)).toEqual(['name', null])
    expect(autoMapColumns(['', '', ''], columns, false)).toEqual(['id', 'name', 'amount'])
  })

  it('rejects empty, duplicate and unknown mappings', () => {
    expect(validateMapping([null, null], columns)).toBe('no-target')
    expect(validateMapping(['name', 'name'], columns)).toBe('duplicate-target')
    expect(validateMapping(['missing'], columns)).toBe('unknown-target')
    expect(validateMapping(['name', null], columns)).toBeNull()
  })

  it('counts rows with and without a header', () => {
    const rows = [['id', 'name'], ['1', 'Alice'], ['2', 'Bob']]
    expect(importRowCount(rows, true)).toBe(2)
    expect(importRowCount(rows, false)).toBe(3)
  })
})

describe('buildInsertBatches', () => {
  it('builds one multi-row INSERT with typed literals and NULL', () => {
    const statements = buildInsertBatches({
      dialect: 'mysql',
      schema: 'app',
      table: 'users',
      columns,
      mapping: ['id', 'name', 'amount'],
      rows: [
        ['id', 'name', 'amount'],
        ['1', 'Alice', '10.5'],
        ['2', "O'Brien", ''],
      ],
      hasHeader: true,
    })
    expect(statements).toEqual([
      [
        'INSERT INTO `app`.`users` (`id`, `name`, `amount`) VALUES',
        "  (1, 'Alice', 10.5),",
        "  (2, 'O''Brien', NULL)",
      ].join('\n'),
    ])
  })

  it('skips unmapped columns and splits into batches', () => {
    const statements = buildInsertBatches({
      dialect: 'mysql',
      schema: 'app',
      table: 'users',
      columns,
      mapping: [null, 'name', null],
      rows: [['1', 'Alice', 'x'], ['2', 'Bob', 'y'], ['3', 'Cara', 'z']],
      batchSize: 2,
    })
    expect(statements).toEqual([
      'INSERT INTO `app`.`users` (`name`) VALUES\n  (\'Alice\'),\n  (\'Bob\')',
      'INSERT INTO `app`.`users` (`name`) VALUES\n  (\'Cara\')',
    ])
  })

  it('ignores rows with no mapped values', () => {
    expect(
      buildInsertBatches({
        dialect: 'mysql',
        schema: 'app',
        table: 'users',
        columns,
        mapping: ['name'],
        rows: [[''], ['Alice'], ['   ']],
      }),
    ).toEqual(["INSERT INTO `app`.`users` (`name`) VALUES\n  ('Alice')"])
  })
})