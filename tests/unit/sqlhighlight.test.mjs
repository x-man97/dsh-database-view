import { describe, expect, it } from 'vitest'

import { tokenizeSql } from '../../src/client/sqlhighlight.tsx'

describe('tokenizeSql', () => {
  it('separates keywords, strings, numbers and comments', () => {
    const tokens = tokenizeSql("SELECT id, 'it''s' AS x -- note\nFROM t WHERE n = 42")
    expect(tokens.filter((token) => token.kind === 'keyword').map((token) => token.text.toUpperCase())).toEqual(['SELECT', 'AS', 'FROM', 'WHERE'])
    expect(tokens.some((token) => token.kind === 'string' && token.text === "'it''s'")).toBe(true)
    expect(tokens.some((token) => token.kind === 'number' && token.text === '42')).toBe(true)
    expect(tokens.some((token) => token.kind === 'comment' && token.text.includes('note'))).toBe(true)
  })

  it('marks function calls', () => {
    const tokens = tokenizeSql('select count(*) from t')
    expect(tokens.some((token) => token.kind === 'function' && token.text === 'count')).toBe(true)
  })
})
