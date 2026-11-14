import { afterEach, describe, expect, it, vi } from 'vitest'

import { installI18n, t } from '../../src/client/i18n.ts'

let cleanup
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

describe('plugin i18n', () => {
  it('defaults to Chinese without a DSH locale service', () => {
    expect(t('app.add')).toBe('新增')
  })

  it('registers zh/en dictionaries and follows the active locale', () => {
    let active = 'en'
    const dictionaries = {}
    const locale = {
      register: vi.fn((namespace, value) => {
        dictionaries[namespace] = value
        return () => undefined
      }),
      bind: vi.fn(() => (key) => dictionaries['dsh-database-view']?.[active]?.[key] ?? key),
      subscribe: vi.fn(() => () => undefined),
    }
    cleanup = installI18n(locale)
    expect(dictionaries['dsh-database-view'].zh['app.add']).toBe('新增')
    expect(t('app.add')).toBe('Add')
    active = 'zh'
    expect(t('app.add')).toBe('新增')
  })
})
