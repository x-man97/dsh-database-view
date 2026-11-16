import { describe, expect, it } from 'vitest'

import {
  createViewSql,
  extractViewSelect,
  stripLeadingComments,
  validateViewDraft,
} from '../../src/client/viewddl.ts'

describe('createViewSql', () => {
  it('creates and replaces views with the query body', () => {
    expect(createViewSql('app', 'active_users', 'select id from users', false)).toBe(
      'CREATE VIEW `app`.`active_users` AS\nselect id from users',
    )
    expect(createViewSql('app', 'active_users', 'select id from users;', true)).toBe(
      'CREATE OR REPLACE VIEW `app`.`active_users` AS\nselect id from users',
    )
    expect(createViewSql('app', 'active_users', 'select id from users', true, 'postgres')).toBe(
      'CREATE OR REPLACE VIEW "app"."active_users" AS\nselect id from users',
    )
  })
})

describe('extractViewSelect', () => {
  it('pulls the SELECT out of SHOW CREATE VIEW', () => {
    const ddl =
      "CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `v` AS select `u`.`id` AS `id` from `users` `u`"
    expect(extractViewSelect(ddl)).toBe('select `u`.`id` AS `id` from `users` `u`')
  })

  it('accepts a CTE body and strips trailing semicolons', () => {
    expect(extractViewSelect('CREATE VIEW `v` AS WITH x AS (select 1) select * from x;')).toBe(
      'WITH x AS (select 1) select * from x',
    )
  })

  it('returns null when no query follows AS', () => {
    expect(extractViewSelect('CREATE TABLE `t` (`id` int)')).toBeNull()
  })

  it('keeps a bare PostgreSQL view body', () => {
    expect(extractViewSelect(' SELECT users.id FROM users;')).toBe('SELECT users.id FROM users')
  })
})

describe('validateViewDraft', () => {
  it('requires a name for new views and a SELECT body', () => {
    expect(validateViewDraft('', 'select 1')).toBe('name')
    expect(validateViewDraft('v', '')).toBe('body')
    expect(validateViewDraft('v', 'update users set name = 1')).toBe('not-select')
    expect(validateViewDraft('v', 'with x as (select 1) select * from x')).toBeNull()
    expect(validateViewDraft('', 'select 1', false)).toBeNull()
  })

  it('ignores leading comments', () => {
    expect(validateViewDraft('v', '-- note\nselect 1')).toBeNull()
    expect(stripLeadingComments('/* note */\nselect 1')).toBe('select 1')
    expect(validateViewDraft('v', '/* open')).toBe('body')
  })
})