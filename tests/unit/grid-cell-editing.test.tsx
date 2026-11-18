// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataGrid } from '../../src/client/DataGrid'

const columns = [
  { name: 'id', typeName: 'INT' },
  { name: 'name', typeName: 'TEXT' },
]
const rows = [[1, 'Alice']]

afterEach(() => cleanup())

describe('inline cell editing', () => {
  it('keeps the old text as a sizing ghost and the column alignment', () => {
    render(
      <DataGrid
        columns={columns}
        rows={rows}
        offset={0}
        label="表数据"
        cellEdit={{ rowIndex: 0, column: 'id', value: '12', onChange: () => {}, onCommit: () => {}, onCancel: () => {} }}
      />,
    )

    const input = screen.getByLabelText('1 id')
    const cell = input.closest('td') as HTMLTableCellElement
    expect(cell.className).toContain('dshdb-cell-editing')
    expect(cell.className).toContain('dshdb-cell-num')
    // The hidden copy of the previous value keeps the auto-sized column stable.
    expect(cell.querySelector('.dshdb-cell-ghost')?.textContent).toBe('1')
  })

  it('aligns staged new-row values by column type', () => {
    render(
      <DataGrid
        columns={columns}
        rows={rows}
        offset={0}
        label="表数据"
        pendingNewRows={[{ values: { id: '7', name: 'Bob' }, onStartEdit: vi.fn(), onRemove: vi.fn() }]}
      />,
    )

    const idCell = screen.getByText('7').closest('td') as HTMLTableCellElement
    expect(idCell.className).toContain('dshdb-cell-num')
    expect(idCell.className).not.toContain('dshdb-cell-editing')
  })
})
