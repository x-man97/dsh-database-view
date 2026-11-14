import { useSyncExternalStore } from 'react'

export const I18N_NAMESPACE = 'dsh-database-view'

type Dict = Record<string, string>

const zh: Dict = {
  'nav.database': '数据库',
  'nav.table': '数据表',
  'nav.console': '查询控制台',
  'app.add': '新增',
  'app.addTitle': '新增数据源',
  'app.edit': '编辑',
  'app.editTitle': '编辑选中的数据源',
  'app.refresh': '刷新',
  'app.refreshTitle': '刷新选中的数据源',
  'app.delete': '删除',
  'app.deleteTitle': '删除选中的数据源',
  'app.console': '控制台',
  'app.consoleTitle': '查询控制台',
  'app.trash': '回收站',
  'app.trashTitle': '回收站',
  'app.noSelection': '尚未选择数据源',
  'app.connecting': '连接中',
  'app.connect': '连接',
  'app.disconnect': '断开',
  'app.nativeEngine': '内置引擎',
  'app.confirmTitle': '确认操作',
  'app.continue': '继续',
  'conn.newTitle': '新建数据源连接',
  'conn.editTitle': '编辑连接',
  'conn.name': '名称',
  'conn.type': '数据库类型',
  'conn.host': '主机',
  'conn.port': '端口',
  'conn.user': '用户名',
  'conn.password': '密码',
  'conn.database': '数据库 / 服务名',
  'conn.sqliteFile': '数据库文件',
  'conn.redisDb': '逻辑库序号',
  'conn.ssh': '通过 SSH 隧道连接',
  'conn.tls': '启用 TLS / SSL',
  'conn.readonly': '只读连接（面板与 Agent 均拒绝写操作）',
  'conn.readonlyEdit': '只读连接（仅新建时设置，创建后不能修改；需变更请新建连接）',
  'conn.test': '测试连接',
  'conn.save': '保存',
  'conn.cancel': '取消',
  'conn.delete': '删除',
  'conn.engine': '引擎',
  'settings.nav': '数据库',
  'console.action.run': '执行',
  'console.action.cancel': '取消',
  'console.action.history': '历史',
  'console.action.format': '格式化',
  'console.action.import': '导入',
  'console.action.save': '保存',
  'console.action.clear': '清空',
  'console.action.copy': '复制 SQL',
  'console.action.explain': '执行计划',
  'console.action.openTable': '打开数据表',
  'console.action.txStart': '事务',
  'console.action.txCommit': '提交',
  'console.action.txRollback': '回滚',
  'console.action.export': '导出',
  'data.emptyTitle': '还没有数据源',
  'data.emptyDescription': '用工具栏的「新增」按钮添加 MySQL、PostgreSQL、SQLite、SQL Server、Oracle 或 Redis 连接。连接一次之后，即使离线也能浏览缓存的库表结构。',
  'data.newConnection': '新建连接',
  'data.noMatches': '没有匹配的对象',
  'data.help': '展开数据源，选择表或视图可查看列、索引等结构信息；选择函数、存储过程、触发器可查看定义；行尾按钮可选择显示的架构。',

  'settings.querySecurity': '查询与安全',
  'settings.maxRows': '返回行数上限',
  'settings.maxRowsHint': '面板与工具共用的硬上限',
  'settings.queryTimeout': '查询超时（秒）',
  'settings.connectTimeout': '连接超时（秒）',
  'settings.redisScan': 'Redis 单次扫描数量',
  'settings.agentWrites': '允许 Agent 工具执行写语句（仅非只读连接）',
  'settings.confirmDestructive': '执行破坏性操作前需要二次确认',
  'settings.save': '保存',
  'settings.shortcuts': '快捷键',
  'settings.restore': '恢复默认',
  'settings.toolbar': '数据源工具栏',
  'settings.console': '控制台',
  'settings.consoleToolbar': '控制台工具栏',
  'settings.autoComplete': '输入字符后自动展开补全列表',
  'table.add': '增加一行',
  'table.delete': '标记选中的行为删除（再次点击恢复）',
  'table.dml': '打开 DML 语句预览',
  'table.submit': '直接提交所有待处理更改',
  'table.pending': '待提交',
  'table.where': 'WHERE',
  'table.orderBy': 'ORDER BY',
  'table.refresh': '刷新',
  'table.ddl': '查看建表语句',
  'table.console': '在查询控制台打开这个表',
  'table.dmlTitle': 'DML 预览',
  'table.dmlSubmit': '提交',
  'table.dmlCancel': '取消',
  'table.noPrimaryKey': '未检测到主键，WHERE 将按原始全部列匹配。',
  'console.execute': '执行',
  'console.cancel': '取消',
  'console.waiting': '等待执行',
  'console.waitingHint': '上面的语句会在当前数据源上运行，结果按页展示。',
  'console.placeholder': '输入 SQL，Ctrl/⌘ + Enter 执行；Ctrl/⌘ + Space 补全表名和列名',
  'console.actions': '执行',
  'console.history': '历史',
  'console.format': '格式化',
  'console.import': '导入',
  'console.save': '保存',
  'console.clear': '清空',
  'console.copy': '复制 SQL',
  'console.explain': '执行计划',
}

const en: Dict = {
  'nav.database': 'Database',
  'nav.table': 'Table',
  'nav.console': 'SQL Console',
  'app.add': 'Add',
  'app.addTitle': 'Add data source',
  'app.edit': 'Edit',
  'app.editTitle': 'Edit selected data source',
  'app.refresh': 'Refresh',
  'app.refreshTitle': 'Refresh selected data source',
  'app.delete': 'Delete',
  'app.deleteTitle': 'Delete selected data source',
  'app.console': 'Console',
  'app.consoleTitle': 'SQL Console',
  'app.trash': 'Recycle Bin',
  'app.trashTitle': 'Recycle Bin',
  'app.noSelection': 'No data source selected',
  'app.connecting': 'Connecting',
  'app.connect': 'Connect',
  'app.disconnect': 'Disconnect',
  'app.nativeEngine': 'Native engine',
  'app.confirmTitle': 'Confirm action',
  'app.continue': 'Continue',
  'conn.newTitle': 'New data source',
  'conn.editTitle': 'Edit connection',
  'conn.name': 'Name',
  'conn.type': 'Database type',
  'conn.host': 'Host',
  'conn.port': 'Port',
  'conn.user': 'User',
  'conn.password': 'Password',
  'conn.database': 'Database / Service',
  'conn.sqliteFile': 'Database file',
  'conn.redisDb': 'Logical database',
  'conn.ssh': 'Connect through an SSH tunnel',
  'conn.tls': 'Enable TLS / SSL',
  'conn.readonly': 'Read-only (panel and agent tools reject writes)',
  'conn.readonlyEdit': 'Read-only (set at creation; create a new connection to change it)',
  'conn.test': 'Test connection',
  'conn.save': 'Save',
  'conn.cancel': 'Cancel',
  'conn.delete': 'Delete',
  'conn.engine': 'Engine',
  'settings.nav': 'Database',
  'console.action.run': 'Run',
  'console.action.cancel': 'Cancel',
  'console.action.history': 'History',
  'console.action.format': 'Format',
  'console.action.import': 'Import',
  'console.action.save': 'Save',
  'console.action.clear': 'Clear',
  'console.action.copy': 'Copy SQL',
  'console.action.explain': 'Explain',
  'console.action.openTable': 'Open table',
  'console.action.txStart': 'Transaction',
  'console.action.txCommit': 'Commit',
  'console.action.txRollback': 'Rollback',
  'console.action.export': 'Export',
  'data.emptyTitle': 'No data sources yet',
  'data.emptyDescription': 'Use Add in the toolbar to connect MySQL, PostgreSQL, SQLite, SQL Server, Oracle, or Redis. Once connected, the cached schema stays browsable offline.',
  'data.newConnection': 'New connection',
  'data.noMatches': 'No matching objects',
  'data.help': 'Expand a data source and select a table or view to inspect columns and indexes; routines, sequences, and triggers show their definitions. Use the row-end picker to choose visible schemas.',

  'settings.querySecurity': 'Query & safety',
  'settings.maxRows': 'Row limit',
  'settings.maxRowsHint': 'Hard limit shared by the panel and agent tools',
  'settings.queryTimeout': 'Query timeout (s)',
  'settings.connectTimeout': 'Connect timeout (s)',
  'settings.redisScan': 'Redis scan count',
  'settings.agentWrites': 'Allow agent tools to run writes (non-read-only connections)',
  'settings.confirmDestructive': 'Confirm destructive operations',
  'settings.save': 'Save',
  'settings.shortcuts': 'Shortcuts',
  'settings.restore': 'Restore defaults',
  'settings.toolbar': 'Data source toolbar',
  'settings.console': 'Console',
  'settings.consoleToolbar': 'Console toolbar',
  'settings.autoComplete': 'Open completions while typing',
  'table.add': 'Add row',
  'table.delete': 'Mark selected rows for deletion (click again to restore)',
  'table.dml': 'Open DML preview',
  'table.submit': 'Submit all pending changes',
  'table.pending': 'Pending',
  'table.where': 'WHERE',
  'table.orderBy': 'ORDER BY',
  'table.refresh': 'Refresh',
  'table.ddl': 'Show CREATE statement',
  'table.console': 'Open this table in the SQL console',
  'table.dmlTitle': 'DML Preview',
  'table.dmlSubmit': 'Submit',
  'table.dmlCancel': 'Cancel',
  'table.noPrimaryKey': 'No primary key detected; the WHERE clause will match all original columns.',
  'console.execute': 'Run',
  'console.cancel': 'Cancel',
  'console.waiting': 'Ready to run',
  'console.waitingHint': 'The statement runs against the current data source and pages the result.',
  'console.placeholder': 'Enter SQL. Ctrl/⌘ + Enter runs it; Ctrl/⌘ + Space completes tables and columns.',
  'console.actions': 'Run',
  'console.history': 'History',
  'console.format': 'Format',
  'console.import': 'Import',
  'console.save': 'Save',
  'console.clear': 'Clear',
  'console.copy': 'Copy SQL',
  'console.explain': 'Explain',
}

let translator: ((key: string, params?: Record<string, unknown>) => string) | undefined
let revision = 0
const listeners = new Set<() => void>()

export interface LocaleService {
  register(namespace: string, dictionaries: Record<string, Dict>): () => void
  bind(namespace: string): (key: string, params?: Record<string, unknown>) => string
  subscribe(listener: () => void): () => void
}

export function installI18n(locale: LocaleService): () => void {
  const dispose = locale.register(I18N_NAMESPACE, { zh, en })
  translator = locale.bind(I18N_NAMESPACE)
  revision += 1
  for (const listener of listeners) listener()
  const unsubscribe = locale.subscribe(() => {
    revision += 1
    for (const listener of listeners) listener()
  })
  return () => {
    unsubscribe()
    dispose()
    translator = undefined
  }
}

export function t(key: string, params?: Record<string, unknown>): string {
  if (translator !== undefined) return translator(key, params)
  const template = zh[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Re-render the calling component when the active DSH locale changes. */
export function useI18n(): typeof t {
  useSyncExternalStore(subscribe, () => revision, () => revision)
  return t
}
