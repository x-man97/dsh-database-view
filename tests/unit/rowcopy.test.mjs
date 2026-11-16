import { describe, expect, it } from 'vitest'

import {
  autoCopyMapping,
  buildCopyInsertBatches,
  validateCopyMapping,
} from '../../src/client/rowcopy.ts'

const source = [
  { name: 'id', typeName: 'INT' },
  { name: 'name', typeName: 'VARCHAR(50)' },
  { name: 'email', typeName: 'VARCHAR(100)' },
]

const target = [
  { name: 'id', typeName: 'INT' },
  { name: 'name', typeName: 'VARCHAR(50)' },
  { name: 'email', typeName: 'VARCHAR(100)' },
  { name: 'note', typeName: 'TEXT' },
]

describe('autoCopyMapping', () => {
  it('maps by name and skips missing or already used targets', () => {
    expect(autoCopyMapping(source, target)).toEqual(['id', 'name', 'email'])
    expect(autoCopyMapping([{ name: 'NAME', typeName: 'TEXT' }, { name: 'missing', typeName: 'TEXT' }], target)).toEqual([
      'name',
      null,
    ])
  })
})

describe('validateCopyMapping', () => {
  it('reports empty, duplicate and unknown mappings', () => {
    expect(validateCopyMapping([null, null], target)).toBe('no-target')
    expect(validateCopyMapping(['name', 'name'], target)).toBe('duplicate-target')
    expect(validateCopyMapping(['missing'], target)).toBe('unknown-target')
    expect(validateCopyMapping(['name', null], target)).toBeNull()
  })
})

describe('buildCopyInsertBatches', () => {
  it('keeps typed values and NULL, quoting strings', () => {
    const statements = buildCopyInsertBatches({
      dialect: 'mysql',
      schema: 'app',
      table: 'users_copy',
      sourceColumns: source,
      targetColumns: target,
      mapping: ['id', 'name', 'email'],
      rows: [
        [1, 'Alice', null],
        [2, "O'Brien", 'x@y'],
      ],
    })
    expect(statements).toEqual([
      [
        'INSERT INTO `app`.`users_copy` (`id`, `name`, `email`) VALUES',
        "  (1, 'Alice', NULL),",
        "  (2, 'O''Brien', 'x@y')",
      ].join('\n'),
    ])
  })

  it('splits batches and honours unmapped columns', () => {
    const statements = buildCopyInsertBatches({
      dialect: 'mysql',
      schema: 'app',
      table: 'users_copy',
      sourceColumns: source,
      targetColumns: target,
      mapping: [null, 'name', null],
      rows: [
        [1, 'Alice', 'a'],
        [2, 'Bob', 'b'],
        [3, 'Cara', 'c'],
      ],
      batchSize: 2,
    })
    expect(statements).toEqual([
      "INSERT INTO `app`.`users_copy` (`name`) VALUES\n  ('Alice'),\n  ('Bob')",
      "INSERT INTO `app`.`users_copy` (`name`) VALUES\n  ('Cara')",
    ])
  })
})