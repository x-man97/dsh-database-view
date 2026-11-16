/**
 * Table designer dialog (MySQL first): edit columns, primary key and indexes,
 * preview the generated CREATE/ALTER statement, then execute it. The dialog is
 * purely client-side; App executes the previewed SQL and refreshes the tree.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { ClientConnection, SchemaObject, TableDescription } from '../shared/types'
import { copyText } from './colmenu'
import { useCopyFlash } from './copyflash'
import { useI18n } from './i18n'
import { SqlHighlight } from './sqlhighlight'
import {
  alterTableStatements as alterMysqlTableStatements,
  createTableSql,
  tableDraftFromDescription,
  validateTableDraft,
  type TableColumnDraft,
  type TableDraft,
  type TableDraftIssue,
  type TableForeignKeyDraft,
  type TableIndexDraft,
} from './tableddl'
import { alterTableStatements as alterPgTableStatements, createTableStatements as createPgTableStatements } from './tableddl-pg'
import {
  alterSqliteTableStatements,
  createSqliteTableStatements,
  validateSqliteDraft,
} from './tableddl-sqlite'
import {
  alterMssqlTableStatements,
  createMssqlTableStatements,
  validateMssqlDraft,
} from './tableddl-mssql'
import {
  alterOracleTableStatements,
  createOracleTableStatements,
  validateOracleDraft,
} from './tableddl-oracle'
import { Banner, Button, Modal, Select, TextInput } from './ui'

export interface TableDesignerTarget {
  connection: ClientConnection
  schema: string
  /** Present when an existing table is being modified. */
  description?: TableDescription
  /** Tables in the same schema, offered as foreign-key targets. */
  tables?: SchemaObject[]
}

export interface TableDesignerProps {
  target: TableDesignerTarget | null
  onClose: () => void
  /** Execute the previewed statements; reject to keep the dialog open. */
  onExecute: (target: TableDesignerTarget, statements: string[], tableName: string) => Promise<void>
}

const MYSQL_TYPES = [
  'INT',
  'BIGINT',
  'SMALLINT',
  'TINYINT',
  'DECIMAL(10,2)',
  'FLOAT',
  'DOUBLE',
  'VARCHAR(255)',
  'CHAR(1)',
  'TEXT',
  'LONGTEXT',
  'DATE',
  'DATETIME',
  'TIMESTAMP',
  'TIME',
  'JSON',
  'BLOB',
  'LONGBLOB',
]

const POSTGRES_TYPES = [
  'integer',
  'bigint',
  'smallint',
  'numeric(10,2)',
  'real',
  'double precision',
  'varchar(255)',
  'char(1)',
  'text',
  'boolean',
  'date',
  'time',
  'timestamp',
  'timestamptz',
  'jsonb',
  'uuid',
  'bytea',
]

const SQLITE_TYPES = ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC', 'BOOLEAN', 'DATE', 'DATETIME']

const MSSQL_TYPES = [
  'int',
  'bigint',
  'smallint',
  'tinyint',
  'decimal(10,2)',
  'float',
  'real',
  'bit',
  'nvarchar(255)',
  'varchar(255)',
  'nchar(1)',
  'ntext',
  'date',
  'datetime2',
  'time',
  'uniqueidentifier',
  'varbinary(max)',
]

const ORACLE_TYPES = [
  'NUMBER',
  'NUMBER(10)',
  'NUMBER(10,2)',
  'FLOAT',
  'VARCHAR2(255)',
  'NVARCHAR2(255)',
  'CHAR(1)',
  'CLOB',
  'DATE',
  'TIMESTAMP',
  'BLOB',
  'RAW(16)',
]

function typeSuggestions(dialect: string | undefined): string[] {
  if (dialect === 'postgres') return POSTGRES_TYPES
  if (dialect === 'sqlite') return SQLITE_TYPES
  if (dialect === 'mssql') return MSSQL_TYPES
  if (dialect === 'oracle') return ORACLE_TYPES
  return MYSQL_TYPES
}

const ISSUE_KEYS: Record<TableDraftIssue, string> = {
  'table-name': 'designer.error.tableName',
  'no-columns': 'designer.error.noColumns',
  'column-name': 'designer.error.columnName',
  'duplicate-column': 'designer.error.duplicateColumn',
  'column-type': 'designer.error.columnType',
  'index-name': 'designer.error.indexName',
  'duplicate-index': 'designer.error.duplicateIndex',
  'index-columns': 'designer.error.indexColumns',
  'unknown-index-column': 'designer.error.unknownIndexColumn',
  'foreign-key-name': 'designer.error.foreignKeyName',
  'duplicate-foreign-key': 'designer.error.duplicateForeignKey',
  'foreign-key-columns': 'designer.error.foreignKeyColumns',
  'unknown-foreign-key-column': 'designer.error.unknownForeignKeyColumn',
  'foreign-key-target': 'designer.error.foreignKeyTarget',
  'auto-increment': 'designer.error.autoIncrement',
  'identity-change': 'designer.error.identityChange',
}

const FOREIGN_KEY_ACTIONS = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION', 'SET DEFAULT']

const DESTRUCTIVE = /\b(?:drop\s+(?:column|table|primary\s+key|index|constraint))\b/i

const AUTO_INCREMENT_TYPE: Record<string, string> = {
  sqlite: 'INTEGER',
  postgres: 'integer',
  mssql: 'int',
  oracle: 'NUMBER',
}

function initialColumns(dialect: string | undefined): TableColumnDraft[] {
  return [
    {
      name: 'id',
      typeName: AUTO_INCREMENT_TYPE[dialect ?? 'mysql'] ?? 'INT',
      nullable: false,
      defaultValue: '',
      comment: '',
      autoIncrement: true,
      primaryKey: true,
    },
  ]
}

function uniqueName(base: string, taken: string[]): string {
  const used = new Set(taken.map((name) => name.toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  let index = 2
  while (used.has(`${base}_${String(index)}`.toLowerCase())) index += 1
  return `${base}_${String(index)}`
}

export function TableDesigner({ target, onClose, onExecute }: TableDesignerProps): ReactElement | null {
  const t = useI18n()
  const [tableName, setTableName] = useState('')
  const [columns, setColumns] = useState<TableColumnDraft[]>(() => initialColumns(undefined))
  const [indexes, setIndexes] = useState<TableIndexDraft[]>([])
  const [foreignKeys, setForeignKeys] = useState<TableForeignKeyDraft[]>([])
  const [original, setOriginal] = useState<TableDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const flash = useCopyFlash()
  const nameRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (target === null) return
    flash.reset()
    setFailure(null)
    setBusy(false)
    if (target.description === undefined) {
      setOriginal(null)
      setTableName('')
      setColumns(initialColumns(target.connection.dialect))
      setIndexes([])
      setForeignKeys([])
      setTimeout(() => nameRef.current?.focus(), 0)
      return
    }
    const draft = tableDraftFromDescription(target.description)
    setOriginal(draft)
    setTableName(draft.table)
    setColumns(draft.columns.map((column) => ({ ...column })))
    setIndexes(draft.indexes.map((index) => ({ ...index, columns: [...index.columns] })))
    setForeignKeys(draft.foreignKeys.map((foreignKey) => ({ ...foreignKey, columns: [...foreignKey.columns], referencedColumns: [...foreignKey.referencedColumns] })))
  }, [target, flash.reset])

  const editing = original !== null
  const readOnly = target?.connection.readOnly === true
  const draft: TableDraft = useMemo(
    () => ({
      schema: target?.schema ?? '',
      table: tableName.trim(),
      columns,
      indexes,
      foreignKeys,
      ...(original?.primaryKeyName === undefined ? {} : { primaryKeyName: original.primaryKeyName }),
      ...(original?.preservedIndexes === undefined ? {} : { preservedIndexes: original.preservedIndexes }),
      ...(original?.preservedTriggers === undefined ? {} : { preservedTriggers: original.preservedTriggers }),
    }),
    [target?.schema, tableName, columns, indexes, foreignKeys, original],
  )
  const dialect = target?.connection.dialect
  const dialectIssue =
    target === null
      ? null
      : dialect === 'sqlite'
        ? validateSqliteDraft(draft)
        : dialect === 'mssql'
          ? validateMssqlDraft(original, draft)
          : dialect === 'oracle'
            ? validateOracleDraft(draft)
            : null
  const issue = target === null ? null : validateTableDraft(draft, !editing) ?? dialectIssue
  const statements =
    issue === null
      ? original === null
        ? dialect === 'postgres'
          ? createPgTableStatements(draft)
          : dialect === 'sqlite'
            ? createSqliteTableStatements(draft)
            : dialect === 'mssql'
              ? createMssqlTableStatements(draft)
              : dialect === 'oracle'
                ? createOracleTableStatements(draft)
                : [createTableSql(draft)]
        : dialect === 'postgres'
          ? alterPgTableStatements(original, draft)
          : dialect === 'sqlite'
            ? alterSqliteTableStatements(original, draft)
            : dialect === 'mssql'
              ? alterMssqlTableStatements(original, draft)
              : dialect === 'oracle'
                ? alterOracleTableStatements(original, draft)
                : alterMysqlTableStatements(original, draft)
      : []
  const previewSql = statements.join(';\n\n')

  if (target === null) return null

  const updateColumn = (index: number, patch: Partial<TableColumnDraft>): void => {
    const current = columns[index]
    if (current !== undefined && patch.name !== undefined && patch.name !== current.name) {
      const from = current.name.toLowerCase()
      const to = patch.name
      setIndexes((entries) =>
        entries.map((entry) => ({
          ...entry,
          columns: entry.columns.map((name) => (name.toLowerCase() === from ? to : name)),
        })),
      )
      setForeignKeys((entries) =>
        entries.map((entry) => ({
          ...entry,
          columns: entry.columns.map((name) => (name.toLowerCase() === from ? to : name)),
        })),
      )
    }
    setColumns((entries) => entries.map((column, position) => (position === index ? { ...column, ...patch } : column)))
  }

  const removeColumn = (index: number): void => {
    const removed = columns[index]
    if (removed === undefined) return
    const from = removed.name.toLowerCase()
    setColumns((current) => current.filter((_, position) => position !== index))
    setIndexes((entries) =>
      entries.map((entry) => ({ ...entry, columns: entry.columns.filter((name) => name.toLowerCase() !== from) })),
    )
    setForeignKeys((entries) =>
      entries.map((entry) => ({ ...entry, columns: entry.columns.filter((name) => name.toLowerCase() !== from) })),
    )
  }

  const addColumn = (): void => {
    const name = uniqueName(`column_${String(columns.length + 1)}`, columns.map((column) => column.name))
    setColumns((current) => [
      ...current,
      {
        name,
        typeName: 'VARCHAR(255)',
        nullable: true,
        defaultValue: '',
        comment: '',
        autoIncrement: false,
        primaryKey: false,
      },
    ])
  }

  const updateIndex = (index: number, patch: Partial<TableIndexDraft>): void => {
    setIndexes((current) => current.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)))
  }

  const addIndex = (): void => {
    const name = uniqueName(`idx_${String(indexes.length + 1)}`, indexes.map((index) => index.name))
    setIndexes((current) => [
      ...current,
      {
        name,
        unique: false,
        columns: columns[0] === undefined ? [] : [columns[0].name],
      },
    ])
  }

  const updateForeignKey = (index: number, patch: Partial<TableForeignKeyDraft>): void => {
    setForeignKeys((current) => current.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)))
  }

  const addForeignKey = (): void => {
    const name = uniqueName(`fk_${String(foreignKeys.length + 1)}`, foreignKeys.map((foreignKey) => foreignKey.name))
    setForeignKeys((current) => [
      ...current,
      {
        name,
        columns: columns[0] === undefined ? [] : [columns[0].name],
        referencedSchema: target.schema,
        referencedTable: '',
        referencedColumns: [],
        onDelete: 'RESTRICT',
        onUpdate: 'RESTRICT',
      },
    ])
  }

  const execute = async (): Promise<void> => {
    if (statements.length === 0 || readOnly || busy) return
    setBusy(true)
    setFailure(null)
    try {
      await onExecute(target, statements, tableName.trim())
      onClose()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const title = editing
    ? t('designer.titleEdit', { name: `${target.schema}.${target.description?.table ?? tableName}` })
    : t('designer.titleNew', { schema: target.schema })

  return (
    <Modal
      open
      title={title}
      width={980}
      onClose={onClose}
      footer={
        <>
          <span className="dshdb-muted">
            {issue !== null ? t(ISSUE_KEYS[issue]) : statements.length === 0 ? t('designer.noChanges') : editing ? t('designer.alterHint') : t('designer.createHint')}
          </span>
          <span className="dshdb-toolbar-spacer" />
          <Button
            size="sm"
            disabled={statements.length === 0}
            onClick={() => {
              void copyText(previewSql).then((ok) => flash.flash(ok))
            }}
          >
            {flash.copied ? t('designer.copied') : t('designer.copy')}
          </Button>
          <Button size="sm" onClick={onClose} disabled={busy}>
            {t('designer.cancel')}
          </Button>
          <Button size="sm" variant="primary" loading={busy} disabled={statements.length === 0 || readOnly} onClick={() => void execute()}>
            {t('designer.execute')}
          </Button>
        </>
      }
    >
      <div className="dshdb-designer">
        {readOnly ? <Banner tone="warn">{t('designer.readonly')}</Banner> : null}
        {failure !== null ? <Banner tone="error">{failure}</Banner> : null}

        <div className="dshdb-designer-identity">
          <label className="dshdb-designer-field">
            <span>{t('designer.schema')}</span>
            <TextInput value={target.schema} readOnly aria-label={t('designer.schema')} />
          </label>
          <label className="dshdb-designer-field">
            <span>{t('designer.tableName')}</span>
            <TextInput
              ref={nameRef}
              value={tableName}
              readOnly={editing}
              placeholder={t('designer.tableNamePlaceholder')}
              aria-label={t('designer.tableName')}
              onChange={(event) => setTableName(event.target.value)}
            />
          </label>
        </div>

        <section className="dshdb-designer-section">
          <div className="dshdb-designer-section-head">
            <strong>{t('designer.columns')}</strong>
            <Button size="sm" onClick={addColumn}>
              {t('designer.addColumn')}
            </Button>
          </div>
          <div className="dshdb-designer-scroll">
            <table className="dshdb-designer-table">
              <thead>
                <tr>
                  <th>{t('designer.column.name')}</th>
                  <th>{t('designer.column.type')}</th>
                  <th>{t('designer.column.nullable')}</th>
                  <th>{t('designer.column.default')}</th>
                  <th>{t('designer.column.comment')}</th>
                  <th>{t('designer.column.autoIncrement')}</th>
                  <th>{t('designer.column.primaryKey')}</th>
                  <th aria-label={t('designer.column.remove')} />
                </tr>
              </thead>
              <tbody>
                {columns.map((column, index) => (
                  <tr key={index}>
                    <td>
                      <TextInput
                        value={column.name}
                        aria-label={`${t('designer.column.name')} ${String(index + 1)}`}
                        onChange={(event) => updateColumn(index, { name: event.target.value })}
                      />
                    </td>
                    <td>
                      <TextInput
                        value={column.typeName}
                        list="dshdb-column-types"
                        aria-label={`${t('designer.column.type')} ${String(index + 1)}`}
                        onChange={(event) => updateColumn(index, { typeName: event.target.value })}
                      />
                    </td>
                    <td className="dshdb-designer-check">
                      <input
                        type="checkbox"
                        checked={column.nullable}
                        aria-label={`${t('designer.column.nullable')} ${String(index + 1)}`}
                        onChange={(event) => updateColumn(index, { nullable: event.target.checked })}
                      />
                    </td>
                    <td>
                      <TextInput
                        value={column.defaultValue}
                        placeholder="NULL / 'x' / 0"
                        aria-label={`${t('designer.column.default')} ${String(index + 1)}`}
                        onChange={(event) => updateColumn(index, { defaultValue: event.target.value })}
                      />
                    </td>
                    <td>
                      <TextInput
                        value={column.comment}
                        disabled={dialect === 'sqlite'}
                        title={dialect === 'sqlite' ? t('designer.commentUnsupported') : undefined}
                        aria-label={`${t('designer.column.comment')} ${String(index + 1)}`}
                        onChange={(event) => updateColumn(index, { comment: event.target.value })}
                      />
                    </td>
                    <td className="dshdb-designer-check">
                      <input
                        type="checkbox"
                        checked={column.autoIncrement}
                        aria-label={`${t('designer.column.autoIncrement')} ${String(index + 1)}`}
                        onChange={(event) => updateColumn(index, { autoIncrement: event.target.checked })}
                      />
                    </td>
                    <td className="dshdb-designer-check">
                      <input
                        type="checkbox"
                        checked={column.primaryKey}
                        aria-label={`${t('designer.column.primaryKey')} ${String(index + 1)}`}
                        onChange={(event) => updateColumn(index, { primaryKey: event.target.checked })}
                      />
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t('designer.column.remove')}
                        title={t('designer.column.remove')}
                        onClick={() => removeColumn(index)}
                      >
                        ×
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <datalist id="dshdb-column-types">
            {typeSuggestions(dialect).map((type) => (
              <option key={type} value={type} />
            ))}
          </datalist>
        </section>

        <section className="dshdb-designer-section">
          <div className="dshdb-designer-section-head">
            <strong>{t('designer.indexes')}</strong>
            <Button size="sm" onClick={addIndex}>
              {t('designer.addIndex')}
            </Button>
          </div>
          {indexes.length === 0 ? (
            <p className="dshdb-muted">{t('designer.noIndexes')}</p>
          ) : (
            <div className="dshdb-designer-scroll">
              <table className="dshdb-designer-table">
                <thead>
                  <tr>
                    <th>{t('designer.index.name')}</th>
                    <th>{t('designer.index.unique')}</th>
                    <th>{t('designer.index.columns')}</th>
                    <th aria-label={t('designer.index.remove')} />
                  </tr>
                </thead>
                <tbody>
                  {indexes.map((index, position) => (
                    <tr key={position}>
                      <td>
                        <TextInput
                          value={index.name}
                          aria-label={`${t('designer.index.name')} ${String(position + 1)}`}
                          onChange={(event) => updateIndex(position, { name: event.target.value })}
                        />
                      </td>
                      <td className="dshdb-designer-check">
                        <input
                          type="checkbox"
                          checked={index.unique}
                          aria-label={`${t('designer.index.unique')} ${String(position + 1)}`}
                          onChange={(event) => updateIndex(position, { unique: event.target.checked })}
                        />
                      </td>
                      <td>
                        <TextInput
                          value={index.columns.join(', ')}
                          aria-label={`${t('designer.index.columns')} ${String(position + 1)}`}
                          onChange={(event) =>
                            updateIndex(position, {
                              columns: event.target.value
                                .split(',')
                                .map((name) => name.trim())
                                .filter((name) => name !== ''),
                            })
                          }
                        />
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t('designer.index.remove')}
                          title={t('designer.index.remove')}
                          onClick={() => setIndexes((current) => current.filter((_, index) => index !== position))}
                        >
                          ×
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="dshdb-designer-section">
          <div className="dshdb-designer-section-head">
            <strong>{t('designer.foreignKeys')}</strong>
            <Button size="sm" onClick={addForeignKey}>
              {t('designer.addForeignKey')}
            </Button>
          </div>
          {foreignKeys.length === 0 ? (
            <p className="dshdb-muted">{t('designer.noForeignKeys')}</p>
          ) : (
            <div className="dshdb-designer-scroll">
              <table className="dshdb-designer-table">
                <thead>
                  <tr>
                    <th>{t('designer.fk.name')}</th>
                    <th>{t('designer.fk.columns')}</th>
                    <th>{t('designer.fk.refTable')}</th>
                    <th>{t('designer.fk.refColumns')}</th>
                    <th>{t('designer.fk.onDelete')}</th>
                    <th>{t('designer.fk.onUpdate')}</th>
                    <th aria-label={t('designer.fk.remove')} />
                  </tr>
                </thead>
                <tbody>
                  {foreignKeys.map((foreignKey, position) => (
                    <tr key={position}>
                      <td>
                        <TextInput
                          value={foreignKey.name}
                          aria-label={`${t('designer.fk.name')} ${String(position + 1)}`}
                          onChange={(event) => updateForeignKey(position, { name: event.target.value })}
                        />
                      </td>
                      <td>
                        <TextInput
                          value={foreignKey.columns.join(', ')}
                          aria-label={`${t('designer.fk.columns')} ${String(position + 1)}`}
                          onChange={(event) =>
                            updateForeignKey(position, {
                              columns: event.target.value
                                .split(',')
                                .map((name) => name.trim())
                                .filter((name) => name !== ''),
                            })
                          }
                        />
                      </td>
                      <td>
                        <TextInput
                          value={foreignKey.referencedTable}
                          list="dshdb-fk-ref-tables"
                          aria-label={`${t('designer.fk.refTable')} ${String(position + 1)}`}
                          onChange={(event) => updateForeignKey(position, { referencedTable: event.target.value })}
                        />
                      </td>
                      <td>
                        <TextInput
                          value={foreignKey.referencedColumns.join(', ')}
                          aria-label={`${t('designer.fk.refColumns')} ${String(position + 1)}`}
                          onChange={(event) =>
                            updateForeignKey(position, {
                              referencedColumns: event.target.value
                                .split(',')
                                .map((name) => name.trim())
                                .filter((name) => name !== ''),
                            })
                          }
                        />
                      </td>
                      <td>
                        <Select
                          aria-label={`${t('designer.fk.onDelete')} ${String(position + 1)}`}
                          value={foreignKey.onDelete}
                          options={FOREIGN_KEY_ACTIONS.map((action) => ({ value: action, label: action }))}
                          onValueChange={(value) => updateForeignKey(position, { onDelete: value })}
                        />
                      </td>
                      <td>
                        <Select
                          aria-label={`${t('designer.fk.onUpdate')} ${String(position + 1)}`}
                          value={foreignKey.onUpdate}
                          options={FOREIGN_KEY_ACTIONS.map((action) => ({ value: action, label: action }))}
                          onValueChange={(value) => updateForeignKey(position, { onUpdate: value })}
                        />
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t('designer.fk.remove')}
                          title={t('designer.fk.remove')}
                          onClick={() => setForeignKeys((current) => current.filter((_, index) => index !== position))}
                        >
                          ×
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <datalist id="dshdb-fk-ref-tables">
                {(target.tables ?? []).map((table) => (
                  <option key={table.name} value={table.name} />
                ))}
              </datalist>
            </div>
          )}
        </section>

        <section className="dshdb-designer-section">
          <div className="dshdb-designer-section-head">
            <strong>{t('designer.preview')}</strong>
            {statements.length > 0 ? <span className="dshdb-muted">{editing ? 'ALTER' : 'CREATE'}</span> : null}
          </div>
          {editing && DESTRUCTIVE.test(previewSql) ? <Banner tone="warn">{t('designer.destructive')}</Banner> : null}
          {statements.length === 0 ? (
            <pre className="dshdb-ddl dshdb-designer-preview" aria-label={t('designer.preview')}>
              {t('designer.noChanges')}
            </pre>
          ) : (
            <SqlHighlight
              sql={previewSql}
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
