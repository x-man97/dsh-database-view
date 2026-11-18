// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ status: vi.fn() }))

vi.mock('../../src/client/api', () => {
  class ApiError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  }
  return { ApiError, api: { status: mocks.status } }
})

import { publishConnections } from '../../src/client/connectionstate'
import { TableTabTitle } from '../../src/client/TableTab'

const settings = {
  maxRows: 200,
  queryTimeoutSec: 30,
  connectTimeoutSec: 10,
  allowAgentWrites: false,
  redisScanCount: 200,
  confirmDestructive: false,
}

function connection(id: string, name: string) {
  return {
    id,
    name,
    driver: 'sqlite',
    dialect: 'sqlite',
    host: '',
    port: 0,
    user: '',
    hasPassword: false,
    database: '/tmp/demo.db',
    redisDb: 0,
    readOnly: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

const connA = connection('a', '库 A')
const connB = connection('b', '库 B')

const tab = (connectionId: string, schema: string, table: string) => () => ({
  tab: { navigation: { params: { connectionId, schema, table } } },
})

describe('table tab titles', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.status.mockResolvedValue({ config: { connections: [connA, connB], settings, drivers: [] }, env: {} })
    publishConnections([connA, connB])
  })

  it('keeps a unique table short and adds the source in brackets', () => {
    render(<TableTabTitle useTabInfo={tab('a', 'main', 'users')} />)
    const chip = screen.getByTitle('库 A.main.users')
    expect(chip.textContent).toBe('users[库 A]')
  })

  it('adds the database only while another open tab shares the table name', async () => {
    render(
      <>
        <TableTabTitle useTabInfo={tab('a', 'main', 'users')} />
        <TableTabTitle useTabInfo={tab('b', 'main', 'users')} />
      </>,
    )

    await waitFor(() => expect(screen.getByTitle('库 A.main.users').textContent).toBe('main.users[库 A]'))
    expect(screen.getByTitle('库 B.main.users').textContent).toBe('main.users[库 B]')
  })

  it('keeps different tables short even when other names repeat', () => {
    render(
      <>
        <TableTabTitle useTabInfo={tab('a', 'main', 'users')} />
        <TableTabTitle useTabInfo={tab('b', 'main', 'users')} />
        <TableTabTitle useTabInfo={tab('a', 'main', 'orders')} />
      </>,
    )

    expect(screen.getByTitle('库 A.main.orders').textContent).toBe('orders[库 A]')
  })

  it('drops the database prefix again when the duplicate tab closes', async () => {
    const first = render(
      <>
        <TableTabTitle useTabInfo={tab('a', 'main', 'users')} />
        <TableTabTitle useTabInfo={tab('b', 'main', 'users')} />
      </>,
    )
    await waitFor(() => expect(screen.getByTitle('库 A.main.users').textContent).toBe('main.users[库 A]'))

    cleanup()
    first.unmount()
    render(<TableTabTitle useTabInfo={tab('a', 'main', 'users')} />)
    await waitFor(() => expect(screen.getByTitle('库 A.main.users').textContent).toBe('users[库 A]'))
  })
})
