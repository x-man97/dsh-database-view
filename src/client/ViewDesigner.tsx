/**
 * View designer: create a view from a query or edit the SELECT behind an
 * existing MySQL view. The dialog previews the DDL and App executes it.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { ClientConnection } from '../shared/types'
import { copyText } from './colmenu'
import { useCopyFlash } from './copyflash'
import { useI18n } from './i18n'
import { SqlBodyEditor } from './SqlBodyEditor'
import { SqlHighlight } from './sqlhighlight'
import { createViewStatements, validateViewDraft, type ViewDraftIssue } from './viewddl'
import { Banner, Button, Modal, TextInput } from './ui'

export interface ViewDesignerTarget {
  connection: ClientConnection
  schema: string
  /** Present when an existing view is being edited. */
  view?: string
  /** SELECT body extracted from the server definition. */
  body?: string
}

export interface ViewDesignerProps {
  target: ViewDesignerTarget | null
  onClose: () => void
  onExecute: (target: ViewDesignerTarget, statements: string[], name: string) => Promise<void>
}

const ISSUE_KEYS: Record<ViewDraftIssue, string> = {
  name: 'view.error.name',
  body: 'view.error.body',
  'not-select': 'view.error.notSelect',
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function ViewDesigner({ target, onClose, onExecute }: ViewDesignerProps): ReactElement | null {
  const t = useI18n()
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const flash = useCopyFlash()
  const nameRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (target === null) return
    flash.reset()
    setFailure(null)
    setBusy(false)
    setName(target.view ?? '')
    setBody(target.body ?? '')
    if (target.view === undefined) setTimeout(() => nameRef.current?.focus(), 0)
  }, [target, flash.reset])

  const editing = target?.view !== undefined
  const readOnly = target?.connection.readOnly === true
  const issue = target === null ? null : validateViewDraft(name, body, !editing)
  const statements = issue === null && target !== null
    ? createViewStatements(target.schema, name, body, editing, target.connection.dialect)
    : []
  const sql = statements.join(';\n\n')

  if (target === null) return null

  const execute = async (): Promise<void> => {
    if (statements.length === 0 || readOnly || busy) return
    setBusy(true)
    setFailure(null)
    try {
      await onExecute(target, statements, name.trim())
      onClose()
    } catch (error) {
      setFailure(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  const title = editing
    ? t('view.titleEdit', { name: `${target.schema}.${target.view ?? ''}` })
    : t('view.titleNew', { schema: target.schema })

  return (
    <Modal
      open
      title={title}
      width={860}
      onClose={onClose}
      footer={
        <>
          <span className="dshdb-muted">
            {issue !== null ? t(ISSUE_KEYS[issue]) : editing ? t('view.replaceHint') : t('view.bodyHint')}
          </span>
          <span className="dshdb-toolbar-spacer" />
          <Button
            size="sm"
            disabled={statements.length === 0}
            onClick={() => {
              void copyText(sql).then((ok) => flash.flash(ok))
            }}
          >
            {flash.copied ? t('designer.copied') : t('designer.copy')}
          </Button>
          <Button size="sm" onClick={onClose} disabled={busy}>
            {t('designer.cancel')}
          </Button>
          <Button size="sm" variant="primary" loading={busy} disabled={statements.length === 0 || readOnly} onClick={() => void execute()}>
            {editing ? t('view.save') : t('view.create')}
          </Button>
        </>
      }
    >
      <div className="dshdb-designer">
        {readOnly ? <Banner tone="warn">{t('view.readonly')}</Banner> : null}
        {failure !== null ? <Banner tone="error">{failure}</Banner> : null}
        <label className="dshdb-designer-field">
          <span>{t('view.name')}</span>
          <TextInput
            ref={nameRef}
            value={name}
            readOnly={editing}
            aria-label={t('view.name')}
            placeholder={t('view.namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="dshdb-designer-field">
          <span>{t('view.body')}</span>
          <SqlBodyEditor
            value={body}
            onChange={setBody}
            ariaLabel={t('view.body')}
            placeholder={t('view.placeholder')}
            connectionId={target.connection.id}
            schema={target.schema}
            dialect={target.connection.dialect}
          />
        </div>
        <section className="dshdb-designer-section">
          <div className="dshdb-designer-section-head">
            <strong>{t('designer.preview')}</strong>
            {sql !== '' ? <span className="dshdb-muted">{editing ? 'OR REPLACE' : 'CREATE'}</span> : null}
          </div>
          {sql === '' ? (
            <pre className="dshdb-ddl dshdb-designer-preview" aria-label={t('designer.preview')}>
              {t('designer.noChanges')}
            </pre>
          ) : (
            <SqlHighlight
              sql={sql}
              className="dshdb-ddl dshdb-designer-preview"
              ariaLabel={t('designer.preview')}
              trailingNewline={false}
            />
          )}
        </section>
      </div>
    </Modal>
  )
}