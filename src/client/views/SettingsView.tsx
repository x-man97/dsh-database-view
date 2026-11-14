import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { DbSettings } from '../../shared/types'
import {
  SHORTCUTS,
  SHORTCUT_SCOPE_LABEL,
  bindingFromEvent,
  bindingOf,
  conflictingShortcut,
  formatBinding,
  shortcutDef,
  type ShortcutDef,
  type ShortcutScope,
} from '../../shared/keymap'
import { IS_MAC } from '../keymap'
import { useI18n } from '../i18n'
import { ArrowDownIcon, ArrowUpIcon } from '../icons'
import { CONSOLE_ACTION_LABEL, consoleActionIcon } from '../consoleactions'
import { orderConsoleActions, type ConsoleActionId } from '../../shared/consoleactions'
import { TOOLBAR_ACTION_LABEL, toolbarActionIcon } from '../toolbaractions'
import { orderToolbarActions, type ToolbarActionId } from '../../shared/toolbaractions'
import { Button, Field, Panel, Switch, TextInput } from '../ui'

/** Panel order: the editor first, then everything the user reaches with a mouse. */
const SHORTCUT_SCOPES: ShortcutScope[] = ['console', 'result', 'table', 'tree', 'redis']

function ShortcutRow(props: {
  def: ShortcutDef
  overrides: Record<string, string>
  onChange: (binding: string | null) => void
}): ReactElement {
  const { def, overrides, onChange } = props
  const t = useI18n()
  const [recording, setRecording] = useState(false)
  const [problem, setProblem] = useState('')
  const binding = bindingOf(def.id, overrides)

  /** Record the keypress itself; Esc leaves, Delete clears the override. */
  const capture = (event: KeyboardEvent<HTMLInputElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const field = event.currentTarget
    if (event.key === 'Escape' || event.key === 'Tab') {
      setRecording(false)
      field.blur()
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      setProblem('')
      setRecording(false)
      onChange(null)
      field.blur()
      return
    }
    const next = bindingFromEvent(event)
    if (next === null) {
      setProblem('要带 Ctrl/⌘ 或 Alt，功能键（F1–F12）可以单独用')
      return
    }
    const taken = conflictingShortcut(def.id, next, overrides)
    if (taken !== null) {
      setProblem(`与「${shortcutDef(taken).label}」冲突`)
      return
    }
    setProblem('')
    setRecording(false)
    onChange(next)
    field.blur()
  }

  return (
    <div className="dshdb-driver-row">
      <div className="dshdb-driver-main">
        <div className="dshdb-driver-name">{def.label}</div>
        {problem !== '' ? <div className="dshdb-field-error">{problem}</div> : null}
      </div>
      <TextInput
        readOnly
        style={{ width: 168, textAlign: 'center' }}
        aria-label={`${def.label} 的快捷键`}
        title="点一下再按新的组合键（Esc 取消，Delete 恢复默认）"
        value={recording ? '按下组合键…' : formatBinding(binding, IS_MAC)}
        onFocus={() => {
          setRecording(true)
          setProblem('')
        }}
        onBlur={() => setRecording(false)}
        onKeyDown={capture}
      />
      <Button size="sm" variant="ghost" disabled={overrides[def.id] === undefined} onClick={() => onChange(null)}>
        {t('settings.restore')}
      </Button>
    </div>
  )
}

export interface SettingsViewProps {
  settings: DbSettings
  saving: boolean
  onSave: (settings: DbSettings) => void
}

export function SettingsView(props: SettingsViewProps): ReactElement {
  const t = useI18n()
  const [draft, setDraft] = useState<DbSettings>(props.settings)

  useEffect(() => {
    setDraft(props.settings)
  }, [props.settings])

  const update = <K extends keyof DbSettings>(key: K, value: DbSettings[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }))
  }

  const updateNumber = (key: 'maxRows' | 'queryTimeoutSec' | 'connectTimeoutSec' | 'redisScanCount', value: string) => {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) update(key, parsed)
    else update(key, 1)
  }

  const keybindings = draft.keybindings ?? {}
  const actionOrder = orderConsoleActions(draft.consoleActions)
  /** Swap one step up or down; the header buttons are disabled at the ends. */
  const moveAction = (id: ConsoleActionId, offset: -1 | 1): void => {
    const index = actionOrder.indexOf(id)
    const target = index + offset
    if (index < 0 || target < 0 || target >= actionOrder.length) return
    const next = [...actionOrder]
    next.splice(index, 1)
    next.splice(target, 0, id)
    update('consoleActions', next)
  }
  const toolbarOrder = orderToolbarActions(draft.toolbarActions)
  const moveToolbarAction = (id: ToolbarActionId, offset: -1 | 1): void => {
    const index = toolbarOrder.indexOf(id)
    const target = index + offset
    if (index < 0 || target < 0 || target >= toolbarOrder.length) return
    const next = [...toolbarOrder]
    next.splice(index, 1)
    next.splice(target, 0, id)
    update('toolbarActions', next)
  }

  return (
    <div className="dshdb-scroll dshdb-scroll-thin" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Panel
        title={t('settings.querySecurity')}
        collapsible
        actions={
          <Button size="sm" variant="primary" loading={props.saving} onClick={() => props.onSave(draft)}>
            {t('settings.save')}
          </Button>
        }
        bodyClassName="dshdb-panel-body-pad"
      >
        <div className="dshdb-form">
          <div className="dshdb-form-grid">
            <Field label={t('settings.maxRows')} hint={t('settings.maxRowsHint')}>
              <TextInput
                type="number"
                min={1}
                max={10000}
                value={String(draft.maxRows)}
                onChange={(event) => updateNumber('maxRows', event.target.value)}
              />
            </Field>
            <Field label={t('settings.queryTimeout')}>
              <TextInput
                type="number"
                min={1}
                max={600}
                value={String(draft.queryTimeoutSec)}
                onChange={(event) => updateNumber('queryTimeoutSec', event.target.value)}
              />
            </Field>
            <Field label={t('settings.connectTimeout')}>
              <TextInput
                type="number"
                min={1}
                max={120}
                value={String(draft.connectTimeoutSec)}
                onChange={(event) => updateNumber('connectTimeoutSec', event.target.value)}
              />
            </Field>
            <Field label={t('settings.redisScan')}>
              <TextInput
                type="number"
                min={10}
                max={2000}
                value={String(draft.redisScanCount)}
                onChange={(event) => updateNumber('redisScanCount', event.target.value)}
              />
            </Field>
          </div>
          <div className="dshdb-list">
            <Switch
              checked={draft.allowAgentWrites}
              onChange={(checked) => update('allowAgentWrites', checked)}
              label={t('settings.agentWrites')}
            />
            <Switch
              checked={draft.confirmDestructive}
              onChange={(checked) => update('confirmDestructive', checked)}
              label={t('settings.confirmDestructive')}
            />
          </div>
        </div>
      </Panel>

      <Panel
        title={t('settings.shortcuts')}
        collapsible
        defaultOpen={false}
        actions={
          <div className="dshdb-inline">
            <Button size="sm" variant="ghost" onClick={() => update('keybindings', {})}>
              {t('settings.restore')}
            </Button>
            <Button size="sm" variant="primary" loading={props.saving} onClick={() => props.onSave(draft)}>
              {t('settings.save')}
            </Button>
          </div>
        }
        bodyClassName="dshdb-panel-body-pad"
      >
        <div className="dshdb-muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
          点一下组合键框，再按下新的组合键即可（Esc 取消，Delete 恢复这一项的默认）。组合键要带 Ctrl/⌘ 或 Alt，功能键可以单独用；同一区域里不能重复，改完点「保存」。
        </div>
        {SHORTCUT_SCOPES.map((scope) => (
          <div key={scope} style={{ marginTop: 8 }}>
            <div className="dshdb-qfilter-label">{SHORTCUT_SCOPE_LABEL[scope]}</div>
            <div className="dshdb-list">
              {SHORTCUTS.filter((def) => def.scope === scope).map((def) => (
                <ShortcutRow
                  key={def.id}
                  def={def}
                  overrides={keybindings}
                  onChange={(binding) => {
                    const next = { ...keybindings }
                    if (binding === null) delete next[def.id]
                    else next[def.id] = binding
                    update('keybindings', next)
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </Panel>

      <Panel
        title={t('settings.toolbar')}
        collapsible
        defaultOpen={false}
        actions={
          <div className="dshdb-inline">
            <Button size="sm" variant="ghost" onClick={() => update('toolbarActions', [])}>
              {t('settings.restore')}
            </Button>
            <Button size="sm" variant="primary" loading={props.saving} onClick={() => props.onSave(draft)}>
              {t('settings.save')}
            </Button>
          </div>
        }
        bodyClassName="dshdb-panel-body-pad"
      >
        <div className="dshdb-muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
          数据源工具栏按钮的左右顺序；窗口太窄放不下时，末尾的按钮会收进「⋯」菜单。
        </div>
        <div className="dshdb-list">
          {toolbarOrder.map((id, index) => (
            <div className="dshdb-action-row" key={id}>
              <span className="dshdb-action-icon">{toolbarActionIcon(id, 13)}</span>
              <div className="dshdb-driver-main">
                <div className="dshdb-driver-name">{TOOLBAR_ACTION_LABEL[id]}</div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon={<ArrowUpIcon size={12} />}
                aria-label={`上移 ${TOOLBAR_ACTION_LABEL[id]}`}
                title="上移"
                disabled={index === 0}
                onClick={() => moveToolbarAction(id, -1)}
              />
              <Button
                size="sm"
                variant="ghost"
                icon={<ArrowDownIcon size={12} />}
                aria-label={`下移 ${TOOLBAR_ACTION_LABEL[id]}`}
                title="下移"
                disabled={index === toolbarOrder.length - 1}
                onClick={() => moveToolbarAction(id, 1)}
              />
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title={t('settings.console')}
        collapsible
        defaultOpen={false}
        actions={
          <Button size="sm" variant="primary" loading={props.saving} onClick={() => props.onSave(draft)}>
            {t('settings.save')}
          </Button>
        }
        bodyClassName="dshdb-panel-body-pad"
      >
        <div className="dshdb-list">
          <Switch
            checked={draft.consoleAutoComplete !== false}
            onChange={(checked) => update('consoleAutoComplete', checked)}
            label="输入字符后自动展开补全列表"
          />
        </div>
        <div className="dshdb-muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
          默认开启。关闭后仍可按补全快捷键手动展开表名、列名建议。
        </div>
      </Panel>

      <Panel
        title={t('settings.consoleToolbar')}
        collapsible
        defaultOpen={false}
        actions={
          <div className="dshdb-inline">
            <Button size="sm" variant="ghost" onClick={() => update('consoleActions', [])}>
              {t('settings.restore')}
            </Button>
            <Button size="sm" variant="primary" loading={props.saving} onClick={() => props.onSave(draft)}>
              {t('settings.save')}
            </Button>
          </div>
        }
        bodyClassName="dshdb-panel-body-pad"
      >
        <div className="dshdb-muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
          控制台工具栏按钮的左右顺序；窗口太窄放不下时，末尾的按钮会收进「⋯」菜单。
        </div>
        <div className="dshdb-list">
          {actionOrder.map((id, index) => (
            <div className="dshdb-action-row" key={id}>
              <span className="dshdb-action-icon">{consoleActionIcon(id, 13)}</span>
              <div className="dshdb-driver-main">
                <div className="dshdb-driver-name">{CONSOLE_ACTION_LABEL[id]}</div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon={<ArrowUpIcon size={12} />}
                aria-label={`上移 ${CONSOLE_ACTION_LABEL[id]}`}
                title="上移"
                disabled={index === 0}
                onClick={() => moveAction(id, -1)}
              />
              <Button
                size="sm"
                variant="ghost"
                icon={<ArrowDownIcon size={12} />}
                aria-label={`下移 ${CONSOLE_ACTION_LABEL[id]}`}
                title="下移"
                disabled={index === actionOrder.length - 1}
                onClick={() => moveAction(id, 1)}
              />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
