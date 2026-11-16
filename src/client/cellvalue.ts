/**
 * What the "view full value" dialog shows for one grid cell.
 *
 * Grids keep every cell on one line, so a JSON document or a long text blob is
 * unreadable there. Opening a cell expands JSON containers over several lines
 * and leaves every other value exactly as the grid already formats it.
 */
import type { CellValue } from '../shared/types'
import { formatCell } from './format'
import { prettyJsonText } from './redisvalue'

export interface CellValueView {
  /** Column the cell belongs to, used as the dialog title. */
  column: string
  /** Read-only text: JSON containers expanded, NULL spelled out. */
  text: string
  /** What the editor starts from; NULL becomes an empty string. */
  editText: string
  /** True when a JSON container was expanded into several lines. */
  pretty: boolean
  /** True for JSON-typed columns and values that parse as JSON containers. */
  json: boolean
}

/** Column types that store JSON documents (`json`, `jsonb`, ...). */
export function isJsonColumn(column: { typeName?: string } | undefined): boolean {
  return /\bjson/iu.test(column?.typeName ?? '')
}

export function cellValueView(column: string, value: CellValue, jsonColumn = false): CellValueView {
  if (value === null || value === undefined) {
    return { column, text: 'NULL', editText: '', pretty: false, json: false }
  }
  if (typeof value !== 'string') {
    const text = formatCell(value)
    return { column, text, editText: text, pretty: false, json: jsonColumn }
  }
  const text = prettyJsonText(value)
  const pretty = text !== value
  return { column, text, editText: text, pretty, json: jsonColumn || pretty }
}
