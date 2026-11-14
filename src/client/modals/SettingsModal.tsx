import type { ReactElement } from 'react'
import type { DbSettings } from '../../shared/types'
import { SettingsView } from '../views/SettingsView'
import { Modal } from '../ui'

export interface SettingsModalProps {
  open: boolean
  settings: DbSettings
  saving: boolean
  onClose: () => void
  onSave: (settings: DbSettings) => void
}

export function SettingsModal(props: SettingsModalProps): ReactElement | null {
  if (!props.open) return null
  return (
    <Modal open title="数据库设置" width={720} onClose={props.onClose}>
      <SettingsView settings={props.settings} saving={props.saving} onSave={props.onSave} />
    </Modal>
  )
}
