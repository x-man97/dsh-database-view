// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
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

import { ApiError, api } from '../../src/client/api'
import { publishConnections, withConnection } from '../../src/client/connectionstate'
import { TableTab, TableTabTitle } from '../../src/client/TableTab'

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

describe('live connection state shared between tabs', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    publishConnections([connection], [])
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
    mocks.query.mockResolvedValue({
      sql: 'select',
      columns: [{ name: 'id', typeName: 'int' }, { name: 'name', typeName: 'varchar(50)' }],
      rows: [[1, 'Alice']],
      rowCount: 1,
      elapsedMs: 1,
      truncated: false,
      warnings: [],
    })
  })

  it('names a unique table tab with its source', async () => {
    render(
      <>
        <TableTabTitle useTabInfo={tab} />
        <TableTab useTabInfo={tab} />
      </>,
    )
    await screen.findByText('Alice')
    await waitFor(() => expect(screen.getByText('users[演示 MySQL]')).toBeTruthy())
  })

  it('turns editing off when another tab makes the source read-only', async () => {
    render(<TableTab useTabInfo={tab} />)
    await screen.findByText('Alice')
    const add = (await screen.findByRole('button', { name: '增加一行' })) as HTMLButtonElement
    expect(add.disabled).toBe(false)

    // Another tab saves the data source with read-only on.
    act(() => {
      publishConnections([{ ...connection, readOnly: true }], [])
    })

    await waitFor(() => expect(add.disabled).toBe(true))
    expect(screen.queryByText('只读')).not.toBeNull()
  })

  it('reopens a closed session once before retrying the write', async () => {
    mocks.query
      .mockRejectedValueOnce(new ApiError('not-connected', '连接尚未打开'))
      .mockResolvedValueOnce({ sql: 'update', columns: [], rows: [], rowCount: 1, elapsedMs: 1, truncated: false, warnings: [] })
    mocks.connect.mockResolvedValue({ product: 'MySQL', version: '8.0' })

    const result = await withConnection('mysql-1', () =>
      api.query({ id: 'mysql-1', sql: 'UPDATE users SET name = 1' }),
    )

    expect(mocks.connect).toHaveBeenCalledWith('mysql-1')
    expect(mocks.query).toHaveBeenCalledTimes(2)
    expect(result.rowCount).toBe(1)
  })
})
