/**
 * Live connection state shared by every sidebar tab.
 *
 * The database panel, table tabs and consoles are separate React roots inside
 * one page, so a module-level store is what keeps "connected" and the saved
 * read-only flag identical everywhere: a connect in one tab must be visible in
 * the others, and editing a data source must not leave a stale table tab able
 * to write.
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { ClientConnection, ServerInfo } from '../shared/types'
import { ApiError, api } from './api'

export interface SharedConnectionState {
  /** Saved connections; null until the first status read. */
  connections: ClientConnection[] | null
  /** Open sessions by connection id. */
  servers: Record<string, ServerInfo>
  /** Data source currently being opened, '' when idle. */
  connectingId: string
}

let state: SharedConnectionState = { connections: null, servers: {}, connectingId: '' }
const listeners = new Set<() => void>()
let statusRequest: Promise<ClientConnection[] | null> | null = null
const opening = new Map<string, Promise<ServerInfo>>()

/** Stand-in for a session the host reports without details (Redis keeps none). */
const UNKNOWN_SERVER: ServerInfo = { product: '', version: '' }

function commit(next: Partial<SharedConnectionState>): void {
  state = { ...state, ...next }
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function snapshot(): SharedConnectionState {
  return state
}

/** True when two copies describe the same saved target and write policy. */
export function sameConnectionConfig(left: ClientConnection, right: ClientConnection): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.driver === right.driver &&
    left.dialect === right.dialect &&
    left.host === right.host &&
    left.port === right.port &&
    left.user === right.user &&
    left.hasPassword === right.hasPassword &&
    left.database === right.database &&
    left.redisDb === right.redisDb &&
    left.readOnly === right.readOnly &&
    JSON.stringify(left.ssh ?? null) === JSON.stringify(right.ssh ?? null) &&
    JSON.stringify(left.tls ?? null) === JSON.stringify(right.tls ?? null)
  )
}

function sameConnectionList(left: ClientConnection[] | null, right: ClientConnection[]): boolean {
  if (left === null || left.length !== right.length) return false
  return left.every((connection, index) => {
    const other = right[index]
    return other !== undefined && sameConnectionConfig(connection, other)
  })
}

/**
 * Publish a status/config read. `connected` lists the sessions the host has
 * open; it prunes sessions a config change closed and restores them after a
 * page reload.
 */
export function publishConnections(connections: ClientConnection[], connected?: readonly string[]): void {
  const next: Partial<SharedConnectionState> = {}
  if (!sameConnectionList(state.connections, connections)) next.connections = connections
  if (connected !== undefined) {
    const known = state.servers
    const unchanged =
      Object.keys(known).length === connected.length &&
      connected.every((id) => known[id] !== undefined)
    if (!unchanged) {
      const servers: Record<string, ServerInfo> = {}
      for (const id of connected) servers[id] = known[id] ?? UNKNOWN_SERVER
      next.servers = servers
    }
  }
  if (next.connections !== undefined || next.servers !== undefined) commit(next)
}

/** One in-flight status read, shared by every tab that mounts at the same time. */
export function refreshConnections(): Promise<ClientConnection[] | null> {
  if (statusRequest !== null) return statusRequest
  if (typeof api.status !== 'function') return Promise.resolve(state.connections)
  const request = api
    .status()
    .then((data) => {
      publishConnections(data.config.connections, data.connected)
      return data.config.connections
    })
    .catch(() => null)
    .then((result) => {
      if (statusRequest === request) statusRequest = null
      return result
    })
  statusRequest = request
  return request
}

/** Saved config right now; read it from the host when no tab has yet. */
export function ensureConnections(): Promise<ClientConnection[] | null> {
  return state.connections !== null ? Promise.resolve(state.connections) : refreshConnections()
}

/** Open one data source; concurrent callers share the same request. */
export function connectConnection(id: string): Promise<ServerInfo> {
  const live = state.servers[id]
  if (live !== undefined) return Promise.resolve(live)
  const pending = opening.get(id)
  if (pending !== undefined) return pending
  commit({ connectingId: id })
  const task = api.connect(id).then(
    (server) => {
      commit({ servers: { ...state.servers, [id]: server }, connectingId: '' })
      return server
    },
    (error: unknown) => {
      commit({ connectingId: '' })
      throw error
    },
  )
  opening.set(id, task)
  void task.catch(() => undefined).finally(() => opening.delete(id))
  return task
}

/** Close a data source and tell every tab. */
export async function disconnectConnection(id: string): Promise<void> {
  await api.disconnect(id)
  const servers = { ...state.servers }
  delete servers[id]
  commit({ servers })
}

/**
 * Run one call that needs an open session. A host that lost the session (a
 * config edit disconnects it, a restart drops it) is reopened once, so a table
 * tab never stays stuck on "not connected".
 */
export async function withConnection<T>(id: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'not-connected') throw error
    const servers = { ...state.servers }
    delete servers[id]
    commit({ servers })
    await connectConnection(id)
    return await action()
  }
}

export function useSharedConnections(): SharedConnectionState {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/**
 * Saved config of one data source, kept current by any tab. It reads the host
 * once when no tab has yet, so a table tab restored after a reload can name
 * its source.
 */
export function useLiveConnection(id: string): ClientConnection | undefined {
  const shared = useSharedConnections()
  useEffect(() => {
    if (shared.connections === null) void refreshConnections()
  }, [shared.connections])
  return shared.connections?.find((connection) => connection.id === id)
}
