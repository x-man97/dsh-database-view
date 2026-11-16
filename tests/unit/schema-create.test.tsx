// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SchemaCreateModal, type SchemaCreateTarget } from '../../src/client/SchemaCreateModal'

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

const target: SchemaCreateTarget = { connection }

afterEach(() => {
  cleanup()
})

describe('schema create dialog', () => {
  it('previews the statement and hands the trimmed name over', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(<SchemaCreateModal target={target} onClose={onClose} onCreate={onCreate} />)

    fireEvent.change(screen.getByLabelText('Schema 名称'), { target: { value: '  audit  ' } })
    expect(screen.getByText('CREATE DATABASE `audit`')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(target, 'audit'))
    expect(onClose).toHaveBeenCalled()
  })

  it('submits with Enter and keeps the dialog closed on success', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(<SchemaCreateModal target={target} onClose={onClose} onCreate={onCreate} />)

    const input = screen.getByLabelText('Schema 名称')
    fireEvent.change(input, { target: { value: 'audit' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(target, 'audit'))
  })

  it('disables creating without a name', () => {
    render(<SchemaCreateModal target={target} onClose={() => undefined} onCreate={vi.fn()} />)
    expect((screen.getByRole('button', { name: '创建' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the server failure and stays open', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('access denied'))
    const onClose = vi.fn()
    render(<SchemaCreateModal target={target} onClose={onClose} onCreate={onCreate} />)

    fireEvent.change(screen.getByLabelText('Schema 名称'), { target: { value: 'audit' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    expect(await screen.findByText('access denied')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
})
