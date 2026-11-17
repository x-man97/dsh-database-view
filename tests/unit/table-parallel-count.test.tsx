// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  query: vi.fn(),
  connect: vi.fn(),
  cancel: vi.fn(),
}))

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
    api: { status: mocks.status, query: mocks.query, connect: mocks.connect, cancel: mocks.cancel },
  }
})

import { TableTab } from '../../src/client/TableTab'

const mysql = {
  id: 'mysql-1',
  name: '演示 MySQL',
  driver: 'mysql',
  dialect: 'mysql',
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  hasPassword: true,
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

function pageResult(request: { sql: string }) {
  return {
    sql: request.sql,
    columns: [
      { name: 'id', typeName: 'INT' },
      { name: 'name', typeName: 'VARCHAR' },
    ],
    rows: [[1, '手机数码']],
    rowCount: 1,
    truncated: false,
    elapsedMs: 1,
    warnings: [],
  }
}

function countResult(request: { sql: string }) {
  return {
    sql: request.sql,
    columns: [{ name: 'COUNT(*)', typeName: 'BIGINT' }],
    rows: [[42]],
    rowCount: 1,
    truncated: false,
    elapsedMs: 1,
    warnings: [],
  }
}

const tab = () => ({
  tab: { navigation: { params: { connectionId: mysql.id, schema: 'shop', table: 'orders' } } },
})

function countCalls(): Array<{ sql: string; stmtKey?: string }> {
  return mocks.query.mock.calls
    .map((call) => call[0] as { sql: string; stmtKey?: string })
    .filter((request) => request.sql.startsWith('SELECT COUNT'))
}

describe('table page and row count', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.status.mockResolvedValue({ config: { connections: [mysql], settings, drivers: [] }, drivers: [], env: {} })
    mocks.cancel.mockResolvedValue(true)
  })

  it('loads the page before counting so a slow count cannot delay the rows', async () => {
    let release: (value: unknown) => void = () => undefined
    const pendingCount = new Promise((resolve) => {
      release = resolve
    })
    mocks.query.mockImplementation((request: { sql: string }) => {
      if (request.sql.startsWith('SELECT COUNT')) return pendingCount
      return Promise.resolve(pageResult(request))
    })

    render(<TableTab useTabInfo={tab} />)

    // The rows are on screen while the count has not even been sent.
    await screen.findByText('手机数码')
    const issued = mocks.query.mock.calls.map((call) => (call[0] as { sql: string }).sql)
    expect(issued[0]).toContain('SELECT * FROM')
    expect(countCalls()).toHaveLength(0)

    // After the idle delay the count goes out on the side.
    await waitFor(() => expect(countCalls()).toHaveLength(1), { timeout: 3000 })
    expect(screen.queryByText('/42')).toBeNull()

    release(countResult({ sql: countCalls()[0]?.sql ?? '' }))
    await waitFor(() => expect(screen.getByText('/42')).toBeTruthy())
  })

  it('cancels the background count when a newer page query starts', async () => {
    mocks.query.mockImplementation((request: { sql: string }) => {
      if (request.sql.startsWith('SELECT COUNT')) return new Promise(() => undefined)
      return Promise.resolve(pageResult(request))
    })

    render(<TableTab useTabInfo={tab} />)
    await screen.findByText('手机数码')
    await waitFor(() => expect(countCalls()).toHaveLength(1), { timeout: 3000 })

    const key = countCalls()[0]?.stmtKey
    expect(key).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith(key))
  })

  it('hides the total when counting fails', async () => {
    mocks.query.mockImplementation((request: { sql: string }) => {
      if (request.sql.startsWith('SELECT COUNT')) return Promise.reject(new Error('count blocked'))
      return Promise.resolve(pageResult(request))
    })

    render(<TableTab useTabInfo={tab} />)

    await screen.findByText('手机数码')
    await waitFor(() => expect(screen.queryByText(/^\//)).toBeNull(), { timeout: 3000 })
    expect(await screen.findByText('行数未知')).toBeTruthy()
  })
})