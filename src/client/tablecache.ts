/**
 * In-memory snapshots of table tabs.
 *
 * The sidebar unmounts a table tab when it is closed or switched away from, so
 * without a snapshot every return would run the page query and the count
 * again. A snapshot is only kept after a successful load: reopening the same
 * table reuses it, while DML, imports, explicit refreshes and structure
 * changes replace or drop it so the next open reads the server again.
 */
import type { ClientConnection, ColumnInfo, Row, TableDescription } from '../shared/types'
import type { ColumnFilters } from './tablesql'

export interface TableSnapshot {
  connection: ClientConnection
  columns: ColumnInfo[]
  rows: Row[]
  total: number | undefined
  countUnknown: boolean
  elapsed: number | undefined
  sqlText: string
  page: number
  pageSize: number
  whereText: string
  orderText: string
  filters: ColumnFilters
  description: TableDescription | null
}

/** One entry per table and initial WHERE; only the newest few stay in memory. */
const MAX_SNAPSHOTS = 16
const snapshots = new Map<string, TableSnapshot>()

export function tableSnapshotKey(
  connectionId: string,
  schema: string,
  table: string,
  kind: 'table' | 'view',
  where: string,
): string {
  return `${connectionId}|${kind}|${schema}.${table}|${where}`
}

export function readTableSnapshot(key: string): TableSnapshot | undefined {
  const found = snapshots.get(key)
  if (found === undefined) return undefined
  // Keep the least recently opened snapshot at the front for eviction.
  snapshots.delete(key)
  snapshots.set(key, found)
  return found
}

export function writeTableSnapshot(key: string, snapshot: TableSnapshot): void {
  snapshots.delete(key)
  snapshots.set(key, snapshot)
  while (snapshots.size > MAX_SNAPSHOTS) {
    const oldest = snapshots.keys().next().value
    if (oldest === undefined) break
    snapshots.delete(oldest)
  }
}

/** Drop every snapshot, e.g. after a DDL or a write typed into the console. */
export function clearTableSnapshots(): void {
  snapshots.clear()
}
