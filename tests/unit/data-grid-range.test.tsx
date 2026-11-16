// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataGrid } from '../../src/client/DataGrid'

const columns = [
  { name: 'id', typeName: 'INT' },
  { name: 'name', typeName: 'VARCHAR(50)' },
]

const rows = [
  [1, 'Alice'],
  [2, 'Bob'],
]

afterEach(() => {
  cleanup()
})

describe('DataGrid cell range', () => {
  it('extends a rectangular selection while dragging', () => {
    const onRangeChange = vi.fn()
    render(<DataGrid columns={columns} rows={rows} offset={0} label="测试" onRangeChange={onRangeChange} />)

    // First td is the row number; the next two are the data cells.
    const cells = Array.from(document.querySelectorAll<HTMLTableCellElement>('tbody tr:first-child td'))
    const first = cells[1]
    const second = cells[2]
    expect(first).toBeDefined()
    expect(second).toBeDefined()

    fireEvent.mouseDown(first as HTMLTableCellElement, { button: 0 })
    fireEvent.mouseEnter(second as HTMLTableCellElement)

    const selected = document.querySelectorAll('td[data-cell-selected="true"]')
    expect(selected.length).toBe(2)
    expect(onRangeChange).toHaveBeenLastCalledWith({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 })
  })

  it('starts a new single-cell selection on a plain click and clears it with Escape', async () => {
    const onRangeChange = vi.fn()
    render(<DataGrid columns={columns} rows={rows} offset={0} label="测试" onRangeChange={onRangeChange} />)

    const cells = Array.from(document.querySelectorAll<HTMLTableCellElement>('tbody tr:first-child td'))
    fireEvent.mouseDown(cells[2] as HTMLTableCellElement, { button: 0 })
    expect(document.querySelectorAll('td[data-cell-selected="true"]').length).toBe(1)

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(onRangeChange).toHaveBeenLastCalledWith(null))
  })

  it('does not select anything on right click', () => {
    render(<DataGrid columns={columns} rows={rows} offset={0} label="测试" />)
    const cells = Array.from(document.querySelectorAll<HTMLTableCellElement>('tbody tr:first-child td'))
    fireEvent.mouseDown(cells[1] as HTMLTableCellElement, { button: 2 })
    expect(document.querySelectorAll('td[data-cell-selected="true"]').length).toBe(0)
  })
})
