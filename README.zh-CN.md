# dsh-database-view

[English](README.md) | **简体中文**

> DeepSeek Harness 的右侧栏数据库工具窗口，风格接近 JetBrains Database。
> **只使用随包内置的 Node.js 驱动：不需要 Java、不使用 JDBC、不下载外部驱动。**

## 状态

本轮所有 SQL Engine 均已实现，并通过 Docker 实例真实联调：

- MySQL 8 / MariaDB
- PostgreSQL
- SQLite（Node 内置 `node:sqlite`）
- SQL Server
- Oracle（Thin 模式）
- Redis（原生 `ioredis`）

SSH 隧道、MySQL/PostgreSQL/SQL Server 的 TLS 配置、Schema 浏览、表预览、DDL、SQL 控制台和只读
Agent 工具均可用。Oracle TLS 尚未实现。

## 范围

| 区域 | 支持 |
|---|---|
| SQL 数据库 | MySQL、MariaDB、PostgreSQL、SQLite、SQL Server、Oracle |
| 键值库 | Redis |
| 连接 | 直连 TCP 和 SSH（密码、私钥、ssh-agent）；TOFU 主机密钥固定 |
| 浏览 | Schema → 表/视图 → 列/索引；离线可浏览结构缓存 |
| 表预览 | 分页、过滤、排序、列信息、DDL、长文本弹窗、CSV/JSON 导出 |
| SQL 控制台 | 默认只读、多语句脚本、历史、取消、行数/时间限制 |
| Agent 工具 | 连接、Schema、表、DDL、EXPLAIN、有界 SQL、Redis 查看 |

项目**不再包含 JDBC 桥、Java 运行时管理或自定义驱动表单**。新增数据库需要新增原生 Engine 和驱动 pack。

## 设计

```text
Client（React 右侧栏）
  └── HTTP 路由
        └── SqlService（原生会话、限制、取消）
              ├── EngineRegistry（MySQL、PostgreSQL、SQLite、SQL Server、Oracle）
              ├── DriverManager（内置 ESM pack，SHA-256 校验）
              ├── SSH 传输（ssh2，本地端口转发）
              └── SecretStore / StructureCache
```

每个 Engine 实现 `connect`、`listSchemas`、`listObjects`、`describe`、`ddl`、`query`、`explain`、
`transaction`、`cancel`，并通过 descriptor 声明能力和连接表单。

## 驱动 pack

全部随插件打包，加载前校验 SHA-256：

| Pack | Engine | 交付方式 |
|---|---|---|
| `mysql2` | MySQL/MariaDB | 内置 ESM |
| `pg` | PostgreSQL | 内置 ESM |
| `tedious` | SQL Server | 内置 ESM |
| `oracledb`（Thin） | Oracle | 内置 ESM |
| `node:sqlite` | SQLite | Node 内置 |

运行时不使用 Maven、jar、JDBC URL 或 Java 路径。

## 开发

```bash
npm install
npm run build          # driver packs + host + client
npm test               # 单元测试
npm run verify         # 类型检查 + 测试
```

目录：

```text
src/host/       原生 SQL 服务、Engine、驱动管理、SSH、路由、工具
src/client/     React 右侧栏 UI
driver-packs/   内置驱动 pack 的 esbuild 入口
drivers/        构建后的 ESM pack
tests/          单元与集成测试
docs/           设计与实现说明
```

## 许可证

基于 [`qwq1999/dsh-ide-database`](https://github.com/qwq1999/dsh-ide-database)，MIT 许可。
MySQL、PostgreSQL、SQL Server、Oracle、Redis 驱动仍受各自许可证约束。
