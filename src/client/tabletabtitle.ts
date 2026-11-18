/**
 * Title text for table tabs.
 *
 * Open tabs register themselves here; a table that appears in more than one
 * open tab gets its database prefix so same-named tables stay apart, while a
 * unique table keeps the short `table[source]` form.
 */
import { useCallback, useEffect, useId, useSyncExternalStore } from 'react'
import type { TableTabParams } from './tab-open'
import { useLiveConnection } from './connectionstate'

const open = new Map<string, TableTabParams>()
const listeners = new Set<() => void>()
let version = 0

function emit(): void {
  version += 1
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function snapshot(): number {
  return version
}

function duplicateTableName(table: string): boolean {
  let count = 0
  for (const entry of open.values()) {
    if (entry.table !== table) continue
    count += 1
    if (count > 1) return true
  }
  return false
}

/** `database.table[source]` for duplicates, plain `table[source]` otherwise. */
export function tableTabLabel(
  params: TableTabParams,
  sourceName: string | undefined,
  hasDuplicate: (table: string) => boolean,
): string {
  const duplicate = params.schema !== '' && hasDuplicate(params.table)
  const base = duplicate ? `${params.schema}.${params.table}` : params.table
  return sourceName === undefined || sourceName === '' ? base : `${base}[${sourceName}]`
}

export interface TableTabTitleInfo {
  label: string
  /** Source.database.table, used as the tooltip. */
  full: string
}

/** Label of one open table tab, kept in sync with the other open tabs. */
export function useTableTabTitle(params: TableTabParams | undefined): TableTabTitleInfo {
  const id = useId()
  const connection = useLiveConnection(params?.connectionId ?? '')
  useSyncExternalStore(subscribe, snapshot, snapshot)

  const connectionId = params?.connectionId
  const schema = params?.schema
  const table = params?.table
  const kind = params?.kind
  const where = params?.where
  const register = useCallback((): (() => void) => {
    if (connectionId === undefined || table === undefined || params === undefined) return () => undefined
    open.set(id, params)
    emit()
    return () => {
      if (open.delete(id)) emit()
    }
    // `params` only has these primitive fields; comparing them avoids a
    // register/unregister cycle on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, id, kind, schema, table, where])
  useEffect(register, [register])

  if (params === undefined) return { label: '', full: '' }
  return {
    label: tableTabLabel(params, connection?.name, duplicateTableName),
    full: [connection?.name, params.schema, params.table].filter((part) => part !== undefined && part !== '').join('.'),
  }
}
