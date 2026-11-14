import type { ReactElement } from 'react'
import { SQL_KEYWORDS } from './completion/keywords'

const KEYWORDS = new Set(SQL_KEYWORDS.map((word) => word.toUpperCase()))
const NUMBER = /^[0-9]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?/i
const WORD = /^[A-Za-z_][A-Za-z0-9_$]*/

export interface SqlToken {
  text: string
  kind: 'plain' | 'keyword' | 'string' | 'number' | 'comment' | 'operator' | 'function'
}

/** A deliberately tolerant SQL lexer for display only; it never throws. */
export function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = []
  const push = (text: string, kind: SqlToken['kind']): void => {
    const previous = tokens[tokens.length - 1]
    if (previous !== undefined && previous.kind === kind) previous.text += text
    else tokens.push({ text, kind })
  }
  let index = 0
  while (index < sql.length) {
    const char = sql[index] ?? ''
    if (char === '-' && sql[index + 1] === '-') {
      const end = sql.indexOf('\n', index)
      const stop = end < 0 ? sql.length : end
      push(sql.slice(index, stop), 'comment')
      index = stop
      continue
    }
    if (char === '/' && sql[index + 1] === '*') {
      const end = sql.indexOf('*/', index + 2)
      const stop = end < 0 ? sql.length : end + 2
      push(sql.slice(index, stop), 'comment')
      index = stop
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      const quote = char
      let end = index + 1
      while (end < sql.length) {
        if (sql[end] === quote) {
          if (sql[end + 1] === quote) {
            end += 2
            continue
          }
          end += 1
          break
        }
        end += 1
      }
      push(sql.slice(index, end), 'string')
      index = end
      continue
    }
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      push(char, 'plain')
      index += 1
      continue
    }
    const number = NUMBER.exec(sql.slice(index))
    if (number !== null) {
      push(number[0], 'number')
      index += number[0].length
      continue
    }
    const word = WORD.exec(sql.slice(index))
    if (word !== null) {
      const text = word[0]
      const upper = text.toUpperCase()
      let cursor = index + text.length
      while (cursor < sql.length && /\s/u.test(sql[cursor] ?? '')) cursor += 1
      const kind = KEYWORDS.has(upper) ? 'keyword' : sql[cursor] === '(' ? 'function' : 'plain'
      push(text, kind)
      index += text.length
      continue
    }
    push(char, 'operator')
    index += 1
  }
  return tokens
}

export function SqlHighlight(props: { sql: string; className?: string }): ReactElement {
  return (
    <pre className={props.className ?? 'dshdb-sql-highlight'} aria-hidden>
      {tokenizeSql(props.sql).map((token, index) =>
        token.kind === 'plain' ? token.text : <span key={index} className={`dshdb-tok-${token.kind}`}>{token.text}</span>,
      )}
      {'\n'}
    </pre>
  )
}
