import { describe, expect, it } from 'vitest'

import { tableDraftFromDescription } from '../../src/client/tableddl.ts'
import {
  alterSqliteTableStatements,
  createSqliteTableStatements,
  validateSqliteDraft,
} from '../../src/client/tableddl-sqlite.ts'

function column(overrides) {
  return {
    name: 'id',
    typeName: 'INTEGER',
    nullable: false,
    defaultValue: '',
    comment: '',
    autoIncrement: false,
    primaryKey: false,
    ...overrides,
  }
}

function draft(overrides = {}) {
  return { schema: 'main', table: 'users', columns: [column({ primaryKey: true })], indexes: [], foreignKeys: [], ...overrides }
}

describe('SQLite table DDL', () => {
  it('renders autoincrement, indexes, foreign keys and triggers', () => {
    const statements = createSqliteTableStatements(
      draft({
        columns: [
          column({ name: 'id', primaryKey: true, autoIncrement: true }),
          column({ name: 'name', typeName: 'TEXT' }),
          column({ name: 'owner_id', typeName: 'INTEGER', nullable: true }),
        ],
        indexes: [{ name: 'idx_users_name', unique: true, columns: ['name'] }],
        foreignKeys: [
          {
            name: 'fk_users_owner',
            columns: ['owner_id'],
            referencedSchema: 'main',
            referencedTable: 'owners',
            referencedColumns: ['id'],
            onDelete: 'CASCADE',
            onUpdate: 'NO ACTION',
          },
        ],
        preservedTriggers: ['CREATE TRIGGER trg AFTER INSERT ON users BEGIN SELECT 1; END'],
      }),
    )
    expect(statements[0]).toBe(
      [
        'CREATE TABLE "users" (',
        '  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,',
        '  "name" TEXT NOT NULL,',
        '  "owner_id" INTEGER,',
        '  CONSTRAINT "fk_users_owner" FOREIGN KEY ("owner_id") REFERENCES "owners" ("id") ON DELETE CASCADE ON UPDATE NO ACTION',
        ')',
      ].join('\n'),
    )
    expect(statements[1]).toBe('CREATE UNIQUE INDEX "idx_users_name" ON "users" ("name")')
    // createSqliteTableStatements does not replay triggers; the rebuild and SQL Generator do.
    expect(statements).toHaveLength(2)
  })

  it('keeps a single INTEGER primary key inline even without AUTOINCREMENT', () => {
    const statements = createSqliteTableStatements(
      draft({ columns: [column({ name: 'id', primaryKey: true, nullable: true }), column({ name: 'name', typeName: 'TEXT' })] }),
    )
    expect(statements[0]).toContain('"id" INTEGER PRIMARY KEY')
    expect(statements[0]).not.toContain('PRIMARY KEY ("id")')
  })

  it('returns no statements when nothing changed', () => {
    const description = {
      schema: 'main',
      table: 'users',
      kind: 'table',
      columns: [column({ name: 'id', primaryKey: true })],
      indexes: [],
    }
    const original = tableDraftFromDescription(description)
    expect(alterSqliteTableStatements(original, tableDraftFromDescription(description))).toEqual([])
  })

  it('changes indexes without rebuilding when only indexes differ', () => {
    const description = {
      schema: 'main',
      table: 'users',
      kind: 'table',
      columns: [column({ name: 'id', primaryKey: true }), column({ name: 'name', typeName: 'TEXT' })],
      indexes: [{ name: 'idx_name', columns: ['name'], unique: false }],
    }
    const original = tableDraftFromDescription(description)
    const next = tableDraftFromDescription(description)
    next.indexes[0].unique = true
    expect(alterSqliteTableStatements(original, next)).toEqual([
      'DROP INDEX "idx_name"',
      'CREATE UNIQUE INDEX "idx_name" ON "users" ("name")',
    ])
  })

  it('rebuilds the table for a column change and preserves data, indexes and triggers', () => {
    const description = {
      schema: 'main',
      table: 'users',
      kind: 'table',
      columns: [
        column({ name: 'id', primaryKey: true }),
        column({ name: 'name', typeName: 'TEXT', nullable: false }),
      ],
      indexes: [
        { name: 'PRIMARY', columns: ['id'], unique: true, primary: true, constraint: true },
        { name: 'sqlite_autoindex_users_1', columns: ['name'], unique: true, constraint: true },
        { name: 'idx_name', columns: ['name'], unique: false },
      ],
      triggers: ["CREATE TRIGGER trg AFTER INSERT ON users BEGIN UPDATE users SET name='keep' WHERE id=NEW.id; END"],
    }
    const original = tableDraftFromDescription(description)
    const next = tableDraftFromDescription(description)
    next.columns[1].name = 'display_name'
    next.columns[1].typeName = 'VARCHAR(100)'

    const statements = alterSqliteTableStatements(original, next)
    expect(statements[0]).toBe('PRAGMA foreign_keys = OFF')
    expect(statements[1]).toBe('BEGIN TRANSACTION')
    expect(statements[2]).toContain('CREATE TABLE "users__dsh_new"')
    expect(statements[2]).toContain('"display_name" VARCHAR(100) NOT NULL')
    expect(statements[2]).toContain('UNIQUE ("display_name")')
    expect(statements[3]).toBe(
      'INSERT INTO "users__dsh_new" ("id", "display_name") SELECT "id", "name" FROM "users"',
    )
    expect(statements[4]).toBe('DROP TABLE "users"')
    expect(statements[5]).toBe('ALTER TABLE "users__dsh_new" RENAME TO "users"')
    expect(statements[6]).toBe('CREATE INDEX "idx_name" ON "users" ("display_name")')
    expect(statements.at(-2)).toBe('COMMIT')
    expect(statements.at(-1)).toBe('PRAGMA foreign_keys = ON')
    expect(statements).toContain("CREATE TRIGGER trg AFTER INSERT ON users BEGIN UPDATE users SET display_name='keep' WHERE id=NEW.id; END")
  })

  it('validates AUTOINCREMENT usage', () => {
    expect(validateSqliteDraft(draft({ columns: [column({ primaryKey: true, autoIncrement: true })] }))).toBeNull()
    expect(
      validateSqliteDraft(draft({ columns: [column({ typeName: 'TEXT', primaryKey: true, autoIncrement: true })] })),
    ).toBe('auto-increment')
    expect(
      validateSqliteDraft(
        draft({ columns: [column({ primaryKey: true, autoIncrement: true, nullable: true }), column({ name: 'b', autoIncrement: true })] }),
      ),
    ).toBe('auto-increment')
  })
})