import type { ConnectionDraft, ConnectionTestResult, DdlResult, ExplainResult, ObjectKind, QueryResult, SchemaInfo, SchemaObject, ServerInfo, TableDescription } from '../shared/types.js'
import type { ConfigStore } from './config.js'
import { NativeSqlService } from './native.js'
import { DriverManager as NativeDriverManager } from './drivers/manager.js'
import type { PluginPaths } from './paths.js'
import type { SecretStore } from './secrets.js'

export interface QueryOptions {
  maxRows?: number
  timeoutSec?: number
  schema?: string
  stmtKey?: string
  allowWrite?: boolean
}

const READ_ONLY_STARTERS = new Set(['select', 'with', 'show', 'describe', 'desc', 'explain', 'values'])

/** True for identifier characters; deliberately ASCII plus anything above 127. */
function isWordChar(char: string): boolean {
  if (char === '_' || char === '$') return true
  const code = char.codePointAt(0) ?? 0
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code > 127
}

function skipSpace(text: string, index: number): number {
  let cursor = index
  while (cursor < text.length) {
    const char = text[cursor]
    if (char !== ' ' && char !== '\t' && char !== '\n' && char !== '\r') break
    cursor += 1
  }
  return cursor
}

function readWord(text: string, index: number): { word: string; end: number } {
  let end = index
  while (end < text.length && isWordChar(text[end] ?? '')) end += 1
  return { word: text.slice(index, end).toLowerCase(), end }
}

/** Index of the parenthesis closing the one at `open`, skipping quoted text and comments. */
function matchingParen(text: string, open: number): number {
  let depth = 0
  for (let index = open; index < text.length; index += 1) {
    const char = text[index]
    if (char === "'" || char === '"' || char === '`') {
      const quote = char
      index += 1
      while (index < text.length) {
        if (text[index] === quote) {
          if (text[index + 1] === quote) {
            index += 2
            continue
          }
          break
        }
        index += 1
      }
      continue
    }
    if (char === '-' && text[index + 1] === '-') {
      const newline = text.indexOf('\n', index)
      if (newline < 0) return -1
      index = newline
      continue
    }
    if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2)
      if (end < 0) return -1
      index = end + 1
      continue
    }
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

/**
 * The statement that follows a `WITH cte AS (...), ...` clause. Returns null
 * when the CTE list cannot be parsed, which the read-only guard treats as a
 * write.
 */
function statementAfterWith(text: string): string | null {
  let cursor = skipSpace(text, 'with'.length)
  const recursive = readWord(text, cursor)
  if (recursive.word === 'recursive') cursor = skipSpace(text, recursive.end)
  for (;;) {
    const name = readWord(text, cursor)
    if (name.word === '') return null
    cursor = skipSpace(text, name.end)
    if (text[cursor] === '(') {
      const close = matchingParen(text, cursor)
      if (close < 0) return null
      cursor = skipSpace(text, close + 1)
    }
    const as = readWord(text, cursor)
    if (as.word !== 'as') return null
    cursor = skipSpace(text, as.end)
    for (;;) {
      const modifier = readWord(text, cursor)
      if (modifier.word !== 'not' && modifier.word !== 'materialized') break
      cursor = skipSpace(text, modifier.end)
    }
    if (text[cursor] !== '(') return null
    const close = matchingParen(text, cursor)
    if (close < 0) return null
    cursor = skipSpace(text, close + 1)
    if (text[cursor] !== ',') break
    cursor = skipSpace(text, cursor + 1)
  }
  return text.slice(cursor)
}

/** Statements that write files on the server; a read-only connection must refuse them. */
const FILE_WRITE = /\binto\s+(?:outfile|dumpfile)\b/

/** Lowercase copy of `text` with quoted strings and comments blanked out. */
function withoutLiterals(text: string): string {
  let out = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    if (char === "'" || char === '"' || char === '`') {
      const quote = char
      index += 1
      while (index < text.length) {
        if (text[index] === quote) {
          if (text[index + 1] === quote) {
            index += 2
            continue
          }
          break
        }
        index += 1
      }
      out += ' '
      continue
    }
    if (char === '-' && text[index + 1] === '-') {
      const newline = text.indexOf('\n', index)
      if (newline < 0) return out
      index = newline
      out += ' '
      continue
    }
    if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2)
      if (end < 0) return out
      index = end + 1
      out += ' '
      continue
    }
    out += char.toLowerCase()
  }
  return out
}

/** Conservative guard used before the panel runs a statement on a read-only connection. */
export function isReadOnlySql(sql: string): boolean {
  let text = sql.trim()
  // Strip leading comments so `/* hint */ select 1` still counts as a read.
  for (;;) {
    if (text.startsWith('--')) {
      const newline = text.indexOf('\n')
      if (newline < 0) return false
      text = text.slice(newline + 1).trim()
      continue
    }
    if (text.startsWith('/*')) {
      const end = text.indexOf('*/', 2)
      if (end < 0) return false
      text = text.slice(end + 2).trim()
      continue
    }
    break
  }
  const withoutTrailing = text.replace(/;+\s*$/, '')
  if (withoutTrailing.includes(';')) return false
  const first = /^[A-Za-z]+/.exec(withoutTrailing)
  if (first === null) return false
  const head = first[0].toLowerCase()
  if (!READ_ONLY_STARTERS.has(head)) return false
  if (head === 'with') {
    // A CTE list can front any statement, including DELETE; judge what it runs.
    const inner = statementAfterWith(withoutTrailing)
    return inner !== null && isReadOnlySql(inner)
  }
  if (head === 'explain') {
    // `EXPLAIN ANALYZE <statement>` and the parenthesised `EXPLAIN (ANALYZE, ...)`
    // form run <statement>; plain EXPLAIN only plans.
    let rest = withoutTrailing.slice(first[0].length).trim()
    if (rest.startsWith('(')) {
      const close = matchingParen(rest, 0)
      if (close < 0) return false
      if (!/\banalyze\b/.test(withoutLiterals(rest.slice(1, close)))) return true
      rest = rest.slice(close + 1).trim()
      return rest !== '' && isReadOnlySql(rest)
    }
    const analyze = readWord(rest, 0)
    if (analyze.word !== 'analyze') return true
    rest = rest.slice(analyze.end).trim()
    const format = readWord(rest, 0)
    if (format.word === 'format') {
      const equals = rest.indexOf('=')
      if (equals < 0) return false
      const value = readWord(rest, skipSpace(rest, equals + 1))
      if (value.word === '') return false
      rest = rest.slice(value.end).trim()
    }
    return rest !== '' && isReadOnlySql(rest)
  }
  // `SELECT ... INTO OUTFILE '/path'` looks plain but writes a file on the server.
  if (FILE_WRITE.test(withoutLiterals(withoutTrailing))) return false
  return true
}

/** SQLite silently creates the file when it is missing; say so instead of pretending it existed. */

export class SqlService {
  private readonly native: NativeSqlService

  constructor(
    paths: PluginPaths,
    config: ConfigStore,
    secrets: SecretStore,
    log: (message: string) => void = () => {},
    nativeDrivers?: NativeDriverManager,
  ) {
    this.native = new NativeSqlService(paths, config, secrets, nativeDrivers ?? new NativeDriverManager(paths, log), log)
  }

  isConnected(connId: string): boolean {
    return this.native.isConnected(connId)
  }

  connectedIds(): string[] {
    return this.native.connectedIds()
  }

  serverOf(connId: string): ServerInfo | undefined {
    return this.native.serverOf(connId)
  }

  test(draft: ConnectionDraft): Promise<ConnectionTestResult> {
    return this.native.test(draft)
  }

  connect(connId: string): Promise<ServerInfo> {
    return this.native.connect(connId)
  }

  disconnect(connId: string): Promise<void> {
    return this.native.disconnect(connId)
  }

  schemas(connId: string, filter = ''): Promise<SchemaInfo[]> {
    return this.native.schemas(connId, filter)
  }

  objects(connId: string, schema: string): Promise<SchemaObject[]> {
    return this.native.objects(connId, schema)
  }

  setSchema(connId: string, schema: string): Promise<void> {
    return this.native.setSchema(connId, schema)
  }

  describe(connId: string, schema: string, table: string, kind: ObjectKind = 'table'): Promise<TableDescription> {
    return this.native.describe(connId, schema, table, kind)
  }

  ddl(connId: string, _dialect: string, schema: string, table: string, kind: ObjectKind = 'table'): Promise<DdlResult> {
    return this.native.ddl(connId, schema, table, kind)
  }

  explain(connId: string, sql: string, _options: QueryOptions = {}): Promise<ExplainResult> {
    return this.native.explain(connId, sql)
  }

  transaction(connId: string, action: 'start' | 'commit' | 'rollback'): Promise<void> {
    return this.native.transaction(connId, action === 'start' ? 'begin' : action)
  }

  query(connId: string, sql: string, options: QueryOptions = {}): Promise<QueryResult> {
    return this.native.query(connId, sql, options)
  }

  cancel(stmtKey: string): Promise<boolean> {
    return this.native.cancel(stmtKey)
  }

  dispose(): Promise<void> {
    return this.native.dispose()
  }
}
