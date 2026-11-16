import { describe, expect, it } from 'vitest'

import {
  alterTableSql,
  createTableSql,
  defaultValueSql,
  dropObjectSql,
  renameTableSql,
  tableDraftFromDescription,
  validateTableDraft,
} from '../../src/client/tableddl.ts'

function column(overrides) {
  return {
    name: 'id',
    typeName: 'INT',
    nullable: false,
    defaultValue: '',
    comment: '',
    autoIncrement: false,
    primaryKey: false,
    ...overrides,
  }
}

function draft(overrides = {}) {
  return { schema: 'app', table: 'users', columns: [column({ primaryKey: true })], indexes: [], ...overrides }
}

describe('createTableSql', () => {
  it('renders columns, primary key, indexes and comments', () => {
    const sql = createTableSql(
      draft({
        columns: [
          column({ name: 'id', primaryKey: true, autoIncrement: true }),
          column({ name: 'name', typeName: 'VARCHAR(255)', comment: '登录名' }),
          column({ name: 'note', typeName: 'TEXT', nullable: true, defaultValue: 'hello' }),
        ],
        indexes: [{ name: 'idx_name', unique: true, columns: ['name'] }],
      }),
    )
    expect(sql).toBe(
      [
        'CREATE TABLE `app`.`users` (',
        '  `id` INT NOT NULL AUTO_INCREMENT,',
        "  `name` VARCHAR(255) NOT NULL COMMENT '登录名',",
        "  `note` TEXT DEFAULT 'hello',",
        '  PRIMARY KEY (`id`),',
        '  UNIQUE INDEX `idx_name` (`name`)',
        ')',
      ].join('\n'),
    )
  })

  it('quotes identifiers with embedded backticks', () => {
    const sql = createTableSql(draft({ table: 'we`ird', columns: [column({ name: 'a`b' })] }))
    expect(sql).toContain('CREATE TABLE `app`.`we``ird`')
    expect(sql).toContain('`a``b` INT NOT NULL')
  })
})

describe('alterTableSql', () => {
  const description = {
    schema: 'app',
    table: 'users',
    kind: 'table',
    columns: [
      { name: 'id', typeName: 'INT', nullable: false, primaryKey: true },
      { name: 'name', typeName: 'VARCHAR(255)', nullable: false, defaultValue: 'anonymous' },
    ],
    indexes: [{ name: 'idx_name', columns: ['name'], unique: false }],
  }

  it('returns an empty string when nothing changed', () => {
    const original = tableDraftFromDescription(description)
    expect(alterTableSql(original, tableDraftFromDescription(description))).toBe('')
  })

  it('renames a column, adds one and rebuilds a changed index', () => {
    const original = tableDraftFromDescription(description)
    const next = tableDraftFromDescription(description)
    next.columns[1].name = 'display_name'
    next.indexes[0].unique = true
    next.columns.push(column({ name: 'email', typeName: 'VARCHAR(255)', nullable: true }))

    expect(alterTableSql(original, next)).toBe(
      [
        'ALTER TABLE `app`.`users`',
        '  DROP INDEX `idx_name`,',
        "  CHANGE COLUMN `name` `display_name` VARCHAR(255) NOT NULL DEFAULT 'anonymous',",
        '  ADD COLUMN `email` VARCHAR(255),',
        '  ADD UNIQUE INDEX `idx_name` (`display_name`)',
      ].join('\n'),
    )
  })

  it('drops indexes before dropping their column', () => {
    const original = tableDraftFromDescription(description)
    const next = tableDraftFromDescription(description)
    next.columns = next.columns.filter((entry) => entry.name !== 'name')
    next.indexes = []

    expect(alterTableSql(original, next)).toBe(
      ['ALTER TABLE `app`.`users`', '  DROP INDEX `idx_name`,', '  DROP COLUMN `name`'].join('\n'),
    )
  })

  it('drops and re-adds the primary key when its columns change', () => {
    const original = tableDraftFromDescription(description)
    const next = tableDraftFromDescription(description)
    next.columns[0].primaryKey = false
    next.columns[1].primaryKey = true

    expect(alterTableSql(original, next)).toBe(
      ['ALTER TABLE `app`.`users`', '  DROP PRIMARY KEY,', '  ADD PRIMARY KEY (`name`)'].join('\n'),
    )
  })

  it('uses CHANGE for a modified default or comment', () => {
    const original = tableDraftFromDescription(description)
    const next = tableDraftFromDescription(description)
    next.columns[1].comment = 'display name'
    next.columns[1].defaultValue = ''

    expect(alterTableSql(original, next)).toBe(
      'ALTER TABLE `app`.`users`\n  CHANGE COLUMN `name` `name` VARCHAR(255) NOT NULL COMMENT \'display name\'',
    )
  })
})

describe('defaultValueSql', () => {
  it('keeps keywords and numbers raw', () => {
    expect(defaultValueSql('CURRENT_TIMESTAMP', 'TIMESTAMP')).toBe('CURRENT_TIMESTAMP')
    expect(defaultValueSql('NULL', 'TEXT')).toBe('NULL')
    expect(defaultValueSql('42', 'INT')).toBe('42')
    expect(defaultValueSql('3.5', 'DECIMAL(10,2)')).toBe('3.5')
  })

  it('quotes literal strings and escapes them', () => {
    expect(defaultValueSql('hello', 'VARCHAR(255)')).toBe("'hello'")
    expect(defaultValueSql("it's", 'TEXT')).toBe("'it''s'")
    expect(defaultValueSql('a\\b', 'TEXT')).toBe("'a\\\\b'")
  })

  it('treats empty text as no default', () => {
    expect(defaultValueSql('  ', 'INT')).toBeUndefined()
  })
})

describe('validateTableDraft', () => {
  it('accepts a complete draft', () => {
    expect(
      validateTableDraft(draft({ indexes: [{ name: 'idx', unique: false, columns: ['id'] }] })),
    ).toBeNull()
  })

  it('reports missing names, duplicate columns and unknown index columns', () => {
    expect(validateTableDraft(draft({ table: ' ' }))).toBe('table-name')
    expect(validateTableDraft(draft({ columns: [] }))).toBe('no-columns')
    expect(
      validateTableDraft(draft({ columns: [column({ name: 'a' }), column({ name: 'A' })] })),
    ).toBe('duplicate-column')
    expect(
      validateTableDraft(draft({ indexes: [{ name: 'idx', unique: false, columns: ['missing'] }] })),
    ).toBe('unknown-index-column')
  })

  it('does not require a table name when altering', () => {
    expect(validateTableDraft(draft({ table: '' }), false)).toBeNull()
  })
})

describe('drop and rename', () => {
  it('drops tables and views with the right keyword', () => {
    expect(dropObjectSql('app', 'users', 'table')).toBe('DROP TABLE `app`.`users`')
    expect(dropObjectSql('app', 'users_view', 'view')).toBe('DROP VIEW `app`.`users_view`')
  })

  it('renames inside the same schema', () => {
    expect(renameTableSql('app', 'users', ' people ')).toBe('RENAME TABLE `app`.`users` TO `app`.`people`')
  })
})
