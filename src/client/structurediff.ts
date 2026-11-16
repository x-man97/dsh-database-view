/**
 * Table structure comparison for the "Compare Structure" dialog. Returns only
 * the differences; both sides are TableDescription reads from the same schema.
 */
import type { TableDescription } from '../shared/types'

export type StructureStatus = 'added' | 'removed' | 'changed'

export interface StructureFieldChange {
  field: string
  left: string
  right: string
}

export interface StructureDelta {
  name: string
  status: StructureStatus
  changes: StructureFieldChange[]
}

export interface StructureDiff {
  columns: StructureDelta[]
  indexes: StructureDelta[]
  equal: boolean
}

function bool(value: boolean | undefined): string {
  return value === true ? 'true' : 'false'
}

function columnChanges(left: TableDescription['columns'][number], right: TableDescription['columns'][number]): StructureFieldChange[] {
  const changes: StructureFieldChange[] = []
  const push = (field: string, leftValue: string, rightValue: string): void => {
    if (leftValue !== rightValue) changes.push({ field, left: leftValue, right: rightValue })
  }
  push('type', left.typeName.trim().toLowerCase(), right.typeName.trim().toLowerCase())
  push('nullable', bool(left.nullable !== false), bool(right.nullable !== false))
  push('default', left.defaultValue ?? '', right.defaultValue ?? '')
  push('comment', left.comment ?? '', right.comment ?? '')
  push('autoIncrement', bool(left.autoIncrement), bool(right.autoIncrement))
  push('primaryKey', bool(left.primaryKey), bool(right.primaryKey))
  return changes
}

function indexChanges(left: TableDescription['indexes'][number], right: TableDescription['indexes'][number]): StructureFieldChange[] {
  const changes: StructureFieldChange[] = []
  const leftColumns = left.columns.join(', ')
  const rightColumns = right.columns.join(', ')
  if (leftColumns !== rightColumns) changes.push({ field: 'columns', left: leftColumns, right: rightColumns })
  if ((left.unique === true) !== (right.unique === true)) {
    changes.push({ field: 'unique', left: bool(left.unique), right: bool(right.unique) })
  }
  return changes
}

function merge<T extends { name: string }>(
  left: T[],
  right: T[],
  compare: (left: T, right: T) => StructureFieldChange[],
): StructureDelta[] {
  const deltas: StructureDelta[] = []
  const rightByName = new Map(right.map((entry) => [entry.name, entry]))
  for (const entry of left) {
    const other = rightByName.get(entry.name)
    if (other === undefined) {
      deltas.push({ name: entry.name, status: 'removed', changes: [] })
      continue
    }
    rightByName.delete(entry.name)
    const changes = compare(entry, other)
    if (changes.length > 0) deltas.push({ name: entry.name, status: 'changed', changes })
  }
  for (const name of rightByName.keys()) {
    deltas.push({ name, status: 'added', changes: [] })
  }
  return deltas
}

export function diffTableStructures(left: TableDescription, right: TableDescription): StructureDiff {
  const columns = merge(left.columns, right.columns, columnChanges)
  const indexes = merge(left.indexes, right.indexes, indexChanges)
  return { columns, indexes, equal: columns.length === 0 && indexes.length === 0 }
}
