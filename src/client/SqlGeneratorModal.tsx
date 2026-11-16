/**
 * SQL Generator dialog: choose a schema and objects, generate one DDL script
 * and copy, download or open it in a console.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { ClientConnection, SchemaInfo, SchemaObject } from '../shared/types'
import { api } from './api'
import { copyText } from './colmenu'
import { useCopyFlash } from './copyflash'
import { downloadText } from './export'
import { useI18n } from './i18n'
import { composeScript, generateObjectDdl, type GeneratedEntry } from './sqlgenerator'
import { Banner, Button, Loading, Modal, Select } from './ui'

export interface SqlGeneratorTarget {
  connection: ClientConnection
  schema?: string
  /** Preselect a single object; otherwise every table is preselected. */
  object?: SchemaObject
}

export interface SqlGeneratorModalProps {
  target: SqlGeneratorTarget | null
  onClose: () => void
  onOpenConsole?: (connectionId: string, schema: string, sql: string) => void
}

function objectKey(object: SchemaObject): string {
  return `${object.kind}:${object.name}`
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function SqlGeneratorModal({ target, onClose, onOpenConsole }: SqlGeneratorModalProps): ReactElement | null {
  const t = useI18n()
  const [schemas, setSchemas] = useState<SchemaInfo[]>([])
  const [schema, setSchema] = useState('')
  const [objects, setObjects] = useState<SchemaObject[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [includeViews, setIncludeViews] = useState(false)
  const [includeDrop, setIncludeDrop] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [generated, setGenerated] = useState(0)
  const flash = useCopyFlash()
  const runRef = useRef(0)

  useEffect(() => {
    if (target === null) return undefined
    let alive = true
    runRef.current += 1
    setSchemas([])
    setSchema('')
    setObjects([])
    setSelected(new Set())
    setIncludeViews(target.object?.kind === 'view')
    setPreview('')
    setFailure(null)
    setGenerated(0)
    flash.reset()
    setLoading(true)
    void (async () => {
      try {
        const result = await api.schemas(target.connection.id)
        if (!alive) return
        const list = result.schemas
        setSchemas(list)
        setSchema(target.schema !== undefined && target.schema !== '' ? target.schema : (list[0]?.name ?? ''))
      } catch (error) {
        if (alive) setFailure(t('sqlgen.failed', { error: errorText(error) }))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [target, flash.reset, t])

  useEffect(() => {
    if (target === null || schema === '') return undefined
    let alive = true
    setObjects([])
    setSelected(new Set())
    setPreview('')
    setFailure(null)
    setGenerated(0)
    setLoading(true)
    void (async () => {
      try {
        const result = await api.objects(target.connection.id, schema)
        if (!alive) return
        const listed = result.objects.filter((object) => object.kind === 'table' || object.kind === 'view')
        setObjects(listed)
        const preferred = target.object
        const keys = preferred === undefined
          ? listed.filter((object) => object.kind === 'table').map(objectKey)
          : listed.filter((object) => object.name === preferred.name && object.kind === preferred.kind).map(objectKey)
        setSelected(new Set(keys))
      } catch (error) {
        if (alive) setFailure(t('sqlgen.failed', { error: errorText(error) }))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [target, schema, t])

  if (target === null) return null

  const visibleObjects = objects.filter((object) => object.kind === 'table' || includeViews)
  const chosen = visibleObjects.filter((object) => selected.has(objectKey(object)))

  const toggle = (object: SchemaObject): void => {
    const key = objectKey(object)
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const generate = async (): Promise<void> => {
    if (busy || chosen.length === 0) {
      if (chosen.length === 0) setFailure(t('sqlgen.empty'))
      return
    }
    const run = runRef.current + 1
    runRef.current = run
    setBusy(true)
    setFailure(null)
    const entries: GeneratedEntry[] = []
    const errors: string[] = []
    try {
      for (const object of chosen) {
        try {
          const ddl = await generateObjectDdl(target.connection, schema, object)
          entries.push({ schema, object, ddl })
        } catch (error) {
          errors.push(`${object.name}: ${errorText(error)}`)
        }
        if (run !== runRef.current) return
      }
      setPreview(composeScript(target.connection.dialect, entries, includeDrop))
      setGenerated(entries.length)
      if (errors.length > 0) setFailure(t('sqlgen.partial', { count: String(errors.length), errors: errors.join('; ') }))
    } finally {
      if (run === runRef.current) setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={t('sqlgen.title')}
      width={940}
      onClose={onClose}
      footer={
        <>
          <span className="dshdb-muted">
            {failure !== null && generated === 0
              ? t('sqlgen.hint')
              : preview === ''
                ? t('sqlgen.hint')
                : t('sqlgen.generated', { count: String(generated) })}
          </span>
          <span className="dshdb-toolbar-spacer" />
          <Button
            size="sm"
            disabled={preview === ''}
            onClick={() => {
              void copyText(preview).then((ok) => flash.flash(ok))
            }}
          >
            {flash.copied ? t('designer.copied') : t('sqlgen.copy')}
          </Button>
          <Button
            size="sm"
            disabled={preview === ''}
            onClick={() => {
              downloadText(`${schema === '' ? 'schema' : schema}.sql`, 'application/sql', preview)
            }}
          >
            {t('sqlgen.save')}
          </Button>
          <Button
            size="sm"
            disabled={preview === '' || onOpenConsole === undefined}
            onClick={() => {
              if (onOpenConsole !== undefined) onOpenConsole(target.connection.id, schema, preview)
              onClose()
            }}
          >
            {t('sqlgen.openConsole')}
          </Button>
          <Button size="sm" onClick={onClose} disabled={busy}>
            {t('designer.cancel')}
          </Button>
          <Button size="sm" variant="primary" loading={busy} disabled={busy || chosen.length === 0} onClick={() => void generate()}>
            {t('sqlgen.generate')}
          </Button>
        </>
      }
    >
      <div className="dshdb-designer">
        {failure !== null ? <Banner tone="error">{failure}</Banner> : null}
        <div className="dshdb-designer-identity">
          <label className="dshdb-designer-field">
            <span>{t('sqlgen.schema')}</span>
            <Select
              aria-label={t('sqlgen.schema')}
              value={schema}
              options={schemas.map((entry) => ({ value: entry.name, label: entry.name }))}
              onValueChange={(value) => setSchema(value)}
            />
          </label>
          <div className="dshdb-designer-field">
            <span>{t('sqlgen.options')}</span>
            <div className="dshdb-sqlgen-options">
              <label>
                <input type="checkbox" checked={includeViews} onChange={(event) => setIncludeViews(event.target.checked)} />
                {t('sqlgen.includeViews')}
              </label>
              <label>
                <input type="checkbox" checked={includeDrop} onChange={(event) => setIncludeDrop(event.target.checked)} />
                {t('sqlgen.includeDrop')}
              </label>
            </div>
          </div>
        </div>

        <section className="dshdb-designer-section">
          <div className="dshdb-designer-section-head">
            <strong>{t('sqlgen.objects')}</strong>
            <Button
              size="sm"
              onClick={() => setSelected(new Set(visibleObjects.map(objectKey)))}
            >
              {t('sqlgen.selectAll')}
            </Button>
            <Button size="sm" onClick={() => setSelected(new Set())}>
              {t('sqlgen.selectNone')}
            </Button>
          </div>
          {loading ? (
            <div className="dshdb-empty">
              <Loading size={16} label={t('sqlgen.loading')} />
            </div>
          ) : visibleObjects.length === 0 ? (
            <p className="dshdb-muted">{t('sqlgen.noObjects')}</p>
          ) : (
            <div className="dshdb-sqlgen-objects">
              {visibleObjects.map((object) => (
                <label key={objectKey(object)} className="dshdb-sqlgen-object">
                  <input
                    type="checkbox"
                    checked={selected.has(objectKey(object))}
                    onChange={() => toggle(object)}
                  />
                  <span className="dshdb-mono">{object.name}</span>
                  <span className="dshdb-muted">{object.kind === 'view' ? t('tree.view') : t('tree.table')}</span>
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="dshdb-designer-section">
          <div className="dshdb-designer-section-head">
            <strong>{t('sqlgen.preview')}</strong>
            {preview !== '' ? <span className="dshdb-muted">{`${String(preview.split('\n').length)} lines`}</span> : null}
          </div>
          <pre className="dshdb-ddl dshdb-designer-preview" aria-label={t('sqlgen.preview')}>
            {preview === '' ? t('sqlgen.emptyPreview') : preview}
          </pre>
        </section>
      </div>
    </Modal>
  )
}