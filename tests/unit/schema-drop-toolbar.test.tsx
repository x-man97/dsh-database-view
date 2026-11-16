// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  structure: vi.fn(),
  schemas: vi.fn(),
  objects: vi.fn(),
  query: vi.fn(),
  connect: vi.fn(),
  prefetchConnection: vi.fn(),
}))

vi.mock('../../src/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      status: mocks.status,
      structure: mocks.structure,
      schemas: mocks.schemas,
      objects: mocks.objects,
      query: mocks.query,
      connect: mocks.connect,
      prefetchConnection: mocks.prefetchConnection,
    },
  }
})

import { App } from '../../src/client/App'
import type { ClientConnection, DbSettings } from '../../src/shared/types'

const connection: ClientConnection = {
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

const settings: DbSettings = {
  maxRows: 200,
  queryTimeoutSec: 30,
  connectTimeoutSec: 10,
  allowAgentWrites: false,
  redisScanCount: 200,
  confirmDestructive: false,
  keybindings: {},
}

function treeRow(prefix: string): HTMLElement {
  const row = screen.getAllByRole('treeitem').find((item) => item.textContent?.startsWith(prefix))
  if (row === undefined) throw new Error(`missing tree row ${prefix}`)
  return row
}

function deleteButton(): HTMLButtonElement {
  const button = document.querySelector('[data-toolbar-action="delete"] button')
  if (button === null) throw new Error('missing delete button')
  return button as HTMLButtonElement
}

describe('toolbar delete on a schema row', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, value: 2000 })
    mocks.status.mockResolvedValue({
      config: { connections: [connection], trash: [], drivers: [], settings },
      env: {},
      prefetch: [],
    })
    mocks.structure.mockResolvedValue({
      structures: {
        [connection.id]: {
          fetchedAt: '2026-01-01T00:00:00.000Z',
          schemas: [{ name: 'app' }],
          objects: {},
        },
      },
    })
    mocks.schemas.mockResolvedValue({ schemas: [{ name: 'app' }] })
    mocks.objects.mockResolvedValue({ objects: [] })
    mocks.query.mockResolvedValue({
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      elapsedMs: 1,
      warnings: [],
      sql: '',
    })
    mocks.connect.mockResolvedValue({ version: '8.0.35', user: 'root' })
    mocks.prefetchConnection.mockResolvedValue({ id: connection.id })
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('drops the selected schema instead of the data source', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(0))
    fireEvent.doubleClick(treeRow('演示 MySQL'))

    const schema = await waitFor(() => treeRow('app'))
    fireEvent.click(schema)

    await waitFor(() => expect(deleteButton().getAttribute('aria-label')).toBe('删除选中的 Schema（app）'))
    fireEvent.click(deleteButton())

    expect(await screen.findByText('确认操作')).toBeTruthy()
    expect(screen.getByText(/DROP DATABASE `app`/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '继续' }))

    await waitFor(() => expect(mocks.query).toHaveBeenCalled())
    expect(mocks.query.mock.calls[0]?.[0]).toMatchObject({ sql: 'DROP DATABASE `app`', allowWrite: true })
    await waitFor(() => expect(mocks.schemas).toHaveBeenCalled())
  })
})
