/**
 * A tolerant JSON lexer for the full-value cell editor.
 *
 * It never throws: strings, numbers, literals and punctuation are colored,
 * everything else (whitespace, half-typed input) stays plain, so a document
 * under edit keeps its colors without having to be valid first.
 */
import type { ReactElement } from 'react'

type JsonTokenKind = 'plain' | 'key' | 'string' | 'number' | 'literal' | 'punct'

interface JsonToken {
  text: string
  kind: JsonTokenKind
}

const NUMBER = /^-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/
const LITERAL = /^(?:true|false|null)\b/

/** True when the text is a complete JSON object or array. */
export function looksLikeJson(text: string): boolean {
  const trimmed = text.trim()
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function stringEnd(text: string, start: number): number {
  let index = start + 1
  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2
      continue
    }
    if (text[index] === '"') return index + 1
    index += 1
  }
  return text.length
}

export function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = []
  const push = (value: string, kind: JsonTokenKind): void => {
    const previous = tokens[tokens.length - 1]
    if (previous !== undefined && previous.kind === kind) previous.text += value
    else tokens.push({ text: value, kind })
  }
  let index = 0
  while (index < text.length) {
    const char = text[index] ?? ''
    if (char === '"') {
      const end = stringEnd(text, index)
      let cursor = end
      while (cursor < text.length && /\s/u.test(text[cursor] ?? '')) cursor += 1
      push(text.slice(index, end), text[cursor] === ':' ? 'key' : 'string')
      index = end
      continue
    }
    const number = NUMBER.exec(text.slice(index))
    if (number !== null) {
      push(number[0], 'number')
      index += number[0].length
      continue
    }
    const literal = LITERAL.exec(text.slice(index))
    if (literal !== null) {
      push(literal[0], 'literal')
      index += literal[0].length
      continue
    }
    if ('{}[],:'.includes(char)) {
      push(char, 'punct')
      index += 1
      continue
    }
    push(char, 'plain')
    index += 1
  }
  return tokens
}

export function JsonHighlight({ text }: { text: string }): ReactElement {
  return (
    <>
      {tokenizeJson(text).map((token, index) =>
        token.kind === 'plain' ? (
          token.text
        ) : (
          <span key={index} className={`dshdb-jtok-${token.kind}`}>
            {token.text}
          </span>
        ),
      )}
    </>
  )
}
