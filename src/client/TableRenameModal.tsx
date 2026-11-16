/**
 * Rename dialog for one table: the server executes RENAME TABLE, the dialog only
 * collects the new name and keeps validation next to the field.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { ClientConnection } from '../shared/types'
import { useI18n } from './i18n'
import { Banner, Button, Modal, TextInput } from './ui'

export interface TableRenameTarget {
  connection: ClientConnection
  schema: string
  table: string
}

export interface TableRenameModalProps {
  target: TableRenameTarget | null
  onClose: () => void
  onRename: (target: TableRenameTarget, name: string) => Promise<void>
}

export function TableRenameModal({ target, onClose, onRename }: TableRenameModalProps): ReactElement | null {
  const t = useI18n()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (target === null) return
    setName(target.table)
    setFailure(null)
    setBusy(false)
    setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
  }, [target])

  if (target === null) return null

  const trimmed = name.trim()
  const valid = trimmed !== '' && trimmed !== target.table

  const submit = async (): Promise<void> => {
    if (!valid || busy) return
    setBusy(true)
    setFailure(null)
    try {
      await onRename(target, trimmed)
      onClose()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={t('rename.title')}
      width={420}
      onClose={onClose}
      footer={
        <>
          <span className="dshdb-toolbar-spacer" />
          <Button size="sm" onClick={onClose} disabled={busy}>
            {t('designer.cancel')}
          </Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!valid} onClick={() => void submit()}>
            {t('rename.confirm')}
          </Button>
        </>
      }
    >
      {failure !== null ? <Banner tone="error">{failure}</Banner> : null}
      <p className="dshdb-muted" style={{ margin: '0 0 8px' }}>
        {t('rename.message', { schema: target.schema, table: target.table })}
      </p>
      <label className="dshdb-designer-field">
        <span>{t('rename.label')}</span>
        <TextInput
          ref={inputRef}
          value={name}
          aria-label={t('rename.label')}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
        />
      </label>
      {!valid && trimmed !== '' ? (
        <p className="dshdb-muted" style={{ margin: '8px 0 0' }}>
          {t('rename.same')}
        </p>
      ) : null}
    </Modal>
  )
}
