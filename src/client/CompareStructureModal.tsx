/**
 * Compare two tables' structures inside one schema. The left side is the table
 * the menu was opened on; the right side is picked from the same schema.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { ClientConnection, SchemaObject, TableDescription } from '../shared/types'
import { api } from './api'
import { useI18n } from './i18n'
import { diffTableStructures, type StructureDelta } from './structurediff'
import { Banner, Button, Loading, Modal, Select } from './ui'

export interface CompareStructureTarget {
  connection: ClientConnection
  schema: string
  table: string
}

export interface CompareStructureModalProps {
  target: CompareStructureTarget | null
  onClose: () => void
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function CompareStructureModal({ target, onClose }: CompareStructureModalProps): ReactElement | null {
  const t = useI18n()
  const [candidates, setCandidates] = useState<SchemaObject[]>([])
  const [otherName, setOtherName] = useState('')
  const [left, setLeft] = useState<TableDescription | null>(null)
  const [right, setRight] = useState<TableDescription | null>(null)
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (target === null) return
    let alive = true
    setCandidates([])
    setOtherName('')
    setLeft(null)
    setRight(null)
    setFailure(null)
    setLoading(true)
    void (async () => {
      try {
        const [objects, described] = await Promise.all([
          api.objects(target.connection.id, target.schema),
          api.describe(target.connection.id, target.schema, target.table, 'table'),
        ])
        if (!alive) return
        if (described.kind !== 'table') throw new Error(t('compare.notTable'))
        setLeft(described)
        setCandidates(objects.objects.filter((entry) => entry.kind === 'table' && entry.name !== target.table))
      } catch (error) {
        if (alive) setFailure(t('compare.loadFailed', { error: errorText(error) }))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [target, t])

  const loadOther = async (name: string): Promise<void> => {
    if (target === null) return
    setOtherName(name)
    setRight(null)
    setFailure(null)
    if (name === '') return
    setLoading(true)
    try {
      const described = await api.describe(target.connection.id, target.schema, name, 'table')
      setRight(described)
    } catch (error) {
      setFailure(t('compare.loadFailed', { error: errorText(error) }))
    } finally {
      setLoading(false)
    }
  }

  const diff = useMemo(() => (left === null || right === null ? null : diffTableStructures(left, right)), [left, right])

  if (target === null) return null

  const statusLabel = (delta: StructureDelta): string =>
    delta.status === 'added' ? t('compare.onlyTarget') : delta.status === 'removed' ? t('compare.onlySource') : t('compare.changed')
  const fieldLabel = (field: string): string => t(`compare.field.${field}`)
  const valueLabel = (value: string): string => (value === 'true' ? '✓' : value === 'false' ? '—' : value)
  const deltaRows = (deltas: StructureDelta[]): ReactElement => (
    <table className="dshdb-designer-table">
      <thead>
        <tr>
          <th>{t('compare.object')}</th>
          <th>{t('compare.status')}</th>
          <th>{t('compare.changes')}</th>
        </tr>
      </thead>
      <tbody>
        {deltas.map((delta) => (
          <tr key={delta.name}>
            <td className="dshdb-mono">{delta.name}</td>
            <td>{statusLabel(delta)}</td>
            <td>
              {delta.changes.length === 0
                ? '—'
                : delta.changes
                    .map((change) => `${fieldLabel(change.field)}: ${valueLabel(change.left)} → ${valueLabel(change.right)}`)
                    .join(' · ')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <Modal
      open
      title={t('compare.title')}
      width={860}
      onClose={onClose}
      footer={
        <>
          <span className="dshdb-muted">
            {diff === null
              ? t('compare.hint')
              : t('compare.summary', {
                  added: diff.columns.filter((entry) => entry.status === 'added').length + diff.indexes.filter((entry) => entry.status === 'added').length,
                  removed: diff.columns.filter((entry) => entry.status === 'removed').length + diff.indexes.filter((entry) => entry.status === 'removed').length,
                  changed: diff.columns.filter((entry) => entry.status === 'changed').length + diff.indexes.filter((entry) => entry.status === 'changed').length,
                })}
          </span>
          <span className="dshdb-toolbar-spacer" />
          <Button size="sm" variant="primary" onClick={onClose}>
            {t('designer.cancel')}
          </Button>
        </>
      }
    >
      <div className="dshdb-designer">
        {failure !== null ? <Banner tone="error">{failure}</Banner> : null}
        <div className="dshdb-designer-identity">
          <label className="dshdb-designer-field">
            <span>{t('compare.source')}</span>
            <span className="dshdb-mono">
              {target.schema}.{target.table}
            </span>
          </label>
          <label className="dshdb-designer-field">
            <span>{t('compare.target')}</span>
            <Select
              aria-label={t('compare.target')}
              value={otherName}
              options={[
                { value: '', label: t('compare.choose') },
                ...candidates.map((entry) => ({ value: entry.name, label: entry.name })),
              ]}
              onValueChange={(value) => void loadOther(value)}
            />
          </label>
        </div>
        {loading ? (
          <div className="dshdb-empty">
            <Loading size={16} label={t('compare.loading')} />
          </div>
        ) : null}
        {!loading && candidates.length === 0 && left !== null ? (
          <p className="dshdb-muted">{t('compare.noTables')}</p>
        ) : null}
        {diff !== null ? (
          diff.equal ? (
            <Banner tone="success">{t('compare.equal')}</Banner>
          ) : (
            <>
              <section className="dshdb-designer-section">
                <div className="dshdb-designer-section-head">
                  <strong>{t('compare.columns')}</strong>
                </div>
                {diff.columns.length === 0 ? <p className="dshdb-muted">{t('compare.none')}</p> : deltaRows(diff.columns)}
              </section>
              <section className="dshdb-designer-section">
                <div className="dshdb-designer-section-head">
                  <strong>{t('compare.indexes')}</strong>
                </div>
                {diff.indexes.length === 0 ? <p className="dshdb-muted">{t('compare.none')}</p> : deltaRows(diff.indexes)}
              </section>
            </>
          )
        ) : null}
      </div>
    </Modal>
  )
}
