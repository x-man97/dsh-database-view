import { describe, expect, it, vi } from 'vitest'

import { apply } from '../../src/client/index.tsx'

/**
 * The sidebar's tab registry keeps its own effect lifetime, so apply() must
 * release every registration it makes. A live client reload tears the plugin
 * down and applies it again; a leaked tab id makes the second registration
 * throw before the pane bodies are registered.
 */
function fakeClient() {
  const tabDisposers = []
  const definitions = []
  const registerTab = vi.fn((definition) => {
    definitions.push(definition)
    const dispose = vi.fn()
    tabDisposers.push(dispose)
    return dispose
  })
  const slots = {
    register: vi.fn(() => vi.fn()),
    inject: vi.fn((_name, callback) => {
      callback()
      return vi.fn()
    }),
  }
  let effectCleanup = () => undefined
  const ctx = {
    locale: {
      register: vi.fn(() => vi.fn()),
      bind: vi.fn(() => (key) => key),
      subscribe: vi.fn(() => vi.fn()),
    },
    sidebarRightTabs: { register: registerTab },
    sidebarRight: { openTab: vi.fn() },
    slots,
    effect: vi.fn((callback) => {
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : vi.fn()
    }),
    inject: vi.fn((_names, callback) => {
      const dispose = callback(ctx)
      return typeof dispose === 'function' ? dispose : vi.fn()
    }),
  }
  // The host.effect inside ctx.inject owns the tab registrations; capture it.
  ctx.effect.mockImplementation((callback) => {
    const dispose = callback()
    if (typeof dispose === 'function') effectCleanup = dispose
    return vi.fn()
  })
  return { ctx, registerTab, tabDisposers, definitions, cleanup: () => effectCleanup() }
}

describe('client apply lifecycle', () => {
  it('keeps table and console tabs mounted so switching tabs does not drop their state', () => {
    const { ctx, definitions } = fakeClient()

    apply(ctx)

    const byKind = new Map(definitions.map((definition) => [definition.kind, definition]))
    expect(byKind.get('database')?.keepMounted).toBe(true)
    expect(byKind.get('database-table')?.keepMounted).toBe(true)
    expect(byKind.get('database-console')?.keepMounted).toBe(true)
    expect(byKind.get('database-table')?.multiple).toBe(true)
    expect(byKind.get('database-console')?.multiple).toBe(true)
  })

  it('releases every tab registration so a live reload can register again', () => {
    const { ctx, registerTab, tabDisposers, cleanup } = fakeClient()

    apply(ctx)

    expect(registerTab).toHaveBeenCalledTimes(3)
    expect(tabDisposers).toHaveLength(3)
    for (const dispose of tabDisposers) expect(dispose).not.toHaveBeenCalled()

    cleanup()

    for (const dispose of tabDisposers) expect(dispose).toHaveBeenCalledTimes(1)
  })
})