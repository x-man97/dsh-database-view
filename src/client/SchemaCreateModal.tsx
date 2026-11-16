/**
 * Create-schema dialog: collects a name and lets the server create the
 * namespace. MySQL runs CREATE DATABASE; PostgreSQL and SQL Server run
 * CREATE SCHEMA.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { ClientConnection } from '../shared/types'
import { useI18n } from './i18n'
import { createSchemaSql } from './schemaddl'
import { Banner, Button, Modal, TextInput } from './ui'

export interface SchemaCreateTarget {
  connection: ClientConnection
}

export interface SchemaCreateModalProps {
  target: SchemaCreateTarget | null
  onClose: () => void
  onCreate: (target: SchemaCreateTarget, name: string) => Promise<void>
}

export function SchemaCreateModal({ target, onClose, onCreate }: SchemaCreateModalProps): ReactElement | null {
  const t = useI18n()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (target === null) return
    setName('')
    setFailure(null)
    setBusy(false)
    setTimeout(() => {
      inputRef.current?.focus()
    }, 0)
  }, [target])

  if (target === null) return null

  const trimmed = name.trim()
  const statement = createSchemaSql(target.connection.dialect, trimmed)
  const valid = statement !== null

  const submit = async (): Promise<void> => {
    if (!valid || busy) return
    setBusy(true)
    setFailure(null)
    try {
      await onCreate(target, trimmed)
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
      title={t('schemaCreate.title')}
      width={440}
      onClose={onClose}
      footer={
        <>
          <span className="dshdb-toolbar-spacer" />
          <Button size="sm" onClick={onClose} disabled={busy}>
            {t('designer.cancel')}
          </Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!valid} onClick={() => void submit()}>
            {t('schemaCreate.confirm')}
          </Button>
        </>
      }
    >
      {failure !== null ? <Banner tone="error">{failure}</Banner> : null}
      <p className="dshdb-muted" style={{ margin: '0 0 8px' }}>
        {t('schemaCreate.message', { name: target.connection.name })}
        {target.connection.dialect === 'mysql' ? ` ${t('schemaCreate.mysqlNote')}` : ''}
      </p>
      <label className="dshdb-designer-field">
        <span>{t('schemaCreate.label')}</span>
        <TextInput
          ref={inputRef}
          value={name}
          aria-label={t('schemaCreate.label')}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
        />
      </label>
      {statement === null ? null : (
        <p className="dshdb-muted" style={{ margin: '8px 0 0' }}>
          {t('schemaCreate.preview')} <span className="dshdb-mono">{statement}</span>
        </p>
      )}
    </Modal>
  )
}
