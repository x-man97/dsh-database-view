# dsh-database-view

**English** | [简体中文](README.zh-CN.md)

> A DeepSeek Harness plugin that brings a JetBrains-style database tool window to the right sidebar.
> It uses bundled Node.js drivers only: **no Java runtime, no JDBC, no external driver downloads.**

## Status

All SQL engines in this iteration are implemented and live-tested against Docker instances:

- MySQL 8 / MariaDB
- PostgreSQL
- SQLite (Node's built-in `node:sqlite`)
- SQL Server
- Oracle (Thin mode)
- Redis (native `ioredis`)

SSH tunneling, TLS configuration for MySQL/PostgreSQL/SQL Server, schema browsing, table preview, DDL,
query console, and read-only agent tools are available. Oracle TLS is not implemented yet.

## Install

Install from the DSH plugin manager, or run:

```bash
dsh plugin add dsh-database-view
```

Then open **Database View** from the right-sidebar guide or DSH Settings.

## Scope

| Area | Support |
|---|---|
| SQL databases | MySQL, MariaDB, PostgreSQL, SQLite, SQL Server, Oracle |
| Key-value | Redis |
| Connections | Direct TCP and SSH (password, private key, ssh-agent); TOFU host-key pinning |
| Browsing | Schemas → tables/views → columns/indexes; cached structure for offline browsing |
| Table preview | Pagination, filters, sorting, inline add/edit/delete with SQL preview, undo, DDL, CSV/JSON export |
| SQL console | Syntax highlighting, completion, read-only by default, multi-statement scripts, history, cancel |
| Agent tools | Connections, schemas, tables, DDL, EXPLAIN, bounded SQL, Redis inspection |

There is deliberately **no JDBC bridge, no Java runtime manager, and no custom-driver form**. Adding a
database means adding a native Engine and a driver pack.

## Languages

The plugin follows DSH's **Settings → General → Language** choice. English and Chinese dictionaries are registered through the DSH locale service; other DSH locales fall back to English. Settings, the connection form, the data-source toolbar, table editing, and the SQL console use the shared translator.

## Design

```text
Client (React right sidebar)
  └── HTTP routes
        └── SqlService (native sessions, limits, cancellation)
              ├── EngineRegistry (MySQL, PostgreSQL, SQLite, SQL Server, Oracle)
              ├── DriverManager (bundled ESM packs, SHA-256 verified)
              ├── SSH transport (ssh2, local port forwarding)
              └── SecretStore / StructureCache
```

Each engine implements `connect`, `listSchemas`, `listObjects`, `describe`, `ddl`, `query`, `explain`,
`transaction`, and `cancel`, and declares its capabilities and connection form through a descriptor.

## Driver packs

All packs ship with the plugin and are verified before loading:

| Pack | Engine | Delivery |
|---|---|---|
| `mysql2` | MySQL/MariaDB | bundled ESM |
| `pg` | PostgreSQL | bundled ESM |
| `tedious` | SQL Server | bundled ESM |
| `oracledb` (Thin) | Oracle | bundled ESM |
| `node:sqlite` | SQLite | Node built-in |

No Maven, jar, JDBC URL, or Java path is used at runtime.

## Development

```bash
npm install
npm run build          # driver packs + host + client
npm test               # unit tests
npm run verify         # typecheck + tests
```

Repository layout:

```text
src/host/       native SQL service, engines, driver manager, SSH, routes, tools
src/client/     React right-sidebar UI
driver-packs/   esbuild entry points for bundled driver packs
drivers/        built ESM packs
tests/          unit and integration tests
docs/           design and implementation notes
```

## License

Based on [`qwq1999/dsh-ide-database`](https://github.com/qwq1999/dsh-ide-database), MIT licensed.
MySQL, PostgreSQL, SQL Server, Oracle, and Redis drivers remain subject to their own licenses.
