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
  return {
    ApiError,
    api: { status: mocks.status, query: mocks.query, connect: mocks.connect, describe: mocks.describe },
  }
})

import { TableTab } from '../../src/client/TableTab'

const connection = {
  id: 'mysql-1',
  name: '演示 MySQL',
  driver: 'mysql',
  dialect: 'mysql',
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  hasPassword: false,
  database: 'shop',
  redisDb: 0,
  readOnly: false,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const settings = {
  maxRows: 200,
  queryTimeoutSec: 30,
  connectTimeoutSec: 10,
  allowAgentWrites: false,
  redisScanCount: 200,
  confirmDestructive: false,
}

const tab = () => ({ tab: { navigation: { params: { connectionId: 'mysql-1', schema: 'shop', table: 'users' } } } })

function pageCalls(): number {
  return mocks.query.mock.calls.filter((call) => (call[0] as { sql: string }).sql.includes('SELECT * FROM')).length
}

describe('opening a table tab', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.status.mockResolvedValue({ config: { connections: [connection], settings, drivers: [] }, env: {} })
    mocks.describe.mockResolvedValue({
      schema: 'shop',
      table: 'users',
      kind: 'table',
      columns: [
        { name: 'id', typeName: 'int', primaryKey: true, nullable: false },
        { name: 'name', typeName: 'varchar(50)', nullable: false },
      ],
      indexes: [],
    })
    mocks.query.mockImplementation(async (request: { sql: string }) => {
      if (request.sql.includes('COUNT(*)')) {
        return { sql: request.sql, columns: [{ name: 'count', typeName: 'bigint' }], rows: [[1]], rowCount: 1, elapsedMs: 1, truncated: false, warnings: [] }
      }
      return {
        sql: request.sql,
        columns: [{ name: 'id', typeName: 'int' }, { name: 'name', typeName: 'varchar(50)' }],
        rows: [[1, 'Alice']],
        rowCount: 1,
        elapsedMs: 1,
        truncated: false,
        warnings: [],
      }
    })
  })

  it('queries on the first open and reuses the snapshot when reopened', async () => {
    const first = render(<TableTab useTabInfo={tab} />)
    await screen.findByText('Alice')
    await waitFor(() => expect(pageCalls()).toBe(1))
    await waitFor(() => expect(mocks.describe).toHaveBeenCalledTimes(1))
    first.unmount()

    render(<TableTab useTabInfo={tab} />)
    // The restored page paints immediately; no status, describe or page query.
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(pageCalls()).toBe(1)
    expect(mocks.status).toHaveBeenCalledTimes(1)
    expect(mocks.describe).toHaveBeenCalledTimes(1)

    // The explicit refresh button is still a real read.
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(pageCalls()).toBe(2))
  })
})
