# dsh-database-view

[English](README.md) | **简体中文**

> **状态：M0 垂直切片已完成。** 本仓库 fork 自
> [`qwq1999/dsh-ide-database`](https://github.com/qwq1999/dsh-ide-database)，正在改造成一个
> Java-free、内置 SSH 隧道、驱动随包内置的 DSH 数据库插件。
> 目前可用：包名/插件 ID 改名、原生 MySQL Engine、SSH 传输、内置 MySQL 驱动、连接 UI，以及通过现有右侧栏完成
> Schema/表/DDL/查询。PostgreSQL/SQLite/SQL Server/Oracle、硬化和视觉验收仍在后面。

`dsh-database-view` 是一个计划中的 DeepSeek Harness（DSH）插件：在右侧栏浏览数据库结构、预览表数据，
风格接近 JetBrains Database 工具窗；同时提供只读的 Agent 工具，用于列出连接、描述表、执行有上限的
SQL 查询。

## 为什么 fork

上游插件已经是一个完整的 JetBrains 风格数据库工具窗，但有两个限制：

1. 关系型数据库依赖本机 Java 运行时和 JDBC 驱动 jar；
2. 不提供 SSH 隧道。

本项目保留现有右侧栏 UI，把数据访问层替换为 Node.js Engine；SSH 放在连接传输层，而不是每个 Engine
各做一套。JDBC 作为可选扩展包保留给长尾数据库，核心插件不依赖 Java。

## 本轮范围

| 领域 | 计划支持 |
|---|---|
| 数据库 | MySQL、MariaDB、PostgreSQL、SQLite、SQL Server、Oracle（Thin 模式） |
| 连接 | 直连 TCP 与 SSH（密码、私钥、ssh-agent；主机密钥确认） |
| 结构浏览 | 连接 → Schema → 表/视图 → 列/索引；结构缓存支持离线浏览 |
| 表预览 | 分页、WHERE/ORDER BY、列类型、DDL、长文本弹层、CSV/JSON 导出 |
| SQL 控制台 | 只读执行、多语句、历史、取消、行数/字节上限 |
| Agent 工具 | 列出/测试连接、列出 Schema/对象、描述表、取 DDL、执行只读 SQL |
| 本轮不做 | 达梦、OceanBase、Redis SSH、JDBC 扩展包、第三方 Engine |

SQL Server、Oracle **已纳入本轮**。达梦、OceanBase、Redis SSH、JDBC 扩展包和第三方 Engine 暂不做；
扩展点会保留，后续可以在不改核心的情况下加入。

## 设计原则

- **核心不依赖 Java**：数据库访问使用 Node.js 驱动，从自包含的 driver pack 加载。
- **SSH 属于传输层**：所有 Engine 共享认证、主机密钥校验和端口转发逻辑。
- **驱动随包内置**：所需 driver pack 随插件发布，加载前校验 SHA-256；后续可选驱动仍保留下载模式。
- **主流优先，长尾靠扩展**：核心只带少量 Engine；新 Engine 通过 `dbEngines` 服务注册，不改路由和 UI。
- **默认只读**：写操作需要显式开关、二次确认，并建议使用数据库只读账号。
- **结果有上限**：所有查询都有行数、字节、单元格、超时和并发限制。

## 设计文档

| 文档 | 内容 |
|---|---|
| [设计方案（B + 可选 C）](docs/design.md) | Engine SPI、DriverManager、SSH 传输、JDBC 扩展、API/UI/测试/里程碑 |
| [可行性研究报告](docs/feasibility.md) | 驱动矩阵、Java-free 分析、SSH 验证、风险与工作量 |
| [POC 脚本](poc/README.md) | 在 DSH Electron 运行时验证驱动加载和 SSH 端口转发 |
| [上游 README（中文）](docs/upstream-readme.zh-CN.md) | `dsh-ide-database` 的原始功能文档 |

## 计划架构

```text
Client（React 右侧栏）
  └── HTTP 路由
        └── DbService（会话、队列、限流、取消）
              ├── TransportService（直连 / SSH）
              ├── DbEngines（Engine SPI 注册表）
              ├── DbDrivers（校验、加载、可选下载）
              ├── SecretStore / KnownHostsStore
              └── StructureCache
```

一个数据库 Engine 实现一个小接口（`connect`、`listSchemas`、`describe`、`ddl`、`query`、`explain`、
`transaction`、`cancel`），并通过 descriptor 声明能力和连接表单。UI 由 descriptor 驱动，新增 Engine
不需要修改客户端。

## 驱动交付

本轮所需的驱动 pack **直接随插件包内置**，首次连接即可用，不需要 npm 安装或额外下载。每个 pack 是
自包含 ESM 模块，带固定版本、SHA-256 和许可证信息；DriverManager 加载前仍会校验文件。

| 模式 | 含义 | 例子 |
|---|---|---|
| `builtin` | Node/Electron 内置 | SQLite（`node:sqlite`） |
| `bundled` | 随插件包内置 | mysql2、pg、tedious、oracledb Thin |
| `download` | 可选的后续模式，用于额外/可选驱动 | 本轮不使用 |
| `user-provided` | 因许可证由用户提供 | 达梦 `dmdb`（后续） |
| `jdbc` | Maven jar 下载，供可选 JDBC 包使用 | MySQL/Oracle/DM JDBC（后续） |

内置驱动的体积不大：M0 的 MySQL pack 约 1.4 MB；SQL Server/Oracle/PostgreSQL 全部加起来预计仍在个位数 MB。
JDBC 扩展包会复用同一套驱动管理器和状态 UI。

## 仓库结构

```text
docs/        设计方案、可行性报告、上游 README
poc/         SSH + MySQL/PostgreSQL 验证脚本
src/         上游插件源码（待重构）
bridge/      上游 Java 桥（待迁移到 JDBC 扩展包）
tests/       上游测试（待适配）
```

源码已切换到 `dsh-database-view`（包名、插件 ID、路由前缀、数据目录和 tab ID）。上游 JDBC 桥仍保留给尚未迁移的 Engine。

## 路线图

| 里程碑 | 范围 |
|---|---|
| M0 | 改名、Engine SPI、DriverManager、MySQL driver pack、SSH、连接 UI |
| M1 | PostgreSQL、SQLite、元数据/DDL/EXPLAIN、v1 迁移、表预览 |
| M2 | SQL Server、Oracle Thin、TLS、driver pack、集成测试 |
| M3 | 控制台、导出、Agent 工具、只读策略、错误/主机密钥 UX |
| M4 | 性能/安全、打包、外部 Engine 贡献指南、发布 |

本轮估算 **10–14 人周**；如果没有现成的 driver pack 发布流水线，按 **11–15 人周** 估算。

## npm 包

计划使用的 npm 包名是 **`dsh-database-view`**。2026-11-14 查询 registry 返回 404（当时可用）。
npm 账号尚未登录；发布前需要 `npm login` 或配置 npm token。

## 上游与许可

本项目基于 [`qwq1999/dsh-ide-database`](https://github.com/qwq1999/dsh-ide-database)，上游使用 MIT
许可证；原版权和许可声明保留。上游功能文档见 [docs/upstream-readme.zh-CN.md](docs/upstream-readme.zh-CN.md)。

达梦 `dmdb` 驱动为商业许可，本项目不打包、不再分发。Oracle 和 SQL Server 驱动仍受各自许可证约束。
