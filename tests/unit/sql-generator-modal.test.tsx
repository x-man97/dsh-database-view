// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SqlGeneratorModal } from '../../src/client/SqlGeneratorModal'

const apiMock = vi.hoisted(() => ({
  schemas: vi.fn(),
  objects: vi.fn(),
  ddl: vi.fn(),
  describe: vi.fn(),
}))

vi.mock('../../src/client/api', () => ({ api: apiMock }))

const connection = {
  id: 'sqlite-1',
  name: '演示 SQLite',
  driver: 'sqlite',
  dialect: 'sqlite',
  host: '',
  port: 0,
  user: '',
  hasPassword: false,
  database: '/tmp/app.db',
  redisDb: 0,
  readOnly: false,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const users = { name: 'users', kind: 'table' }
const userView = { name: 'user_view', kind: 'view' }

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SQL Generator', () => {
  it('generates table DDL on demand and can include views', async () => {
    apiMock.schemas.mockResolvedValue({ schemas: [{ name: 'main' }] })
    apiMock.objects.mockResolvedValue({ objects: [users, userView] })
    apiMock.ddl.mockResolvedValue({ schema: 'main', table: 'user_view', kind: 'view', ddl: 'CREATE VIEW "main"."user_view" AS select 1', source: 'server', warnings: [] })
    apiMock.describe.mockResolvedValue({
      schema: 'main',
      table: 'users',
      kind: 'table',
      columns: [{ name: 'id', typeName: 'INTEGER', nullable: false, primaryKey: true }],
      indexes: [{ name: 'PRIMARY', columns: ['id'], primary: true, unique: true, constraint: true }],
      foreignKeys: [],
    })
    const onOpenConsole = vi.fn()
    render(
      <SqlGeneratorModal target={{ connection, schema: 'main' }} onClose={() => undefined} onOpenConsole={onOpenConsole} />,
    )

    await waitFor(() => expect(apiMock.objects).toHaveBeenCalledWith('sqlite-1', 'main'))
    expect(screen.getByLabelText('脚本预览').textContent).toBe('选择对象后点击「生成脚本」')
    expect(screen.queryByText('user_view')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '生成脚本' }))
    await waitFor(() => expect(screen.getByLabelText('脚本预览').textContent).toContain('CREATE TABLE "users"'))
    expect(screen.getByLabelText('脚本预览').textContent).not.toContain('user_view')

    fireEvent.click(screen.getByLabelText('包含视图'))
    await screen.findByText('user_view')
    expect(screen.queryByText('users')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    fireEvent.click(screen.getByLabelText('包含 DROP 语句'))
    fireEvent.click(screen.getByRole('button', { name: '生成脚本' }))
    await waitFor(() => expect(screen.getByLabelText('脚本预览').textContent).toContain('DROP VIEW "main"."user_view";'))
    expect(screen.getByLabelText('脚本预览').textContent).toContain('CREATE VIEW "main"."user_view" AS select 1;')

    fireEvent.click(screen.getByRole('button', { name: '在控制台打开' }))
    expect(onOpenConsole).toHaveBeenCalledTimes(1)
    const [, schema, script] = onOpenConsole.mock.calls[0]
    expect(schema).toBe('main')
    expect(script).toContain('CREATE TABLE "users"')
  })
})