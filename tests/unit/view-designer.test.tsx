// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ViewDesigner } from '../../src/client/ViewDesigner'

const connection = {
  id: 'mysql-1',
  name: '演示 MySQL',
  driver: 'mysql',
  dialect: 'mysql',
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  hasPassword: false,
  database: 'app',
  redisDb: 0,
  readOnly: false,
  createdAt: '2026-01-01T00:00:00.000Z',
}

afterEach(() => {
  cleanup()
})

describe('view designer', () => {
  it('previews and creates a new view', async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(<ViewDesigner target={{ connection, schema: 'app' }} onClose={onClose} onExecute={onExecute} />)

    fireEvent.change(screen.getByLabelText('视图名'), { target: { value: 'active_users' } })
    fireEvent.change(screen.getByLabelText('查询语句'), { target: { value: 'select id from users' } })
    expect(screen.getByLabelText('DDL 预览').textContent).toBe(
      'CREATE VIEW `app`.`active_users` AS\nselect id from users',
    )

    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1))
    const [, statements, name] = onExecute.mock.calls[0]
    expect(name).toBe('active_users')
    expect(statements).toEqual(['CREATE VIEW `app`.`active_users` AS\nselect id from users'])
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('edits an existing view with CREATE OR REPLACE and a fixed name', () => {
    render(
      <ViewDesigner
        target={{ connection, schema: 'app', view: 'active_users', body: 'select id from users' }}
        onClose={() => undefined}
        onExecute={vi.fn()}
      />,
    )
    expect((screen.getByLabelText('视图名') as HTMLInputElement).readOnly).toBe(true)
    expect(screen.getByLabelText('DDL 预览').textContent).toBe(
      'CREATE OR REPLACE VIEW `app`.`active_users` AS\nselect id from users',
    )
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy()
  })

  it('disables creation for a non-SELECT body', () => {
    render(<ViewDesigner target={{ connection, schema: 'app' }} onClose={() => undefined} onExecute={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('视图名'), { target: { value: 'v' } })
    fireEvent.change(screen.getByLabelText('查询语句'), { target: { value: 'delete from users' } })
    expect((screen.getByRole('button', { name: '创建' }) as HTMLButtonElement).disabled).toBe(true)
  })
})