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
const settings = { maxRows: 200, queryTimeoutSec: 30, connectTimeoutSec: 10, allowAgentWrites: false, redisScanCount: 200, confirmDestructive: false }
const tab = () => ({ tab: { navigation: { params: { connectionId: 'mysql-1', schema: 'shop', table: 'docs' } } } })
const RAW = '{"a":1}'
const PRETTY = '{\n  "a": 1\n}'

describe('table full-value editor', () => {
  afterEach(() => cleanup())
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.status.mockResolvedValue({ config: { connections: [connection], settings, drivers: [] }, env: {} })
    mocks.describe.mockResolvedValue({
      schema: 'shop',
      table: 'docs',
      kind: 'table',
      columns: [
        { name: 'id', typeName: 'int', primaryKey: true, nullable: false },
        { name: 'payload', typeName: 'json', nullable: true },
      ],
      indexes: [],
    })
    mocks.query.mockImplementation(async (request: { sql: string }) =>
      request.sql.includes('COUNT(*)')
        ? { sql: request.sql, columns: [{ name: 'count', typeName: 'bigint' }], rows: [[1]], rowCount: 1, elapsedMs: 1, truncated: false, warnings: [] }
        : {
            sql: request.sql,
            columns: [{ name: 'id', typeName: 'int' }, { name: 'payload', typeName: 'json' }],
            rows: [[1, RAW]],
            rowCount: 1,
            elapsedMs: 1,
            truncated: false,
            warnings: [],
          },
    )
  })

  it('opens a JSON column in the highlighted editor and stages the edit', async () => {
    render(<TableTab useTabInfo={tab} />)
    await screen.findByText('payload')

    fireEvent.doubleClick(screen.getByText(RAW))
    const editor = (await screen.findByLabelText('单元格完整值编辑')) as HTMLTextAreaElement
    expect(editor.value).toBe(PRETTY)
    expect(document.querySelector('.dshdb-jtok-key')?.textContent).toBe('"a"')

    fireEvent.change(editor, { target: { value: '{"a":2}' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('{"a":2}')).toBeTruthy()
    expect((screen.getByRole('button', { name: '直接提交所有待处理更改' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps the read-only dialog available and editable from the menu', async () => {
    render(<TableTab useTabInfo={tab} />)
    await screen.findByText('payload')

    fireEvent.contextMenu(screen.getByText(RAW))
    fireEvent.click(await screen.findByRole('menuitem', { name: '查看完整值' }))
    const block = await screen.findByLabelText('单元格完整值')
    expect(block.textContent).toBe(PRETTY)
    expect(document.querySelector('.dshdb-jtok-key')?.textContent).toBe('"a"')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(await screen.findByLabelText('单元格完整值编辑')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByLabelText('单元格完整值编辑')).toBeNull()

    fireEvent.contextMenu(screen.getByText(RAW))
    fireEvent.click(await screen.findByRole('menuitem', { name: '编辑完整值…' }))
    expect(await screen.findByLabelText('单元格完整值编辑')).toBeTruthy()
  })

  it('saves an untouched document without marking the row dirty', async () => {
    render(<TableTab useTabInfo={tab} />)
    await screen.findByText('payload')

    fireEvent.doubleClick(screen.getByText(RAW))
    await screen.findByLabelText('单元格完整值编辑')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(screen.queryByLabelText('单元格完整值编辑')).toBeNull())
    expect((screen.getByRole('button', { name: '直接提交所有待处理更改' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
