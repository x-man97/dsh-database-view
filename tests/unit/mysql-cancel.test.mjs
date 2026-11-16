import { describe, expect, it } from 'vitest'

import { MysqlEngine } from '../../lib/host/db/engines/mysql.js'

function fakeConnection() {
  const calls = { destroy: 0 }
  return {
    threadId: 7,
    calls,
    destroy: () => {
      calls.destroy += 1
    },
  }
}

describe('MySQL cancel', () => {
  it('leaves the connection alone for a statement key that is not running', async () => {
    const engine = new MysqlEngine()
    const connection = fakeConnection()
    engine.connection = connection

    expect(await engine.cancel('console-finished')).toBe(false)
    expect(connection.calls.destroy).toBe(0)
    expect(engine.isOpen()).toBe(true)
  })

  it('drops the connection only when KILL QUERY is not available', async () => {
    const engine = new MysqlEngine()
    const connection = fakeConnection()
    engine.connection = connection
    engine.running.add('console-running')

    expect(await engine.cancel('console-running')).toBe(true)
    expect(connection.calls.destroy).toBe(1)
    expect(engine.isOpen()).toBe(false)
  })
})
