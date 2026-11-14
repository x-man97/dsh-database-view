import { describe, expect, it } from 'vitest'

import { deleteRowSql, insertRowSql, sqlValue, updateRowSql } from '../../src/client/rowedit.ts'

const id = { name: 'id', typeName: 'int', nullable: false, primaryKey: true }
const name = { name: 'name', typeName: 'varchar(50)', nullable: false }
const note = { name: 'note', typeName: 'text', nullable: true }

describe('row edit SQL', () => {
  it('quotes values by column type', () => {
    expect(sqlValue('mysql', name, "O'Brien")).toBe("'O''Brien'")
    expect(sqlValue('mysql', id, '42')).toBe('42')
    expect(sqlValue('mysql', note, null)).toBe('NULL')
  })

  it('builds INSERT, UPDATE and DELETE with quoted identifiers', () => {
    const values = [
      { column: name, value: 'Alice' },
      { column: note, value: null },
    ]
    expect(insertRowSql('postgres', 'public', 'users', values)).toBe(
      'INSERT INTO "public"."users" ("name", "note") VALUES (\'Alice\', NULL)',
    )
    expect(updateRowSql('postgres', 'public', 'users', [{ column: name, value: 'ALICE' }], [id], new Map([['id', 7]]))).toBe(
      'UPDATE "public"."users" SET "name" = \'ALICE\' WHERE "id" = 7',
    )
    expect(deleteRowSql('postgres', 'public', 'users', [id], new Map([['id', 7]]))).toBe(
      'DELETE FROM "public"."users" WHERE "id" = 7',
    )
  })
})
