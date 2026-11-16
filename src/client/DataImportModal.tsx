/**
 * Import CSV/TSV rows into one table: pick a file, tune delimiter/header and
 * column mapping, preview, then execute the generated batched INSERTs.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { ClientConnection, ColumnDetail, SqlDialect } from '../shared/types'
import { api } from './api'
import {
  DELIMITERS,
  autoMapColumns,
  buildInsertBatches,
  detectDelimiter,
  guessHeader,
  importRowCount,
  parseDelimited,
  validateMapping,
  type Delimiter,
  type ImportMapping,
} from './dataimport'
import { formatCount } from './format'
import { useI18n } from './i18n'
import { Banner, Button, Modal, Select } from './ui'

export interface DataImportTarget {
  connection: ClientConnection
  schema: string
  table: string
  columns: ColumnDetail[]
}

export interface DataImportModalProps {
  target: DataImportTarget | null
  onClose: () => void
  onImported: (count: number) => void
}

const PREVIEW_ROWS = 5

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function DataImportModal({ target, onClose, onImported }: DataImportModalProps): ReactElement | null {
  const t = useI18n()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [fileName, setFileName] = useState('')
  const [text, setText] = useState('')
  const [delimiter, setDelimiter] = useState<Delimiter>(',')
  const [hasHeader, setHasHeader] = useState(true)
  const [mapping, setMapping] = useState<ImportMapping>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    setFileName('')
    setText('')
    setDelimiter(',')
    setHasHeader(true)
    setMapping([])
    setBusy(false)
    setProgress(null)
    setFailure(null)
  }, [target])

  const rows = useMemo(() => (text === '' ? [] : parseDelimited(text, delimiter)), [text, delimiter])
  const width = useMemo(() => rows.reduce((max, row) => Math.max(max, row.length), 0), [rows])
  const headerRow = hasHeader ? (rows[0] ?? []) : []
  const sourceLabels = Array.from({ length: width }, (_, index) => {
    const header = headerRow[index]?.trim() ?? ''
    return header !== '' ? header : t('import.sourceColumn', { n: index + 1 })
  })

  useEffect(() => {
    if (target === null || rows.length === 0) return
    const header = hasHeader ? (rows[0] ?? []) : []
    const labels = Array.from({ length: width }, (_, index) => header[index]?.trim() ?? '')
    setMapping(autoMapColumns(labels, target.columns, hasHeader))
  }, [rows, hasHeader, target, width])

  if (target === null) return null

  const readOnly = target.connection.readOnly === true
  const dataRows = importRowCount(rows, hasHeader)
  const issue = mapping.length === 0 ? 'no-target' : validateMapping(mapping, target.columns)
  const mappedCount = mapping.filter((name) => name !== null && name !== '').length
  const canImport = !busy && !readOnly && text !== '' && dataRows > 0 && issue === null

  const pickFile = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return
    setFailure(null)
    try {
      const content = await file.text()
      setFileName(file.name)
      setText(content)
      const detected = detectDelimiter(content)
      setDelimiter(detected)
      const parsed = parseDelimited(content, detected)
      setHasHeader(guessHeader(parsed, target.columns))
    } catch (error) {
      setFailure(t('import.fileError', { error: errorText(error) }))
    }
  }

  const issueText =
    issue === null
      ? ''
      : issue === 'no-target'
        ? t('import.error.noTarget')
        : issue === 'duplicate-target'
          ? t('import.error.duplicateTarget')
          : t('import.error.unknownTarget')

  const runImport = async (): Promise<void> => {
    if (!canImport) return
    const batches = buildInsertBatches({
      dialect: target.connection.dialect as SqlDialect,
      schema: target.schema,
      table: target.table,
      columns: target.columns,
      mapping,
      rows,
      hasHeader,
    })
    if (batches.length === 0) {
      setFailure(t('import.error.noRows'))
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
          throw new Error(
            `${t('import.error.batch', { n: index + 1 })} ${errorText(error)}`,
          )
        }
        setProgress({ done: index + 1, total: batches.length })
      }
      onImported(dataRows)
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
      title={t('import.title', { name: `${target.schema}.${target.table}` })}
      width={900}
      onClose={onClose}
      footer={
        <>
          <span className="dshdb-muted">
            {progress !== null && busy
              ? t('import.progress', { done: progress.done, total: progress.total })
              : hasHeader
                ? t('import.hintHeader', { n: formatCount(dataRows) })
                : t('import.hintNoHeader', { n: formatCount(dataRows) })}
          </span>
          <span className="dshdb-toolbar-spacer" />
          <Button size="sm" onClick={onClose} disabled={busy}>
            {t('designer.cancel')}
          </Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!canImport} onClick={() => void runImport()}>
            {t('import.import')}
          </Button>
        </>
      }
    >
      <div className="dshdb-designer">
        {readOnly ? <Banner tone="warn">{t('import.readonly')}</Banner> : null}
        {failure !== null ? <Banner tone="error">{failure}</Banner> : null}
        <div className="dshdb-designer-identity">
          <label className="dshdb-designer-field">
            <span>{t('import.file')}</span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              style={{ display: 'none' }}
              aria-label={t('import.file')}
              onChange={(event) => void pickFile(event.target.files?.[0])}
            />
            <span className="dshdb-import-file">
              <Button size="sm" onClick={() => fileRef.current?.click()}>
                {t('import.chooseFile')}
              </Button>
              <span className="dshdb-muted">{fileName === '' ? t('import.noFile') : fileName}</span>
            </span>
          </label>
          <label className="dshdb-designer-field">
            <span>{t('import.delimiter')}</span>
            <Select
              aria-label={t('import.delimiter')}
              value={delimiter}
              options={DELIMITERS.map((entry) => ({
                value: entry.value,
                label:
                  entry.value === ','
                    ? t('import.delimiterComma')
                    : entry.value === '\t'
                      ? t('import.delimiterTab')
                      : entry.value === ';'
                        ? t('import.delimiterSemicolon')
                        : t('import.delimiterPipe'),
              }))}
              onValueChange={(value) => setDelimiter(value as Delimiter)}
            />
          </label>
          <label className="dshdb-designer-field">
            <span>{t('import.header')}</span>
            <input
              type="checkbox"
              checked={hasHeader}
              aria-label={t('import.header')}
              onChange={(event) => setHasHeader(event.target.checked)}
            />
          </label>
        </div>

        {text === '' ? (
          <p className="dshdb-muted">{t('import.chooseHint')}</p>
        ) : (
          <>
            <section className="dshdb-designer-section">
              <div className="dshdb-designer-section-head">
                <strong>{t('import.mapping')}</strong>
                <span className="dshdb-muted">{t('import.mapped', { n: mappedCount })}</span>
              </div>
              <div className="dshdb-designer-scroll">
                <table className="dshdb-designer-table">
                  <thead>
                    <tr>
                      <th>{t('import.source')}</th>
                      <th>{t('import.target')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceLabels.map((label, index) => (
                      <tr key={index}>
                        <td>{label}</td>
                        <td>
                          <Select
                            aria-label={`${t('import.target')} ${label}`}
                            value={mapping[index] ?? ''}
                            options={[
                              { value: '', label: t('import.skip') },
                              ...target.columns.map((column) => ({
                                value: column.name,
                                label: `${column.name} · ${column.typeName}`,
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
              {issueText !== '' ? <Banner tone="warn">{issueText}</Banner> : null}
            </section>

            <section className="dshdb-designer-section">
              <div className="dshdb-designer-section-head">
                <strong>{t('import.preview')}</strong>
                <span className="dshdb-muted">{t('import.previewHint')}</span>
              </div>
              <div className="dshdb-designer-scroll">
                <table className="dshdb-designer-table">
                  <thead>
                    <tr>
                      {sourceLabels.map((label, index) => (
                        <th key={index}>{mapping[index] ?? label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(hasHeader ? 1 : 0, (hasHeader ? 1 : 0) + PREVIEW_ROWS).map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {sourceLabels.map((_, columnIndex) => (
                          <td key={columnIndex} title={row[columnIndex] ?? ''}>
                            {row[columnIndex] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </Modal>
  )
}
