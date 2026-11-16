import { describe, expect, it } from 'vitest'

import { tableDraftFromDescription } from '../../src/client/tableddl.ts'
import {
  alterMssqlTableStatements,
  createMssqlTableStatements,
  validateMssqlDraft,
} from '../../src/client/tableddl-mssql.ts'

function column(overrides) {
  return {
    name: 'id',
    typeName: 'int',
    nullable: false,
    defaultValue: '',
    comment: '',
    autoIncrement: false,
    primaryKey: false,
    ...overrides,
  }
}

function draft(overrides = {}) {
  return { schema: 'dbo', table: 'users', columns: [column({ primaryKey: true })], indexes: [], foreignKeys: [], ...overrides }
}

describe('SQL Server table DDL', () => {
  it('renders identity, named defaults, comments, indexes and foreign keys', () => {
    const statements = createMssqlTableStatements(
      draft({
        columns: [
          column({ name: 'id', primaryKey: true, autoIncrement: true }),
          column({ name: 'name', typeName: 'nvarchar(100)', comment: "owner's name" }),
          column({ name: 'active', typeName: 'bit', defaultValue: '((1))' }),
        ],
        indexes: [{ name: 'idx_users_name', unique: true, columns: ['name'] }],
        foreignKeys: [
          {
            name: 'fk_users_team',
            columns: ['name'],
            referencedSchema: 'dbo',
            referencedTable: 'teams',
            referencedColumns: ['name'],
            onDelete: 'CASCADE',
            onUpdate: 'RESTRICT',
          },
        ],
      }),
    )
    expect(statements[0]).toBe(
      [
        'CREATE TABLE [dbo].[users] (',
        '  [id] int IDENTITY(1,1) NOT NULL,',
        '  [name] nvarchar(100) NOT NULL,',
        '  [active] bit CONSTRAINT [DF_users_active] DEFAULT ((1)) NOT NULL,',
        '  PRIMARY KEY ([id]),',
        "  CONSTRAINT [fk_users_team] FOREIGN KEY ([name]) REFERENCES [dbo].[teams] ([name]) ON DELETE CASCADE ON UPDATE NO ACTION",
        ')',
      ].join('\n'),
    )
    expect(statements[1]).toBe('CREATE UNIQUE INDEX [idx_users_name] ON [dbo].[users] ([name])')
    expect(statements[2]).toBe(
      "EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=N'owner''s name', @level0type=N'SCHEMA', @level0name=N'dbo', @level1type=N'TABLE', @level1name=N'users', @level2type=N'COLUMN', @level2name=N'name'",
    )
  })

  it('preserves the existing primary-key and default-constraint names', () => {
    const statements = createMssqlTableStatements(
      draft({
        primaryKeyName: 'PK_users',
        columns: [
          column({ name: 'id', primaryKey: true }),
          column({ name: 'label', typeName: 'nvarchar(50)', defaultValue: "('x')", originalDefaultConstraint: 'DF__users__label__1234' }),
        ],
      }),
    )
    expect(statements[0]).toContain('CONSTRAINT [PK_users] PRIMARY KEY ([id])')
    expect(statements[0]).toContain('CONSTRAINT [DF__users__label__1234] DEFAULT (\'x\')')
  })

  it('renames columns, changes types and swaps default constraints in order', () => {
    const description = {
      schema: 'dbo',
      table: 'users',
      kind: 'table',
      columns: [
        column({ name: 'id', primaryKey: true, typeName: 'int' }),
        column({ name: 'name', typeName: 'nvarchar(50)', defaultValue: '((0))', defaultConstraint: 'DF__users__name__1234' }),
      ],
      indexes: [
        { name: 'PK_users', columns: ['id'], unique: true, primary: true, constraint: true },
        { name: 'idx_name', columns: ['name'], unique: false },
      ],
    }
    const original = tableDraftFromDescription(description)
    const next = tableDraftFromDescription(description)
    next.columns[1].name = 'display_name'
    next.columns[1].typeName = 'nvarchar(100)'
    next.columns[1].defaultValue = '((1))'

    const statements = alterMssqlTableStatements(original, next)
    expect(statements[0]).toBe('DROP INDEX [idx_name] ON [dbo].[users]')
    expect(statements[1]).toBe('ALTER TABLE [dbo].[users] DROP CONSTRAINT [DF__users__name__1234]')
    expect(statements[2]).toContain('EXEC sp_rename')
    expect(statements[2]).toContain("'display_name', N'COLUMN'")
    expect(statements[3]).toBe('ALTER TABLE [dbo].[users] ALTER COLUMN [display_name] nvarchar(100) NOT NULL')
    expect(statements[4]).toBe(
      'ALTER TABLE [dbo].[users] ADD CONSTRAINT [DF__users__name__1234] DEFAULT ((1)) FOR [display_name]',
    )
    expect(statements[5]).toBe('CREATE INDEX [idx_name] ON [dbo].[users] ([display_name])')
  })

  it('adds and drops comments with extended properties', () => {
    const description = {
      schema: 'dbo',
      table: 'users',
      kind: 'table',
      columns: [column({ name: 'id', primaryKey: true }), column({ name: 'name', typeName: 'nvarchar(50)', comment: 'old' })],
      indexes: [],
    }
    const original = tableDraftFromDescription(description)
    const next = tableDraftFromDescription(description)
    next.columns[1].comment = 'new'
    next.columns.push(column({ name: 'note', typeName: 'nvarchar(50)', nullable: true, comment: 'added' }))
    const statements = alterMssqlTableStatements(original, next)
    expect(statements.some((sql) => sql.startsWith('ALTER TABLE [dbo].[users] ADD [note]'))).toBe(true)
    expect(statements).toContain(
      "EXEC sys.sp_updateextendedproperty @name=N'MS_Description', @value=N'new', @level0type=N'SCHEMA', @level0name=N'dbo', @level1type=N'TABLE', @level1name=N'users', @level2type=N'COLUMN', @level2name=N'name'",
    )
    expect(statements).toContain(
      "EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=N'added', @level0type=N'SCHEMA', @level0name=N'dbo', @level1type=N'TABLE', @level1name=N'users', @level2type=N'COLUMN', @level2name=N'note'",
    )
  })

  it('rejects identity changes on an existing table', () => {
    const description = {
      schema: 'dbo',
      table: 'users',
      kind: 'table',
      columns: [column({ name: 'id', primaryKey: true, autoIncrement: true })],
      indexes: [],
    }
    const original = tableDraftFromDescription(description)
    const next = tableDraftFromDescription(description)
    expect(validateMssqlDraft(original, next)).toBeNull()
    next.columns[0].autoIncrement = false
    expect(validateMssqlDraft(original, next)).toBe('identity-change')
    expect(
      validateMssqlDraft(null, draft({ columns: [column({ name: 'a', autoIncrement: true }), column({ name: 'b', autoIncrement: true })] })),
    ).toBe('auto-increment')
  })
})