import { describe, expect, it } from 'vitest'

import { looksLikeJson, tokenizeJson } from '../../src/client/jsonhighlight'

function kinds(text) {
  return tokenizeJson(text).map((token) => [token.kind, token.text])
}

describe('JSON highlighting', () => {
  it('distinguishes keys, strings, numbers, literals and punctuation', () => {
    expect(kinds('{"a":1,"b":[true,null],"c":"x"}')).toEqual([
      ['punct', '{'],
      ['key', '"a"'],
      ['punct', ':'],
      ['number', '1'],
      ['punct', ','],
      ['key', '"b"'],
      ['punct', ':['],
      ['literal', 'true'],
      ['punct', ','],
      ['literal', 'null'],
      ['punct', '],'],
      ['key', '"c"'],
      ['punct', ':'],
      ['string', '"x"'],
      ['punct', '}'],
    ])
  })

  it('keeps whitespace and half-typed text plain', () => {
    expect(kinds('{\n  "a": ')).toEqual([
      ['punct', '{'],
      ['plain', '\n  '],
      ['key', '"a"'],
      ['punct', ':'],
      ['plain', ' '],
    ])
  })

  it('handles escaped quotes inside strings', () => {
    expect(kinds('"a\\"b"')).toEqual([['string', '"a\\"b"']])
  })

  it('only reports complete object or array documents as JSON', () => {
    expect(looksLikeJson('{"a":1}')).toBe(true)
    expect(looksLikeJson(' [1,2] ')).toBe(true)
    expect(looksLikeJson('{"a":')).toBe(false)
    expect(looksLikeJson('42')).toBe(false)
    expect(looksLikeJson('hello')).toBe(false)
  })
})
