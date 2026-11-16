/**
 * Copy the rows currently shown (or selected) in one table into another table
 * of the same schema, with an explicit column mapping.
 */
import { useEffect, useState, type ReactElement } from 'react'
import type { ClientConnection, ColumnInfo, Row, SchemaObject, SqlDialect } from '../shared/types'
import { api } from './api'
import { formatCount } from './format'
import { useI18n } from './i18n'
import {
  autoCopyMapping,
  buildCopyInsertBatches,
  validateCopyMapping,
  type CopyMapping,
  type CopyMappingIssue,
} from './rowcopy'
import { Banner, Button, Loading, Modal, Select } from './ui'

export interface CopyToDatabaseTarget {
  connection: ClientConnection
  schema: string
  table: string
  columns: ColumnInfo[]
  rows: Row[]
}

export interface CopyToDatabaseModalProps {
  target: CopyToDatabaseTarget | null
  onClose: () => void
  onCopied: (count: number, table: string) => void
}

const ISSUE_KEYS: Record<CopyMappingIssue, string> = {
  'no-target': 'copyTo.error.noTarget',
  'duplicate-target': 'copyTo.error.duplicateTarget',
  'unknown-target': 'copyTo.error.unknownTarget',
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function CopyToDatabaseModal({ target, onClose, onCopied }: CopyToDatabaseModalProps): ReactElement | null {
  const t = useI18n()
  const [candidates, setCandidates] = useState<SchemaObject[]>([])
  const [targetName, setTargetName] = useState('')
  const [targetColumns, setTargetColumns] = useState<ColumnInfo[] | null>(null)
  const [mapping, setMapping] = useState<CopyMapping>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (target === null) return
    let alive = true
    setCandidates([])
    setTargetName('')
    setTargetColumns(null)
    setMapping([])
    setBusy(false)
    setProgress(null)
    setFailure(null)
    void (async () => {
      try {
        const objects = await api.objects(target.connection.id, target.schema)
        if (!alive) return
        setCandidates(objects.objects.filter((entry) => entry.kind === 'table' && entry.name !== target.table))
      } catch (error) {
        if (alive) setFailure(t('copyTo.loadFailed', { error: errorText(error) }))
      }
    })()
    return () => {
      alive = false
    }
  }, [target, t])

  const chooseTarget = async (name: string): Promise<void> => {
    if (target === null) return
    setTargetName(name)
    setTargetColumns(null)
    setMapping([])
    setFailure(null)
    if (name === '') return
    try {
      const described = await api.describe(target.connection.id, target.schema, name, 'table')
      setTargetColumns(described.columns)
      setMapping(autoCopyMapping(target.columns, described.columns))
    } catch (error) {
      setFailure(t('copyTo.loadFailed', { error: errorText(error) }))
    }
  }

  if (target === null) return null

  const readOnly = target.connection.readOnly === true
  const issue = targetColumns === null ? null : validateCopyMapping(mapping, targetColumns)
  const canCopy =
    !busy &&
    !readOnly &&
    targetColumns !== null &&
    issue === null &&
    target.rows.length > 0

  const execute = async (): Promise<void> => {
    if (!canCopy || targetColumns === null) return
    const batches = buildCopyInsertBatches({
      dialect: target.connection.dialect as SqlDialect,
      schema: target.schema,
      table: targetName,
      sourceColumns: target.columns,
      targetColumns,
      mapping,
      rows: target.rows,
    })
    if (batches.length === 0) {
      setFailure(t('copyTo.error.noRows'))
      return
    }
    setBusy(true)
    setFailure(null)
    setProgress({ done: 0, total: batches.length })
    try {
      for (const [index, sql] of batches.entries()) {
        try {
          await api.query({
            id: target.connection.id,
            sql,
            schema: target.schema,
            allowWrite: true,
            maxRows: 1,
          })
        } catch (error) {
          throw new Error(`${t('copyTo.error.batch', { n: index + 1 })} ${errorText(error)}`)
        }
        setProgress({ done: index + 1, total: batches.length })
      }
      onCopied(target.rows.length, targetName)
      onClose()
    } catch (error) {
      setFailure(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={t('copyTo.title')}
      width={860}
      onClose={onClose}
      footer={
        <>
          <span className="dshdb-muted">
            {progress !== null && busy
              ? t('copyTo.progress', { done: progress.done, total: progress.total })
              : t('copyTo.rows', { n: formatCount(target.rows.length) })}
          </span>
          <span className="dshdb-toolbar-spacer" />
          <Button size="sm" onClick={onClose} disabled={busy}>
            {t('designer.cancel')}
          </Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!canCopy} onClick={() => void execute()}>
            {t('copyTo.write')}
          </Button>
        </>
      }
    >
      <div className="dshdb-designer">
        {readOnly ? <Banner tone="warn">{t('copyTo.readonly')}</Banner> : null}
        {failure !== null ? <Banner tone="error">{failure}</Banner> : null}
        <div className="dshdb-designer-identity">
          <label className="dshdb-designer-field">
            <span>{t('copyTo.source')}</span>
            <span className="dshdb-mono">{t('copyTo.sourceRows', { name: `${target.schema}.${target.table}`, n: formatCount(target.rows.length) })}</span>
          </label>
          <label className="dshdb-designer-field">
            <span>{t('copyTo.targetTable')}</span>
            <Select
              aria-label={t('copyTo.targetTable')}
              value={targetName}
              options={[
                { value: '', label: t('copyTo.choose') },
                ...candidates.map((entry) => ({ value: entry.name, label: entry.name })),
              ]}
              onValueChange={(value) => void chooseTarget(value)}
            />
          </label>
        </div>
        {candidates.length === 0 && !busy ? <p className="dshdb-muted">{t('copyTo.noTables')}</p> : null}
        {targetName !== '' && targetColumns === null && !busy && failure === null ? (
          <div className="dshdb-empty">
            <Loading size={16} label={t('copyTo.loading')} />
          </div>
        ) : null}
        {targetColumns !== null ? (
          <section className="dshdb-designer-section">
            <div className="dshdb-designer-section-head">
              <strong>{t('copyTo.mapping')}</strong>
              {issue !== null ? <span className="dshdb-muted">{t(ISSUE_KEYS[issue])}</span> : null}
            </div>
            <div className="dshdb-designer-scroll">
              <table className="dshdb-designer-table">
                <thead>
                  <tr>
                    <th>{t('copyTo.sourceColumn')}</th>
                    <th>{t('copyTo.targetColumn')}</th>
                  </tr>
                </thead>
                <tbody>
                  {target.columns.map((column, index) => (
                    <tr key={`${column.name}-${String(index)}`}>
                      <td className="dshdb-mono">{column.name}</td>
                      <td>
                        <Select
                          aria-label={`${t('copyTo.targetColumn')} ${column.name}`}
                          value={mapping[index] ?? ''}
                          options={[
                            { value: '', label: t('copyTo.skip') },
                            ...targetColumns.map((entry) => ({
                              value: entry.name,
                              label: `${entry.name} · ${entry.typeName}`,
                            })),
                          ]}
                          onValueChange={(value) =>
                            setMapping((current) => {
                              const next = [...current]
                              next[index] = value === '' ? null : value
                              return next
                            })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </Modal>
  )
}