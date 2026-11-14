// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ status: vi.fn(), query: vi.fn(), connect: vi.fn(), describe: vi.fn() }))

vi.mock('../../src/client/api', () => {
  class ApiError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  }
  return { ApiError, api: { status: mocks.status, query: mocks.query, connect: mocks.connect, describe: mocks.describe } }
})

import { TableTab } from '../../src/client/TableTab'

const connection = {
  id: 'mysql-1', name: '演示 MySQL', driver: 'mysql', dialect: 'mysql', host: '127.0.0.1', port: 3306,
  user: 'root', hasPassword: false, database: 'shop', redisDb: 0, readOnly: false, createdAt: '2026-01-01T00:00:00.000Z',
}
const settings = { maxRows: 200, queryTimeoutSec: 30, connectTimeoutSec: 10, allowAgentWrites: false, redisScanCount: 200, confirmDestructive: false }
const tab = () => ({ tab: { navigation: { params: { connectionId: 'mysql-1', schema: 'shop', table: 'users' } } } })

describe('table cell editing', () => {
  afterEach(() => cleanup())
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.status.mockResolvedValue({ config: { connections: [connection], settings, drivers: [] }, env: {} })
    mocks.describe.mockResolvedValue({
      schema: 'shop', table: 'users', kind: 'table',
      columns: [
        { name: 'id', typeName: 'int', primaryKey: true, nullable: false },
        { name: 'name', typeName: 'varchar(50)', nullable: false },
      ],
      indexes: [],
    })
    mocks.query.mockImplementation(async (request: { sql: string }) => request.sql.includes('COUNT(*)')
      ? { sql: request.sql, columns: [{ name: 'count', typeName: 'bigint' }], rows: [[1]], rowCount: 1, elapsedMs: 1, truncated: false, warnings: [] }
      : { sql: request.sql, columns: [{ name: 'id', typeName: 'int' }, { name: 'name', typeName: 'varchar(50)' }], rows: [[1, 'Alice']], rowCount: 1, elapsedMs: 1, truncated: false, warnings: [] })
  })

  it('opens the inline editor on double click and from the cell menu', async () => {
    render(<TableTab useTabInfo={tab} />)
    await screen.findByText('Alice')
    await waitFor(() => expect(mocks.describe).toHaveBeenCalled())
    fireEvent.doubleClick(screen.getByText('Alice'))
    expect(await screen.findByDisplayValue('Alice')).toBeTruthy()
    fireEvent.keyDown(screen.getByDisplayValue('Alice'), { key: 'Escape' })

    fireEvent.contextMenu(screen.getByText('Alice'))
    const edit = await screen.findByRole('menuitem', { name: '编辑' })
    fireEvent.click(edit)
    expect(await screen.findByDisplayValue('Alice')).toBeTruthy()
  })
})
