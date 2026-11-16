// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  completionMetadata: vi.fn(async () => ({ cached: false, schemas: [], tables: {}, columns: {} })),
  schemas: vi.fn(async () => ({ schemas: [{ name: 'app' }] })),
  objects: vi.fn(async () => ({ objects: [] })),
  describe: vi.fn(async () => ({ columns: [] })),
}))

vi.mock('../../src/client/api', () => ({ api: apiMock }))

import { SqlBodyEditor } from '../../src/client/SqlBodyEditor'

afterEach(() => {
  cleanup()
})

describe('SqlBodyEditor', () => {
  it('highlights SQL behind a transparent textarea', () => {
    render(
      <SqlBodyEditor
        value="select id from users"
        onChange={() => undefined}
        ariaLabel="查询语句"
        connectionId="c1"
        schema="app"
        dialect="mysql"
      />,
    )
    const editor = screen.getByLabelText('查询语句')
    expect(editor.className).toContain('dshdb-sql-input')
    const highlight = editor.parentElement?.querySelector('.dshdb-sql-highlight')
    expect(highlight?.querySelector('.dshdb-tok-keyword')?.textContent).toBe('select')
  })

  it('offers completion on Ctrl+Space and inserts the chosen keyword', async () => {
    const onChange = vi.fn()
    render(
      <SqlBodyEditor
        value=""
        onChange={onChange}
        ariaLabel="查询语句"
        connectionId="c1"
        schema="app"
        dialect="mysql"
      />,
    )
    fireEvent.keyDown(screen.getByLabelText('查询语句'), { key: ' ', ctrlKey: true })
    const options = await screen.findAllByRole('option')
    const option = options.find((entry) => entry.querySelector('.dshdb-complete-name')?.textContent === 'SELECT')
    expect(option).toBeTruthy()
    fireEvent.mouseDown(option as HTMLElement)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(String(onChange.mock.calls[0]?.[0])).toContain('SELECT')
  })
})