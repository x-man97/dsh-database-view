import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { PRESET_LABEL, PRESET_ORDER, PRESETS, presetOf } from '../../shared/presets'
import type {
  ClientConnection,
  ConnectionDraft,
  ConnectionTestResult,
  DriverStatus,
  PresetId,
} from '../../shared/types'
import { api } from '../api'
import { copyText } from '../colmenu'
import { dialectLabel, formatMs } from '../format'
import { DatabaseIcon, PlusIcon, TrashIcon } from '../icons'
import { Banner, Button, Field, Loading, Modal, Select, Switch, Tag, TextArea, TextInput } from '../ui'

export interface ConnectionModalProps {
  open: boolean
  editing: ClientConnection | null
  drivers: DriverStatus[]
  onClose: () => void
  onSaved: () => void
  onDelete: (connection: ClientConnection) => void
  notify: (text: string, tone?: 'info' | 'success' | 'error') => void
}

function toParamsText(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

function parseParamsText(text: string): Record<string, string> {
  const params: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index <= 0) continue
    params[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
  }
  return params
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const NATIVE_DRIVERS = new Set(['mysql', 'mariadb', 'postgres', 'sqlite', 'mssql', 'oracle'])

export function ConnectionModal(props: ConnectionModalProps): ReactElement | null {
  const [choice, setChoice] = useState<string>('mysql')
  const [name, setName] = useState('')
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('3306')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [clearPassword, setClearPassword] = useState(false)
  const [database, setDatabase] = useState('')
  const [redisDb, setRedisDb] = useState('0')
  const [paramsText, setParamsText] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const [nativeEngine, setNativeEngine] = useState(false)
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

  const customDrivers = useMemo(() => props.drivers.filter((driver) => driver.preset === null), [props.drivers])
  const editing = props.editing

  useEffect(() => {
    setError('')
    setTestResult(null)
    setSaving(false)
    setTesting(false)
    if (!props.open) return
    if (editing) {
      setChoice(editing.driver === 'custom' ? `custom:${editing.customDriverId ?? ''}` : editing.driver)
      setName(editing.name)
      setHost(editing.host)
      setPort(String(editing.port))
      setUser(editing.user)
      setDatabase(editing.database)
      setRedisDb(String(editing.redisDb))
      setParamsText(toParamsText(editing.params))
      setReadOnly(editing.readOnly)
      setNativeEngine(editing.nativeEngine === true)
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
    setParamsText('')
    setReadOnly(false)
    setNativeEngine(true)
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

  const isCustom = choice.startsWith('custom:')
  const customId = isCustom ? choice.slice('custom:'.length) : undefined
  const customDriver = customDrivers.find((driver) => driver.id === customId)
  const preset = !isCustom ? presetOf(choice) : undefined
  /** File based engines have no host, port or credentials to fill in. */
  const fileBased = preset?.hostOptional === true
  const dialect = isCustom ? customDriver?.dialect : preset?.dialect
  const isRedis = dialect === 'redis'
  const supportsNative = !isCustom && NATIVE_DRIVERS.has(choice)
  const useNative = supportsNative && nativeEngine
  const supportsTls = useNative && !fileBased && ['mysql', 'mariadb', 'postgres', 'mssql'].includes(choice)

  const driverOptions = [
    ...PRESET_ORDER.map((id) => ({
      value: id as string,
      label: `${PRESET_LABEL[id]}${PRESETS[id].needsJava ? '' : ''}`,
    })),
    ...customDrivers.map((driver) => ({ value: `custom:${driver.id}`, label: `${driver.name}（自定义）` })),
  ]

  const changeChoice = (value: string) => {
    setChoice(value)
    setTestResult(null)
    setError('')
    if (value.startsWith('custom:')) {
      setNativeEngine(false)
      return
    }
    const spec = presetOf(value)
    if (spec) setPort(String(spec.defaultPort))
    setNativeEngine(NATIVE_DRIVERS.has(value))
    if (value === 'sqlite') setSshEnabled(false)
  }

  const buildDraft = (): ConnectionDraft => ({
    id: editing?.id,
    name: name.trim(),
    driver: isCustom ? 'custom' : (choice as PresetId),
    customDriverId: isCustom ? customId : undefined,
    // File based engines keep no host; do not persist whatever the previous preset left behind.
    host: fileBased ? '' : host.trim(),
    port: fileBased ? 0 : Number.parseInt(port, 10) || 0,
    user: user.trim(),
    ...(password !== '' ? { password } : {}),
    ...(clearPassword ? { clearPassword: true } : {}),
    database: isRedis ? '' : database.trim(),
    redisDb: Number.parseInt(redisDb, 10) || 0,
    params: isRedis ? {} : parseParamsText(paramsText),
    // The read-only flag is chosen once, when the connection is created; an edit
    // always keeps the stored value (the switch is disabled for existing rows).
    readOnly: editing ? editing.readOnly : readOnly,
    ...(useNative ? { nativeEngine: true } : {}),
    ...(useNative && sshEnabled && !fileBased
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
    ...(useNative && sshEnabled && !fileBased && sshPassword !== '' ? { sshPassword } : {}),
    ...(useNative && sshEnabled && !fileBased && sshPassphrase !== '' ? { sshPassphrase } : {}),
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
    const spec = isCustom ? undefined : PRESETS[choice as PresetId]
    const hostOptional = spec?.hostOptional === true
    if (draft.host === '' && !hostOptional) return '请填写主机地址'
    if (!hostOptional && (!Number.isInteger(draft.port) || draft.port < 1 || draft.port > 65535)) {
      return '端口需在 1-65535 之间'
    }
    if (hostOptional && draft.database === '') return '请填写数据库文件路径'
    if (isCustom && !customDriver) return '请选择或先新增一个自定义驱动'
    if (useNative && sshEnabled && !fileBased) {
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
          {editing ? `编辑连接 · ${editing.name}` : '新建数据源连接'}
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
          <Field label="名称" required span>
            <TextInput
              value={name}
              autoFocus
              placeholder="例如 本地 MySQL"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="驱动" required span hint={dialect ? `方言：${dialectLabel(dialect)}` : undefined}>
            <Select options={driverOptions} value={choice} onValueChange={changeChoice} />
          </Field>
          {supportsNative ? (
            <div className="dshdb-span-2 dshdb-list">
              <Switch
                checked={nativeEngine}
                onChange={setNativeEngine}
                label={fileBased ? '使用内置 SQLite 引擎（无需 Java）' : '使用内置引擎（无需 Java；支持 SSH 隧道）'}
              />
            </div>
          ) : null}
          {isCustom && !customDriver ? (
            <div className="dshdb-span-2">
              <Banner tone="warn">还没有自定义驱动，请先在「设置」标签页新增。</Banner>
            </div>
          ) : null}
          {fileBased ? null : (
            <>
              <Field label="主机" required>
                <TextInput value={host} onChange={(event) => setHost(event.target.value)} placeholder="127.0.0.1" />
              </Field>
              <Field label="端口" required>
                <TextInput
                  value={port}
                  inputMode="numeric"
                  onChange={(event) => setPort(event.target.value.replace(/[^0-9]/g, ''))}
                />
              </Field>
              <Field label="用户名">
                <TextInput value={user} onChange={(event) => setUser(event.target.value)} placeholder={isRedis ? 'default' : '用户名'} />
              </Field>
              <Field label="密码" hint={editing?.hasPassword ? '已保存密码，留空则保持不变' : undefined}>
                <TextInput
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={editing?.hasPassword ? '留空则保持不变' : '密码'}
                />
              </Field>
              {editing?.hasPassword ? (
                <div className="dshdb-span-2">
                  <Switch checked={clearPassword} onChange={setClearPassword} label="清除已保存的密码" />
                </div>
              ) : null}
            </>
          )}
          {isRedis ? (
            <Field label="逻辑库序号" hint="Redis 数据库编号，默认 0">
              <TextInput
                value={redisDb}
                inputMode="numeric"
                onChange={(event) => setRedisDb(event.target.value.replace(/[^0-9]/g, ''))}
              />
            </Field>
          ) : (
            <Field label="数据库 / 服务名" span={fileBased} hint={preset?.databaseHint ?? '可留空，连接后再选择 schema'}>
              <TextInput
                value={database}
                onChange={(event) => setDatabase(event.target.value)}
                placeholder={fileBased ? '例如 ./data/app.db' : '可留空'}
              />
            </Field>
          )}
          {useNative && !fileBased ? (
            <div className="dshdb-span-2 dshdb-list">
              <Switch checked={sshEnabled} onChange={setSshEnabled} label="通过 SSH 隧道连接" />
            </div>
          ) : null}
          {useNative && sshEnabled && !fileBased ? (
            <>
              <Field label="SSH 主机" required>
                <TextInput value={sshHost} onChange={(event) => setSshHost(event.target.value)} placeholder="bastion.example.com" />
              </Field>
              <Field label="SSH 端口" required>
                <TextInput
                  value={sshPort}
                  inputMode="numeric"
                  onChange={(event) => setSshPort(event.target.value.replace(/[^0-9]/g, ''))}
                />
              </Field>
              <Field label="SSH 用户名" required>
                <TextInput value={sshUser} onChange={(event) => setSshUser(event.target.value)} placeholder="ops" />
              </Field>
              <Field label="SSH 认证">
                <Select
                  value={sshAuth}
                  options={[
                    { value: 'password', label: '密码' },
                    { value: 'key', label: '私钥' },
                    { value: 'agent', label: 'ssh-agent' },
                  ]}
                  onValueChange={(value) => setSshAuth(value as 'password' | 'key' | 'agent')}
                />
              </Field>
              {sshAuth === 'password' ? (
                <Field label="SSH 密码" hint={editing?.hasSshPassword ? '已保存，留空则保持不变' : undefined}>
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
                  <Field label="私钥路径" required>
                    <TextInput value={sshKeyPath} onChange={(event) => setSshKeyPath(event.target.value)} placeholder="~/.ssh/id_ed25519" />
                  </Field>
                  <Field label="私钥口令">
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
              <Switch checked={tlsEnabled} onChange={setTlsEnabled} label="启用 TLS / SSL" />
            </div>
          ) : null}
          {supportsTls && tlsEnabled ? (
            <>
              <Field label="TLS 校验模式">
                <Select
                  value={tlsMode}
                  options={[
                    { value: 'verify-full', label: 'verify-full（校验证书与主机名）' },
                    { value: 'verify-ca', label: 'verify-ca（校验证书，不校验主机名）' },
                    { value: 'require', label: 'require（只加密，不校验证书）' },
                  ]}
                  onValueChange={(value) => setTlsMode(value as 'verify-full' | 'verify-ca' | 'require')}
                />
              </Field>
              <Field label="CA 证书路径" hint="留空使用系统 CA">
                <TextInput value={tlsCaPath} onChange={(event) => setTlsCaPath(event.target.value)} placeholder="~/.dsh/certs/ca.pem" />
              </Field>
              <div className="dshdb-span-2 dshdb-list">
                <Switch checked={tlsAllowInvalid} onChange={setTlsAllowInvalid} label="允许无效主机名（仅测试环境，不安全）" />
              </div>
            </>
          ) : null}
          {!isRedis && !useNative ? (
            <Field label="额外 JDBC 参数" span hint="每行一个 key=value，例如 useSSL=false">
              <TextArea
                value={paramsText}
                onChange={(event) => setParamsText(event.target.value)}
                placeholder={'useSSL=false\nconnectTimeout=10000'}
              />
            </Field>
          ) : null}
          <div className="dshdb-span-2 dshdb-list">
            <Switch
              checked={readOnly}
              onChange={setReadOnly}
              disabled={editing != null}
              label={
                editing == null
                  ? '只读连接（面板与 Agent 均拒绝写操作）'
                  : '只读连接（仅新建时设置，创建后不能修改；需变更请新建连接）'
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
        {isCustom ? <Tag tone="business">自定义驱动</Tag> : null}
        {!isRedis && dialect && !useNative ? (
          <span className="dshdb-muted" style={{ fontSize: 11 }}>
            驱动类：{customDriver?.driverClass ?? preset?.driverClass ?? '—'}
          </span>
        ) : null}
        {useNative ? (
          <span className="dshdb-muted" style={{ fontSize: 11 }}>
            引擎：内置 MySQL（driver pack：mysql2）
          </span>
        ) : null}
        {!editing ? null : (
          <span className="dshdb-muted" style={{ fontSize: 11 }}>
            连接 ID：{editing.id}
          </span>
        )}
      </div>
    </Modal>
  )
}
