// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: vi.fn() }))

vi.mock('../../src/client/api', () => ({ api: { query: mocks.query } }))

import { DataImportModal } from '../../src/client/DataImportModal'

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
  { name: 'id', typeName: 'INT', nullable: false, primaryKey: true, autoIncrement: true },
  { name: 'name', typeName: 'VARCHAR(50)', nullable: false },
  { name: 'email', typeName: 'VARCHAR(100)' },
]

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.query.mockResolvedValue({ columns: [], rows: [], rowCount: 0, truncated: false, elapsedMs: 1, warnings: [], sql: '' })
})

describe('import data dialog', () => {
  it('maps a CSV by header and imports it in batches', async () => {
    const onImported = vi.fn()
    const onClose = vi.fn()
    render(
      <DataImportModal
        target={{ connection, schema: 'app', table: 'users', columns }}
        onClose={onClose}
        onImported={onImported}
      />,
    )

    const file = new File(['name,email\nAlice,alice@example.com\nBob,bob@example.com\n'], 'users.csv', {
      type: 'text/csv',
    })
    fireEvent.change(screen.getByLabelText('文件'), { target: { files: [file] } })

    const emailMapping = await screen.findByLabelText('目标列 email')
    expect((emailMapping as HTMLSelectElement).value).toBe('email')
    expect((screen.getByLabelText('目标列 name') as HTMLSelectElement).value).toBe('name')

    fireEvent.click(screen.getByRole('button', { name: '导入' }))
    await waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(1))
    const sql = mocks.query.mock.calls[0][0].sql as string
    expect(sql).toContain('INSERT INTO `app`.`users` (`name`, `email`) VALUES')
    expect(sql).toContain("('Alice', 'alice@example.com')")
    expect(sql).toContain("('Bob', 'bob@example.com')")
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(2))
    expect(onClose).toHaveBeenCalled()
  })

  it('refuses to import without a mapped column', async () => {
    render(
      <DataImportModal
        target={{ connection, schema: 'app', table: 'users', columns }}
        onClose={() => undefined}
        onImported={() => undefined}
      />,
    )
    const file = new File(['1,2\n3,4\n'], 'raw.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText('文件'), { target: { files: [file] } })
    await screen.findByLabelText('目标列 列 1')
    fireEvent.change(screen.getByLabelText('目标列 列 1'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('目标列 列 2'), { target: { value: '' } })
    expect((screen.getByRole('button', { name: '导入' }) as HTMLButtonElement).disabled).toBe(true)
  })
})