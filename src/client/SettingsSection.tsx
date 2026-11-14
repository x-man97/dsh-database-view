import { useEffect, useState, type ReactElement } from 'react'
import type { DbSettings } from '../shared/types'
import { api } from './api'
import { SettingsView } from './views/SettingsView'
import { Banner, Loading } from './ui'

/**
 * The plugin's settings page, rendered inside DSH's own Settings panel.
 * The database panel no longer owns a separate settings dialog.
 */
export function SettingsSection(): ReactElement {
  const [settings, setSettings] = useState<DbSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    void api.status().then(
      (snapshot) => {
        if (alive) setSettings(snapshot.config.settings)
      },
      (caught: unknown) => {
        if (alive) setError(caught instanceof Error ? caught.message : String(caught))
      },
    )
    return () => {
      alive = false
    }
  }, [])

  const save = async (next: DbSettings): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      const result = await api.updateSettings(next)
      setSettings(result.settings)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  if (error !== '' && settings === null) {
    return <Banner tone="error">{error}</Banner>
  }
  if (settings === null) return <Loading label="正在读取数据库设置…" />

  return (
    <div className="dshdb-settings-section">
      {error !== '' ? <Banner tone="error" onClose={() => setError('')}>{error}</Banner> : null}
      <SettingsView settings={settings} saving={saving} onSave={(next) => void save(next)} />
    </div>
  )
}
