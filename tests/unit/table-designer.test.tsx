// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TableDesigner } from '../../src/client/TableDesigner'

const connection = {
  id: 'mysql-1',
  name: '演示 MySQL',
  driver: 'mysql',
  dialect: 'mysql',
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  hasPassword: true,
  database: 'app',
  redisDb: 0,
  readOnly: false,
  createdAt: '2026-01-01T00:00:00.000Z',
}

afterEach(() => {
  cleanup()
})

describe('table designer', () => {
  it('previews a CREATE TABLE and executes it with the chosen name', async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(<TableDesigner target={{ connection, schema: 'app' }} onClose={onClose} onExecute={onExecute} />)

    fireEvent.change(screen.getByLabelText('表名'), { target: { value: 'orders' } })
    expect(screen.getByLabelText('DDL 预览').textContent).toContain('CREATE TABLE `app`.`orders`')

    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1))
    const [, statements, tableName] = onExecute.mock.calls[0]
    expect(tableName).toBe('orders')
    expect(statements).toHaveLength(1)
    expect(statements[0]).toContain('CREATE TABLE `app`.`orders`')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('turns a comment edit on an existing table into an ALTER', () => {
    const onExecute = vi.fn().mockResolvedValue(undefined)
    render(
      <TableDesigner
        target={{
          connection,
          schema: 'app',
          description: {
            schema: 'app',
            table: 'users',
            kind: 'table',
            columns: [{ name: 'id', typeName: 'INT', nullable: false, primaryKey: true }],
            indexes: [],
          },
        }}
        onClose={() => undefined}
        onExecute={onExecute}
      />,
    )

    expect(screen.getByLabelText('DDL 预览').textContent).toBe('没有需要执行的变更')
    fireEvent.change(screen.getByLabelText('注释 1'), { target: { value: '主键' } })
    expect(screen.getByLabelText('DDL 预览').textContent).toContain('ALTER TABLE `app`.`users`')
    expect(screen.getByLabelText('DDL 预览').textContent).toContain("COMMENT '主键'")
  })

  it('previews a foreign-key constraint', () => {
    render(
      <TableDesigner target={{ connection, schema: 'app' }} onClose={() => undefined} onExecute={vi.fn()} />,
    )
    fireEvent.change(screen.getByLabelText('表名'), { target: { value: 'orders' } })
    fireEvent.click(screen.getByRole('button', { name: '添加外键' }))
    fireEvent.change(screen.getByLabelText('引用表 1'), { target: { value: 'users' } })
    fireEvent.change(screen.getByLabelText('引用列（逗号分隔） 1'), { target: { value: 'id' } })
    expect(screen.getByLabelText('DDL 预览').textContent).toContain(
      'CONSTRAINT `fk_1` FOREIGN KEY (`id`) REFERENCES `app`.`users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT',
    )
  })

  it('blocks execution while the draft is invalid', () => {
    render(
      <TableDesigner target={{ connection, schema: 'app' }} onClose={() => undefined} onExecute={vi.fn()} />,
    )
    fireEvent.change(screen.getByLabelText('表名'), { target: { value: 'orders' } })
    fireEvent.change(screen.getByLabelText('名称 1'), { target: { value: '' } })
    expect((screen.getByRole('button', { name: '执行' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables execution for read-only connections', () => {
    render(
      <TableDesigner
        target={{ connection: { ...connection, readOnly: true }, schema: 'app' }}
        onClose={() => undefined}
        onExecute={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('表名'), { target: { value: 'orders' } })
    expect((screen.getByRole('button', { name: '执行' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
