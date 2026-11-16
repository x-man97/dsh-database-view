import { describe, expect, it } from 'vitest'

import { composeScript } from '../../src/client/sqlgenerator.ts'

describe('SQL Generator script', () => {
  it('joins tables and views with comments and semicolons', () => {
    const script = composeScript(
      'postgres',
      [
        { schema: 'app', object: { name: 'users', kind: 'table' }, ddl: 'CREATE TABLE "app"."users" (id int)' },
        { schema: 'app', object: { name: 'user_view', kind: 'view' }, ddl: 'CREATE VIEW "app"."user_view" AS select 1;' },
      ],
      false,
    )
    expect(script).toBe(
      [
        '-- app.users',
        'CREATE TABLE "app"."users" (id int);',
        '',
        '-- app.user_view',
        'CREATE VIEW "app"."user_view" AS select 1;',
      ].join('\n'),
    )
  })

  it('adds DROP statements with the dialect quoting when requested', () => {
    const script = composeScript(
      'mssql',
      [
        { schema: 'dbo', object: { name: 'users', kind: 'table' }, ddl: 'CREATE TABLE [dbo].[users] (id int)' },
        { schema: 'dbo', object: { name: 'users_view', kind: 'view' }, ddl: 'CREATE VIEW [dbo].[users_view] AS select 1' },
      ],
      true,
    )
    expect(script).toContain('DROP TABLE [dbo].[users];')
    expect(script).toContain('DROP VIEW [dbo].[users_view];')
    expect(script.indexOf('DROP TABLE [dbo].[users];')).toBeLessThan(script.indexOf('CREATE TABLE [dbo].[users]'))
  })

  it('skips empty DDL', () => {
    expect(
      composeScript('mysql', [{ schema: 'app', object: { name: 't', kind: 'table' }, ddl: '   ' }], true),
    ).toBe('')
  })
})