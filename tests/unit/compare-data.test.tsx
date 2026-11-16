// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ objects: vi.fn(), describe: vi.fn(), query: vi.fn() }))

vi.mock('../../src/client/api', () => ({
  api: { objects: mocks.objects, describe: mocks.describe, query: mocks.query },
}))

import { CompareDataModal } from '../../src/client/CompareDataModal'

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

const columns = [
  { name: 'id', typeName: 'INT', nullable: false, primaryKey: true },
  { name: 'name', typeName: 'VARCHAR(50)', nullable: false },
  { name: 'email', typeName: 'VARCHAR(100)', nullable: true },
]

function result(rows, sql) {
  return { columns, rows, rowCount: rows.length, truncated: false, elapsedMs: 1, warnings: [], sql }
}

afterEach(() => {
  cleanup()
})

describe('compare data dialog', () => {
  it('shows left, right and changed rows from both tables', async () => {
    mocks.objects.mockResolvedValue({
      objects: [
        { name: 'users', kind: 'table' },
        { name: 'users_copy', kind: 'table' },
      ],
    })
    mocks.describe.mockImplementation(async (_id, _schema, table) => ({
      schema: 'app',
      table,
      kind: 'table',
      columns,
      indexes: [],
    }))
    mocks.query.mockImplementation(async ({ sql }) =>
      sql.includes('`users_copy`')
        ? result([[1, 'Alice', 'a@x'], [2, 'Robert', 'b@x'], [4, 'Dave', 'd@x']], sql)
        : result([[1, 'Alice', 'a@x'], [2, 'Bob', 'b@x'], [3, 'Cara', 'c@x']], sql),
    )

    render(<CompareDataModal target={{ connection, schema: 'app', table: 'users' }} onClose={() => undefined} />)

    const target = (await screen.findByLabelText('目标表')) as HTMLSelectElement
    await waitFor(() => expect(target.disabled).toBe(false))
    fireEvent.change(target, { target: { value: 'users_copy' } })
    await waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/仅当前 1 · 仅目标 1 · 变更 1/)).toBeTruthy()
    expect(screen.getByText('匹配键：id')).toBeTruthy()
    expect(screen.getByText('id = 3')).toBeTruthy()
    expect(screen.getByText('id = 4')).toBeTruthy()
    expect(screen.getByText('name: Bob → Robert')).toBeTruthy()
  })

  it('reports identical rows', async () => {
    mocks.objects.mockResolvedValue({
      objects: [
        { name: 'users', kind: 'table' },
        { name: 'users_copy', kind: 'table' },
      ],
    })
    mocks.describe.mockImplementation(async (_id, _schema, table) => ({
      schema: 'app',
      table,
      kind: 'table',
      columns,
      indexes: [],
    }))
    mocks.query.mockImplementation(async ({ sql }) => result([[1, 'Alice', 'a@x']], sql))

    render(<CompareDataModal target={{ connection, schema: 'app', table: 'users' }} onClose={() => undefined} />)
    const target = (await screen.findByLabelText('目标表')) as HTMLSelectElement
    await waitFor(() => expect(target.disabled).toBe(false))
    fireEvent.change(target, { target: { value: 'users_copy' } })
    expect((await screen.findAllByText('数据一致，没有差异。')).length).toBeGreaterThan(0)
  })
})