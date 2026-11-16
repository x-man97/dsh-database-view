/**
 * Compare the rows of two tables in one schema. Both sides are read with a
 * 5,000-row ceiling; rows are aligned by a shared primary key or, failing that,
 * by every common column.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { ClientConnection, QueryResult, SchemaObject, TableDescription } from '../shared/types'
import { api } from './api'
import { diffTableData, type DataDiff } from './datadiff'
import { useI18n } from './i18n'
import { qualifiedName, quoteIdent } from './tablesql'
import { Banner, Button, Loading, Modal, Select } from './ui'

export interface CompareDataTarget {
  connection: ClientConnection
  schema: string
  table: string
}

export interface CompareDataModalProps {
  target: CompareDataTarget | null
  onClose: () => void
}

const MAX_ROWS = 5000
const MAX_SHOWN = 200

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function CompareDataModal({ target, onClose }: CompareDataModalProps): ReactElement | null {
  const t = useI18n()
  const [candidates, setCandidates] = useState<SchemaObject[]>([])
  const [otherName, setOtherName] = useState('')
  const [left, setLeft] = useState<TableDescription | null>(null)
  const [diff, setDiff] = useState<DataDiff | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (target === null) return
    let alive = true
    setCandidates([])
    setOtherName('')
    setLeft(null)
    setDiff(null)
    setTruncated(false)
    setFailure(null)
    setLoading(true)
    void (async () => {
      try {
        const [objects, described] = await Promise.all([
          api.objects(target.connection.id, target.schema),
          api.describe(target.connection.id, target.schema, target.table, 'table'),
        ])
        if (!alive) return
        if (described.kind !== 'table') throw new Error(t('dataCompare.notTable'))
        setLeft(described)
        setCandidates(objects.objects.filter((entry) => entry.kind === 'table' && entry.name !== target.table))
      } catch (error) {
        if (alive) setFailure(t('dataCompare.loadFailed', { error: errorText(error) }))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [target, t])

  const compare = async (name: string): Promise<void> => {
    if (target === null || left === null) return
    setOtherName(name)
    setDiff(null)
    setTruncated(false)
    setFailure(null)
    if (name === '') return
    setLoading(true)
    try {
      const right = await api.describe(target.connection.id, target.schema, name, 'table')
      if (right.kind !== 'table') throw new Error(t('dataCompare.notTable'))
      const rightNames = new Set(right.columns.map((column) => column.name))
      const common = left.columns.map((column) => column.name).filter((columnName) => rightNames.has(columnName))
      if (common.length === 0) throw new Error(t('dataCompare.noColumns'))
      const rightKeys = new Set(right.columns.filter((column) => column.primaryKey === true).map((column) => column.name))
      const sharedKeys = left.columns
        .filter((column) => column.primaryKey === true && rightKeys.has(column.name))
        .map((column) => column.name)
      const keyColumns = sharedKeys.length > 0 ? sharedKeys : common
      const statement = (table: string): string => {
        // A stable order keeps truncated reads comparable between both sides.
        const order = keyColumns.map((column) => quoteIdent(target.connection.dialect, column)).join(', ')
        return `SELECT * FROM ${qualifiedName(target.connection.dialect, target.schema, table)} ORDER BY ${order}`
      }
      const [leftRows, rightRows]: [QueryResult, QueryResult] = await Promise.all([
        api.query({ id: target.connection.id, sql: statement(target.table), maxRows: MAX_ROWS }),
        api.query({ id: target.connection.id, sql: statement(name), maxRows: MAX_ROWS }),
      ])
      setDiff(
        diffTableData({
          left: { columns: leftRows.columns, rows: leftRows.rows },
          right: { columns: rightRows.columns, rows: rightRows.rows },
          keyColumns: sharedKeys,
        }),
      )
      setTruncated(leftRows.truncated || rightRows.truncated)
    } catch (error) {
      setFailure(t('dataCompare.compareFailed', { error: errorText(error) }))
    } finally {
      setLoading(false)
    }
  }

  const keyLabel = useMemo(
    () => (diff === null ? '' : t('dataCompare.keyInfo', { columns: diff.keyColumns.join(', ') })),
    [diff, t],
  )

  if (target === null) return null

  const rowsTable = (
    rows: DataDiff['onlyLeft'],
    columns: DataDiff['columns'],
    kind: 'row' | 'change',
  ): ReactElement => (
    <table className="dshdb-designer-table">
      <thead>
        <tr>
          <th>{t('dataCompare.key')}</th>
          <th>{kind === 'change' ? t('dataCompare.change') : t('dataCompare.rowData')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, MAX_SHOWN).map((row, index) => (
          <tr key={index}>
            <td className="dshdb-mono">{row.key}</td>
            <td>
              {kind === 'change'
                ? row.changes
                    .map((change) => `${change.column}: ${change.left} → ${change.right}`)
                    .join(' · ')
                : columns
                    .map((column, position) => `${column}=${row.values[position] ?? ''}`)
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
      title={t('dataCompare.title')}
      width={900}
      onClose={onClose}
      footer={
        <>
          <span className="dshdb-muted">
            {diff === null
              ? t('dataCompare.hint')
              : diff.equal
                ? t('dataCompare.equal')
                : t('dataCompare.summary', {
                    removed: diff.onlyLeft.length,
                    added: diff.onlyRight.length,
                    changed: diff.changed.length,
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
            <span>{t('dataCompare.source')}</span>
            <span className="dshdb-mono">
              {target.schema}.{target.table}
            </span>
          </label>
          <label className="dshdb-designer-field">
            <span>{t('dataCompare.target')}</span>
            <Select
              aria-label={t('dataCompare.target')}
              value={otherName}
              disabled={loading || left === null}
              options={[
                { value: '', label: t('dataCompare.choose') },
                ...candidates.map((entry) => ({ value: entry.name, label: entry.name })),
              ]}
              onValueChange={(value) => void compare(value)}
            />
          </label>
        </div>
        {left !== null && candidates.length === 0 && !loading ? (
          <p className="dshdb-muted">{t('dataCompare.noTables')}</p>
        ) : null}
        {loading ? (
          <div className="dshdb-empty">
            <Loading size={16} label={t('dataCompare.loading')} />
          </div>
        ) : null}
        {truncated ? <Banner tone="warn">{t('dataCompare.truncated')}</Banner> : null}
        {diff !== null && (diff.leftDuplicates > 0 || diff.rightDuplicates > 0) ? (
          <Banner tone="warn">
            {t('dataCompare.duplicates', { left: diff.leftDuplicates, right: diff.rightDuplicates })}
          </Banner>
        ) : null}
        {diff !== null ? (
          diff.equal ? (
            <Banner tone="success">{t('dataCompare.equal')}</Banner>
          ) : (
            <>
              <p className="dshdb-muted">{keyLabel}</p>
              {diff.onlyLeft.length > 0 ? (
                <section className="dshdb-designer-section">
                  <div className="dshdb-designer-section-head">
                    <strong>
                      {t('dataCompare.onlyCurrent')} ({diff.onlyLeft.length})
                    </strong>
                  </div>
                  <div className="dshdb-designer-scroll">{rowsTable(diff.onlyLeft, diff.columns, 'row')}</div>
                </section>
              ) : null}
              {diff.onlyRight.length > 0 ? (
                <section className="dshdb-designer-section">
                  <div className="dshdb-designer-section-head">
                    <strong>
                      {t('dataCompare.onlyTarget')} ({diff.onlyRight.length})
                    </strong>
                  </div>
                  <div className="dshdb-designer-scroll">{rowsTable(diff.onlyRight, diff.columns, 'row')}</div>
                </section>
              ) : null}
              {diff.changed.length > 0 ? (
                <section className="dshdb-designer-section">
                  <div className="dshdb-designer-section-head">
                    <strong>
                      {t('dataCompare.changed')} ({diff.changed.length})
                    </strong>
                  </div>
                  <div className="dshdb-designer-scroll">{rowsTable(diff.changed, diff.columns, 'change')}</div>
                </section>
              ) : null}
            </>
          )
        ) : null}
      </div>
    </Modal>
  )
}