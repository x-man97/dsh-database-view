// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  query: vi.fn(),
  connect: vi.fn(),
  ddl: vi.fn(),
  completionMetadata: vi.fn(),
  describe: vi.fn(),
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
    api: {
      status: mocks.status,
      query: mocks.query,
      connect: mocks.connect,
      ddl: mocks.ddl,
      completionMetadata: mocks.completionMetadata,
      describe: mocks.describe,
    },
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

const tab = () => ({ tab: { navigation: { params: { connectionId: 'mysql-1', schema: 'shop', table: 'orders' } } } })

describe('table filter column hints', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.status.mockResolvedValue({ config: { connections: [mysql], settings, drivers: [] }, drivers: [], env: {} })
    mocks.completionMetadata.mockResolvedValue({ cached: false, schemas: [], tables: {}, columns: {} })
    mocks.describe.mockResolvedValue({
      columns: [
        { name: 'id', typeName: 'int' },
        { name: 'total', typeName: 'decimal' },
      ],
    })
    mocks.query.mockImplementation((request: { sql: string }) => {
      if (request.sql.includes('COUNT(*)')) {
        return Promise.resolve({ columns: [{ name: 'count', type: 'bigint' }], rows: [[1]], elapsedMs: 1, sql: request.sql })
      }
      return Promise.resolve({
        columns: [
          { name: 'id', type: 'int' },
          { name: 'total', type: 'decimal' },
        ],
        rows: [[1, 93.02]],
        elapsedMs: 1,
        sql: request.sql,
      })
    })
  })

  it('offers the table columns to the WHERE and ORDER BY boxes', async () => {
    render(<TableTab useTabInfo={tab} />)
    const where = (await screen.findByPlaceholderText(/过滤条件/)) as HTMLInputElement
    const order = (await screen.findByPlaceholderText(/排序列/)) as HTMLInputElement

    fireEvent.keyDown(where, { key: ' ', ctrlKey: true })
    const whereList = await screen.findByRole('listbox')
    const whereNames = Array.from(whereList.querySelectorAll('[role="option"]')).map(
      (option) => option.querySelector('.dshdb-complete-name')?.textContent,
    )
    expect(whereNames).toContain('id')
    expect(whereNames).toContain('total')
    expect(mocks.describe).toHaveBeenCalledWith('mysql-1', 'shop', 'orders', 'table')

    fireEvent.keyDown(where, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())

    fireEvent.keyDown(order, { key: ' ', ctrlKey: true })
    const orderList = await screen.findByRole('listbox')
    const orderNames = Array.from(orderList.querySelectorAll('[role="option"]')).map(
      (option) => option.querySelector('.dshdb-complete-name')?.textContent,
    )
    expect(orderNames).toContain('id')
    expect(orderNames).toContain('total')
  })
})
