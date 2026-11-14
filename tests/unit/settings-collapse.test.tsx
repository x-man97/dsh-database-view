// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { SettingsView } from '../../src/client/views/SettingsView.tsx'

const noop = () => {}

const settings = {
  maxRows: 200,
  queryTimeoutSec: 30,
  connectTimeoutSec: 10,
  allowAgentWrites: false,
  redisScanCount: 200,
  confirmDestructive: false,
  keybindings: {},
}

const env = {
  dataDir: 'C:/data',
  configPath: 'C:/data/config.json',
  pluginVersion: '0.1.0',
  platform: 'win32',
}

function setup() {
  render(
    <SettingsView
      settings={settings}
      env={env}
      drivers={[]}
      saving={false}
      downloading=""
      downloadingJava={false}
      onSave={noop}
      onRefresh={noop}
      onDownload={noop}
      onDownloadJava={noop}
      onAddCustomDriver={noop}
      onEditCustomDriver={noop}
      onDeleteCustomDriver={noop}
    />,
  )
}

const toggle = (title: string): HTMLElement => screen.getByRole('button', { name: title })

/** The body is hidden with the attribute *and* `display: none`, so read the property. */
const panelBody = (title: string): HTMLElement =>
  (toggle(title).closest('section') as HTMLElement).querySelector('.dshdb-panel-body') as HTMLElement

describe('settings panel collapse', () => {
  afterEach(() => {
    cleanup()
  })

  it('opens query safety and keeps the other panels collapsed', () => {
    setup()
    expect(toggle('查询与安全').getAttribute('aria-expanded')).toBe('true')
    expect(panelBody('查询与安全').hidden).toBe(false)
    for (const title of ['快捷键', '数据源工具栏', '控制台', '控制台工具栏']) {
      expect(toggle(title).getAttribute('aria-expanded')).toBe('false')
      expect(panelBody(title).hidden).toBe(true)
    }
  })

  it('toggles one panel open and query safety closed', () => {
    setup()
    fireEvent.click(toggle('快捷键'))
    expect(toggle('快捷键').getAttribute('aria-expanded')).toBe('true')
    expect(panelBody('快捷键').hidden).toBe(false)

    fireEvent.click(toggle('查询与安全'))
    expect(toggle('查询与安全').getAttribute('aria-expanded')).toBe('false')
    expect(panelBody('查询与安全').hidden).toBe(true)
  })
})
