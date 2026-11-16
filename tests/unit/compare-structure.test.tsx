// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ objects: vi.fn(), describe: vi.fn() }))

vi.mock('../../src/client/api', () => ({ api: { objects: mocks.objects, describe: mocks.describe } }))

import { CompareStructureModal } from '../../src/client/CompareStructureModal'

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

describe('compare structure dialog', () => {
  it('loads both tables and lists the column and index differences', async () => {
    mocks.objects.mockResolvedValue({
      objects: [
        { name: 'users', kind: 'table' },
        { name: 'users_archive', kind: 'table' },
        { name: 'users_view', kind: 'view' },
      ],
    })
    mocks.describe.mockImplementation(async (_id: string, _schema: string, table: string) => ({
      schema: 'app',
      table,
      kind: 'table',
      columns:
        table === 'users'
          ? [
              { name: 'id', typeName: 'INT', nullable: false, primaryKey: true },
              { name: 'name', typeName: 'VARCHAR(50)', nullable: false },
            ]
          : [
              { name: 'id', typeName: 'BIGINT', nullable: false, primaryKey: true },
              { name: 'name', typeName: 'VARCHAR(50)', nullable: false },
              { name: 'archived_at', typeName: 'DATETIME', nullable: true },
            ],
      indexes: [],
    }))

    render(<CompareStructureModal target={{ connection, schema: 'app', table: 'users' }} onClose={() => undefined} />)

    const target = await screen.findByLabelText('目标表')
    expect(mocks.objects).toHaveBeenCalledWith('mysql-1', 'app')
    fireEvent.change(target, { target: { value: 'users_archive' } })

    await waitFor(() => expect(mocks.describe).toHaveBeenCalledWith('mysql-1', 'app', 'users_archive', 'table'))
    expect(await screen.findByText('仅目标表')).toBeTruthy()
    expect(screen.getByText('有差异')).toBeTruthy()
    expect(screen.getByText(/BIGINT/i)).toBeTruthy()
    expect(screen.getByText('archived_at')).toBeTruthy()
    expect(screen.getByText(/新增 1 · 缺失 0 · 变更 1/)).toBeTruthy()
  })

  it('reports identical structures', async () => {
    mocks.objects.mockResolvedValue({
      objects: [
        { name: 'users', kind: 'table' },
        { name: 'users_copy', kind: 'table' },
      ],
    })
    mocks.describe.mockImplementation(async (_id: string, _schema: string, table: string) => ({
      schema: 'app',
      table,
      kind: 'table',
      columns: [{ name: 'id', typeName: 'INT', nullable: false }],
      indexes: [],
    }))

    render(<CompareStructureModal target={{ connection, schema: 'app', table: 'users' }} onClose={() => undefined} />)
    fireEvent.change(await screen.findByLabelText('目标表'), { target: { value: 'users_copy' } })
    expect(await screen.findByText('结构一致，没有差异。')).toBeTruthy()
  })
})