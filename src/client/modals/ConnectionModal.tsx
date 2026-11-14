import { useEffect, useState, type ReactElement } from 'react'
import { PRESET_LABEL, PRESET_ORDER, PRESETS, presetOf } from '../../shared/presets'
import type { ClientConnection, ConnectionDraft, ConnectionTestResult, PresetId } from '../../shared/types'
import { api } from '../api'
import { copyText } from '../colmenu'
import { dialectLabel, formatMs } from '../format'
import { useI18n } from '../i18n'
import { DatabaseIcon, TrashIcon } from '../icons'
import { Banner, Button, Field, Loading, Modal, Select, Switch, TextInput } from '../ui'

export interface ConnectionModalProps {
  open: boolean
  editing: ClientConnection | null
  onClose: () => void
  onSaved: () => void
  onDelete: (connection: ClientConnection) => void
  notify: (text: string, tone?: 'info' | 'success' | 'error') => void
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const SQL_PRESETS = new Set<PresetId>(['mysql', 'mariadb', 'oracle', 'postgres', 'sqlite', 'mssql'])
const TLS_PRESETS = new Set<PresetId>(['mysql', 'mariadb', 'postgres', 'mssql'])
const SSH_PRESETS = new Set<PresetId>(['mysql', 'mariadb', 'oracle', 'postgres', 'mssql'])

export function ConnectionModal(props: ConnectionModalProps): ReactElement | null {
  const t = useI18n()
  const [choice, setChoice] = useState<PresetId>('mysql')
  const [name, setName] = useState('')
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('3306')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [clearPassword, setClearPassword] = useState(false)
  const [database, setDatabase] = useState('')
  const [redisDb, setRedisDb] = useState('0')
  const [readOnly, setReadOnly] = useState(false)
  const [sshEnabled, setSshEnabled] = useState(false)
  const [sshHost, setSshHost] = useState('')
  const [sshPort, setSshPort] = useState('22')
  const [sshUser, setSshUser] = useState('')
  const [sshAuth, setSshAuth] = useState<'password' | 'key' | 'agent'>('password')
  const [sshPassword, setSshPassword] = useState('')
  const [sshKeyPath, setSshKeyPath] = useState('')
  const [sshPassphrase, setSshPassphrase] = useState('')
  const [tlsEnabled, setTlsEnabled] = useState(false)
  const [tlsMode, setTlsMode] = useState<'verify-full' | 'verify-ca' | 'require'>('verify-full')
  const [tlsCaPath, setTlsCaPath] = useState('')
  const [tlsAllowInvalid, setTlsAllowInvalid] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)
  const [error, setError] = useState('')

  const editing = props.editing

  useEffect(() => {
    setError('')
    setTestResult(null)
    setSaving(false)
    setTesting(false)
    if (!props.open) return
    if (editing) {
      setChoice(editing.driver)
      setName(editing.name)
      setHost(editing.host)
      setPort(String(editing.port))
      setUser(editing.user)
      setDatabase(editing.database)
      setRedisDb(String(editing.redisDb))
      setReadOnly(editing.readOnly)
      setSshEnabled(editing.ssh !== undefined)
      setSshHost(editing.ssh?.host ?? '')
      setSshPort(String(editing.ssh?.port ?? 22))
      setSshUser(editing.ssh?.user ?? '')
      setSshAuth(editing.ssh?.auth ?? 'password')
      setSshKeyPath(editing.ssh?.privateKeyPath ?? '')
      setSshPassword('')
      setSshPassphrase('')
      setTlsEnabled(editing.tls !== undefined && editing.tls.mode !== 'disable')
      setTlsMode(editing.tls?.mode === 'verify-ca' || editing.tls?.mode === 'require' ? editing.tls.mode : 'verify-full')
      setTlsCaPath(editing.tls?.caPath ?? '')
      setTlsAllowInvalid(editing.tls?.allowInvalidHostname === true)
      setPassword('')
      setClearPassword(false)
      return
    }
    setChoice('mysql')
    setName('')
    setHost('127.0.0.1')
    setPort(String(PRESETS.mysql.defaultPort))
    setUser('')
    setDatabase('')
    setRedisDb('0')
    setReadOnly(false)
    setSshEnabled(false)
    setSshHost('')
    setSshPort('22')
    setSshUser('')
    setSshAuth('password')
    setSshKeyPath('')
    setSshPassword('')
    setSshPassphrase('')
    setTlsEnabled(false)
    setTlsMode('verify-full')
    setTlsCaPath('')
    setTlsAllowInvalid(false)
    setPassword('')
    setClearPassword(false)
  }, [props.open, editing])

  if (!props.open) return null

  const preset = presetOf(choice) ?? PRESETS.mysql
  const fileBased = preset.hostOptional === true
  const isRedis = choice === 'redis'
  const supportsTls = TLS_PRESETS.has(choice)
  const supportsSsh = SSH_PRESETS.has(choice)
  const driverLabel = isRedis
    ? '内置 Redis 客户端（ioredis）'
    : choice === 'sqlite'
      ? '内置 SQLite（Node.js node:sqlite）'
      : `内置 ${PRESET_LABEL[choice]} 驱动（driver pack 随插件打包）`

  const changeChoice = (value: string) => {
    const next = value as PresetId
    setChoice(next)
    setTestResult(null)
    setError('')
    const spec = presetOf(next)
    if (spec !== undefined) setPort(String(spec.defaultPort))
    if (!SSH_PRESETS.has(next)) setSshEnabled(false)
    if (!TLS_PRESETS.has(next)) {
      setTlsEnabled(false)
      setTlsAllowInvalid(false)
      setTlsCaPath('')
    }
  }

  const buildDraft = (): ConnectionDraft => ({
    id: editing?.id,
    name: name.trim(),
    driver: choice,
    // File based engines keep no host; do not persist whatever the previous preset left behind.
    host: fileBased ? '' : host.trim(),
    port: fileBased ? 0 : Number.parseInt(port, 10) || 0,
    user: user.trim(),
    ...(password !== '' ? { password } : {}),
    ...(clearPassword ? { clearPassword: true } : {}),
    database: isRedis ? '' : database.trim(),
    redisDb: Number.parseInt(redisDb, 10) || 0,
    // The read-only flag is chosen once, when the connection is created; an edit
    // always keeps the stored value (the switch is disabled for existing rows).
    readOnly: editing ? editing.readOnly : readOnly,
    ...(supportsSsh && sshEnabled
      ? {
          ssh: {
            enabled: true as const,
            host: sshHost.trim(),
            port: Number.parseInt(sshPort, 10) || 22,
            user: sshUser.trim(),
            auth: sshAuth,
            hostKeyPolicy: 'accept-new' as const,
            ...(sshKeyPath.trim() === '' ? {} : { privateKeyPath: sshKeyPath.trim() }),
          },
        }
      : {}),
    ...(supportsSsh && sshEnabled && sshPassword !== '' ? { sshPassword } : {}),
    ...(supportsSsh && sshEnabled && sshPassphrase !== '' ? { sshPassphrase } : {}),
    ...(supportsTls && tlsEnabled
      ? {
          tls: {
            mode: tlsMode,
            ...(tlsCaPath.trim() === '' ? {} : { caPath: tlsCaPath.trim() }),
            ...(tlsAllowInvalid ? { allowInvalidHostname: true } : {}),
          },
        }
      : {}),
  })

  const validate = (draft: ConnectionDraft): string => {
    if (draft.name === '') return '请填写连接名称'
    if (!fileBased && draft.host === '') return '请填写主机地址'
    if (!fileBased && (!Number.isInteger(draft.port) || draft.port < 1 || draft.port > 65535)) return '端口需在 1-65535 之间'
    if (fileBased && draft.database === '') return '请填写数据库文件路径'
    if (supportsSsh && sshEnabled) {
      if (draft.ssh?.host === undefined || draft.ssh.host === '') return '请填写 SSH 主机'
      if (!Number.isInteger(draft.ssh.port) || draft.ssh.port < 1 || draft.ssh.port > 65535) return 'SSH 端口需在 1-65535 之间'
      if (draft.ssh.user === '') return '请填写 SSH 用户名'
      if (draft.ssh.auth === 'key' && (draft.ssh.privateKeyPath === undefined || draft.ssh.privateKeyPath === '')) return '请填写 SSH 私钥路径'
      if (draft.ssh.auth === 'password' && sshPassword === '' && !editing?.hasSshPassword) return '请填写 SSH 密码'
    }
    return ''
  }

  const test = async () => {
    const draft = buildDraft()
    const problem = validate(draft)
    if (problem) {
      setError(problem)
      return
    }
    if (isRedis) {
      setError('Redis 连接请在保存后通过面板连接验证')
      return
    }
    setTesting(true)
    setError('')
    try {
      setTestResult(await api.testConnection({ ...draft, id: undefined }))
    } catch (cause) {
      setTestResult(null)
      setError(errorText(cause))
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    const draft = buildDraft()
    const problem = validate(draft)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError('')
    try {
      await api.saveConnection(draft)
      props.notify(editing ? '连接已更新' : '连接已创建', 'success')
      props.onSaved()
      props.onClose()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={props.open}
      title={
        <span className="dshdb-inline">
          <DatabaseIcon size={14} />
          {editing ? `${t('conn.editTitle')} · ${editing.name}` : t('conn.newTitle')}
        </span>
      }
      onClose={props.onClose}
      footer={
        <>
          {editing ? (
            <Button variant="danger" size="sm" icon={<TrashIcon size={12} />} onClick={() => props.onDelete(editing)}>
              删除
            </Button>
          ) : null}
          <div className="dshdb-modal-foot-spacer" />
          {!isRedis ? (
            <Button onClick={() => void test()} loading={testing}>
              测试连接
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            保存
          </Button>
        </>
      }
    >
      <div className="dshdb-form">
        <div className="dshdb-form-grid">
          <Field label={t('conn.name')} required span>
            <TextInput value={name} autoFocus placeholder="例如 本地 MySQL" onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label={t('conn.type')} required span hint={`方言：${dialectLabel(preset.dialect)}`}>
            <Select
              options={PRESET_ORDER.map((id) => ({ value: id, label: PRESET_LABEL[id] }))}
              value={choice}
              onValueChange={changeChoice}
            />
          </Field>
          {fileBased ? null : (
            <>
              <Field label={t('conn.host')} required>
                <TextInput value={host} onChange={(event) => setHost(event.target.value)} placeholder="127.0.0.1" />
              </Field>
              <Field label={t('conn.port')} required>
                <TextInput value={port} inputMode="numeric" onChange={(event) => setPort(event.target.value.replace(/[^0-9]/g, ''))} />
              </Field>
              <Field label={t('conn.user')}>
                <TextInput value={user} onChange={(event) => setUser(event.target.value)} placeholder={isRedis ? 'default' : '用户名'} />
              </Field>
              <Field label={t('conn.password')} hint={editing?.hasPassword ? '已保存密码，留空则保持不变' : undefined}>
                <TextInput
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={editing?.hasPassword ? '留空则保持不变' : '密码'}
                />
              </Field>
              {editing?.hasPassword ? (
                <div className="dshdb-span-2 dshdb-list">
                  <Switch checked={clearPassword} onChange={setClearPassword} label="清除已保存的密码" />
                </div>
              ) : null}
            </>
          )}
          {isRedis ? (
            <Field label={t('conn.redisDb')} hint="Redis 数据库编号，默认 0">
              <TextInput value={redisDb} inputMode="numeric" onChange={(event) => setRedisDb(event.target.value.replace(/[^0-9]/g, ''))} />
            </Field>
          ) : (
            <Field label={choice === 'sqlite' ? t('conn.sqliteFile') : t('conn.database')} span={fileBased} hint={preset.databaseHint}>
              <TextInput
                value={database}
                onChange={(event) => setDatabase(event.target.value)}
                placeholder={fileBased ? '例如 ./data/app.db' : '可留空'}
              />
            </Field>
          )}
          {supportsSsh ? (
            <div className="dshdb-span-2 dshdb-list">
              <Switch checked={sshEnabled} onChange={setSshEnabled} label={t('conn.ssh')} />
            </div>
          ) : null}
          {supportsSsh && sshEnabled ? (
            <>
              <Field label={t('conn.sshHost')} required>
                <TextInput value={sshHost} onChange={(event) => setSshHost(event.target.value)} placeholder="bastion.example.com" />
              </Field>
              <Field label={t('conn.sshPort')} required>
                <TextInput value={sshPort} inputMode="numeric" onChange={(event) => setSshPort(event.target.value.replace(/[^0-9]/g, ''))} />
              </Field>
              <Field label={t('conn.sshUser')} required>
                <TextInput value={sshUser} onChange={(event) => setSshUser(event.target.value)} placeholder="ops" />
              </Field>
              <Field label={t('conn.sshAuth')}>
                <Select
                  value={sshAuth}
                  options={[
                    { value: 'password', label: t('conn.authPassword') },
                    { value: 'key', label: t('conn.authKey') },
                    { value: 'agent', label: t('conn.authAgent') },
                  ]}
                  onValueChange={(value) => setSshAuth(value as 'password' | 'key' | 'agent')}
                />
              </Field>
              {sshAuth === 'password' ? (
                <Field label={t('conn.sshPassword')} hint={editing?.hasSshPassword ? '已保存，留空则保持不变' : undefined}>
                  <TextInput
                    type="password"
                    value={sshPassword}
                    autoComplete="new-password"
                    onChange={(event) => setSshPassword(event.target.value)}
                    placeholder={editing?.hasSshPassword ? '留空则保持不变' : 'SSH 密码'}
                  />
                </Field>
              ) : null}
              {sshAuth === 'key' ? (
                <>
                  <Field label={t('conn.privateKey')} required>
                    <TextInput value={sshKeyPath} onChange={(event) => setSshKeyPath(event.target.value)} placeholder="~/.ssh/id_ed25519" />
                  </Field>
                  <Field label={t('conn.passphrase')}>
                    <TextInput
                      type="password"
                      value={sshPassphrase}
                      autoComplete="new-password"
                      onChange={(event) => setSshPassphrase(event.target.value)}
                      placeholder="可选"
                    />
                  </Field>
                </>
              ) : null}
            </>
          ) : null}
          {supportsTls ? (
            <div className="dshdb-span-2 dshdb-list">
              <Switch checked={tlsEnabled} onChange={setTlsEnabled} label={t('conn.tls')} />
            </div>
          ) : null}
          {supportsTls && tlsEnabled ? (
            <>
              <Field label="TLS 校验模式">
                <Select
                  value={tlsMode}
                  options={[
                    { value: 'verify-full', label: t('conn.tlsVerifyFull') },
                    { value: 'verify-ca', label: t('conn.tlsVerifyCa') },
                    { value: 'require', label: t('conn.tlsRequire') },
                  ]}
                  onValueChange={(value) => setTlsMode(value as 'verify-full' | 'verify-ca' | 'require')}
                />
              </Field>
              <Field label={t('conn.caPath')} hint={t('conn.caHint')}>
                <TextInput value={tlsCaPath} onChange={(event) => setTlsCaPath(event.target.value)} placeholder="~/.dsh/certs/ca.pem" />
              </Field>
              <div className="dshdb-span-2 dshdb-list">
                <Switch checked={tlsAllowInvalid} onChange={setTlsAllowInvalid} label={t('conn.allowInvalid')} />
              </div>
            </>
          ) : null}
          <div className="dshdb-span-2 dshdb-list">
            <Switch
              checked={readOnly}
              onChange={setReadOnly}
              disabled={editing != null}
              label={
                editing == null
                  ? t('conn.readonly')
                  : t('conn.readonlyEdit')
              }
            />
          </div>
        </div>
        {testResult ? (
          <Banner tone={testResult.ok ? 'success' : 'error'}>
            {testResult.ok
              ? `连接成功 · ${testResult.server?.product ?? ''} ${testResult.server?.version ?? ''} · ${formatMs(testResult.latencyMs)}${testResult.note === undefined ? '' : ` · ${testResult.note}`}`
              : `连接失败：${testResult.message ?? '未知错误'}`}
          </Banner>
        ) : null}
        {error ? (
          <Banner
            tone="error"
            actions={
              <Button size="sm" variant="ghost" title="复制错误信息" onClick={() => void copyText(error)}>
                复制
              </Button>
            }
          >
            {error}
          </Banner>
        ) : null}
        {testing ? (
          <span className="dshdb-muted dshdb-inline" style={{ fontSize: 11 }}>
            <Loading label="正在测试连接…" />
          </span>
        ) : null}
        <span className="dshdb-muted" style={{ fontSize: 11 }}>
          引擎：{driverLabel}
        </span>
        {!editing ? null : (
          <span className="dshdb-muted" style={{ fontSize: 11 }}>
            连接 ID：{editing.id}
          </span>
        )}
      </div>
    </Modal>
  )
}
