// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ objects: vi.fn(), describe: vi.fn(), query: vi.fn() }))

vi.mock('../../src/client/api', () => ({
  api: { objects: mocks.objects, describe: mocks.describe, query: mocks.query },
}))

import { CopyToDatabaseModal } from '../../src/client/CopyToDatabaseModal'

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
  { name: 'id', typeName: 'INT' },
  { name: 'name', typeName: 'VARCHAR(50)' },
]

afterEach(() => {
  cleanup()
})

describe('copy to database dialog', () => {
  it('maps columns and writes the rows into the chosen table', async () => {
    mocks.objects.mockResolvedValue({
      objects: [
        { name: 'users', kind: 'table' },
        { name: 'users_copy', kind: 'table' },
      ],
    })
    mocks.describe.mockResolvedValue({
      schema: 'app',
      table: 'users_copy',
      kind: 'table',
      columns: [
        { name: 'id', typeName: 'INT' },
        { name: 'name', typeName: 'VARCHAR(50)' },
        { name: 'note', typeName: 'TEXT' },
      ],
      indexes: [],
    })
    mocks.query.mockResolvedValue({ columns: [], rows: [], rowCount: 0, truncated: false, elapsedMs: 1, warnings: [], sql: '' })
    const onCopied = vi.fn()
    const onClose = vi.fn()

    render(
      <CopyToDatabaseModal
        target={{ connection, schema: 'app', table: 'users', columns, rows: [[1, 'Alice'], [2, 'Bob']] }}
        onClose={onClose}
        onCopied={onCopied}
      />,
    )

    const target = (await screen.findByLabelText('目标表')) as HTMLSelectElement
    await waitFor(() => expect(target.options.length).toBe(2))
    fireEvent.change(target, { target: { value: 'users_copy' } })

    expect(await screen.findByLabelText('目标列 name')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '写入' }))
    await waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(1))
    const sql = mocks.query.mock.calls[0][0].sql as string
    expect(sql).toContain('INSERT INTO `app`.`users_copy` (`id`, `name`) VALUES')
    expect(sql).toContain("(1, 'Alice')")
    expect(sql).toContain("(2, 'Bob')")
    await waitFor(() => expect(onCopied).toHaveBeenCalledWith(2, 'users_copy'))
    expect(onClose).toHaveBeenCalled()
  })
})