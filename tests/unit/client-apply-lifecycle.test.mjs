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
  const registerTab = vi.fn(() => {
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
  return { ctx, registerTab, tabDisposers, cleanup: () => effectCleanup() }
}

describe('client apply lifecycle', () => {
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