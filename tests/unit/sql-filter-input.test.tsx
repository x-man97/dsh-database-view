// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  completionMetadata: vi.fn(async () => ({ cached: false, schemas: [], tables: {}, columns: {} })),
  schemas: vi.fn(async () => ({ schemas: [{ name: 'app' }] })),
  objects: vi.fn(async () => ({ objects: [{ name: 'users', kind: 'table' }] })),
  describe: vi.fn(async () => ({
    columns: [
      { name: 'id', typeName: 'INT' },
      { name: 'name', typeName: 'VARCHAR' },
    ],
  })),
}))

vi.mock('../../src/client/api', () => ({ api: apiMock }))

import { SqlFilterInput } from '../../src/client/SqlFilterInput'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderInput(overrides: Partial<ComponentProps<typeof SqlFilterInput>> = {}) {
  const props = {
    value: '',
    onChange: vi.fn(),
    onEnter: vi.fn(),
    onEscape: vi.fn(),
    placeholder: '过滤条件',
    ariaLabel: '过滤条件',
    connectionId: 'c1',
    schema: 'app',
    table: 'users',
    dialect: 'mysql' as const,
    clause: 'where' as const,
    ...overrides,
  }
  render(<SqlFilterInput {...props} />)
  const input = screen.getByLabelText(props.ariaLabel) as HTMLInputElement
  input.focus()
  input.setSelectionRange(props.value.length, props.value.length)
  fireEvent.select(input)
  return { ...props, input }
}

describe('SqlFilterInput', () => {
  it('highlights SQL behind the transparent input', () => {
    const { input } = renderInput({ value: "name = 'ann' AND id > 3" })
    expect(input.className).toContain('dshdb-sql-inline-input')
    const highlight = input.parentElement?.querySelector('.dshdb-sql-inline-highlight')
    expect(highlight?.querySelector('.dshdb-tok-keyword')?.textContent).toBe('AND')
    expect(highlight?.querySelector('.dshdb-tok-string')?.textContent).toBe("'ann'")
    expect(highlight?.querySelector('.dshdb-tok-number')?.textContent).toBe('3')
  })

  it('offers the table columns on Ctrl+Space and inserts the chosen name', async () => {
    const onChange = vi.fn()
    const { input } = renderInput({ value: 'na', onChange })
    fireEvent.keyDown(input, { key: ' ', ctrlKey: true })
    const options = await screen.findAllByRole('option')
    const option = options.find((entry) => entry.querySelector('.dshdb-complete-name')?.textContent === 'name')
    expect(option).toBeTruthy()
    expect(option?.querySelector('.dshdb-complete-detail')?.textContent).toBe('VARCHAR')
    fireEvent.mouseDown(option as HTMLElement)
    expect(onChange).toHaveBeenCalledWith('name')
  })

  it('keeps a typed WHERE keyword when inserting a completion', async () => {
    const onChange = vi.fn()
    const { input } = renderInput({ value: 'WHERE na', onChange })
    fireEvent.keyDown(input, { key: ' ', ctrlKey: true })
    const options = await screen.findAllByRole('option')
    const option = options.find((entry) => entry.querySelector('.dshdb-complete-name')?.textContent === 'name')
    fireEvent.mouseDown(option as HTMLElement)
    expect(onChange).toHaveBeenCalledWith('WHERE name')
  })

  it('completes ORDER BY fragments against the same table', async () => {
    const onChange = vi.fn()
    renderInput({ value: '', onChange, clause: 'order', ariaLabel: '排序列' })
    fireEvent.keyDown(screen.getByLabelText('排序列'), { key: ' ', ctrlKey: true })
    const options = await screen.findAllByRole('option')
    const option = options.find((entry) => entry.querySelector('.dshdb-complete-name')?.textContent === 'id')
    fireEvent.mouseDown(option as HTMLElement)
    expect(onChange).toHaveBeenCalledWith('id')
  })

  it('applies on Enter and clears on Escape while the popup is closed', () => {
    const onEnter = vi.fn()
    const onEscape = vi.fn()
    const { input } = renderInput({ value: 'id > 1', onEnter, onEscape })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onEnter).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('closes the popup with Escape before clearing the box', async () => {
    const onEscape = vi.fn()
    const { input } = renderInput({ value: 'i', onEscape })
    fireEvent.keyDown(input, { key: ' ', ctrlKey: true })
    await screen.findAllByRole('option')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onEscape).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  })
})