# dsh-database-view

**English** | [简体中文](README.zh-CN.md)

> **Status: M0 vertical slice complete.** This repository is a fork of
> [`qwq1999/dsh-ide-database`](https://github.com/qwq1999/dsh-ide-database) and is being reshaped into a
> Java-free DSH database plugin with built-in SSH tunneling and bundled driver packs.
> Working now: package rename, native MySQL engine, SSH transport, bundled MySQL driver, connection UI,
> schema/table/DDL/query over the existing right sidebar. PostgreSQL/SQLite/SQL Server/Oracle, hardening,
> and visual QA are still ahead.

`dsh-database-view` is a planned DeepSeek Harness (DSH) plugin for browsing database schemas and previewing
table data in the right sidebar, in the spirit of the JetBrains Database tool window. It will also expose
read-only agent tools for listing connections, describing tables, and running bounded SQL queries.

## Why this fork

The upstream plugin is already a complete JetBrains-style database tool window, but it has two limitations:

1. Relational databases require a local Java runtime and JDBC driver jars.
2. There is no SSH tunnel support.

This project keeps the existing right-sidebar UI and replaces the data access layer with Node.js engines.
SSH is part of the connection transport, not each engine. JDBC remains available as an optional extension
package for long-tail databases, but the core plugin does not depend on Java.

## Scope for this iteration

| Area | Planned support |
|---|---|
| Databases | MySQL, MariaDB, PostgreSQL, SQLite, SQL Server, Oracle (Thin mode) |
| Connection | Direct TCP and SSH (password, private key, ssh-agent; host-key confirmation) |
| Browsing | Connections → schemas → tables/views → columns/indexes; cached structure for offline browsing |
| Table preview | Pagination, WHERE/ORDER BY, column types, DDL, long-text modal, CSV/JSON export |
| SQL console | Read-only execution, multi-statement scripts, history, cancel, row/byte limits |
| Agent tools | List/test connections, list schemas/objects, describe tables, get DDL, execute read-only SQL |
| Not in this iteration | 达梦 (DM), OceanBase, Redis over SSH, JDBC extension package, third-party engines |

SQL Server and Oracle are **included in this iteration**. 达梦, OceanBase, Redis SSH, the JDBC extension
package, and third-party engines are intentionally deferred; the extension points are kept so they can be
added without changing the core.

## Design principles

- **No Java in the core.** Database access uses Node.js drivers loaded from self-contained driver packs.
- **SSH is a transport concern.** All engines share the same authentication, host-key verification, and
  forwarding logic.
- **Drivers are bundled.** Required driver packs ship with the plugin; the DriverManager verifies SHA-256
  before loading. A download mode remains available for optional drivers in later iterations.
- **Mainstream first, long tail by extension.** The core ships a small set of engines; additional engines can
  register through the `dbEngines` service without touching routes or UI.
- **Read-only by default.** Writes require an explicit switch, a second confirmation, and ideally a
  read-only database account.
- **Bounded results.** Every query has row, byte, cell, timeout, and concurrency limits.

## Design documents

| Document | Contents |
|---|---|
| [Design proposal (B + optional C)](docs/design.md) | Engine SPI, DriverManager, SSH transport, JDBC extension, API/UI/testing/milestones |
| [Feasibility study](docs/feasibility.md) | Driver matrix, Java-free analysis, SSH proof of concept, risks and effort |
| [POC scripts](poc/README.md) | Reproducible probes for driver loading and SSH port forwarding in the DSH Electron runtime |
| [Upstream README (Chinese)](docs/upstream-readme.zh-CN.md) | Original feature documentation from `dsh-ide-database` |

## Planned architecture

```text
Client (React right sidebar)
  └── HTTP routes
        └── DbService (sessions, queue, limits, cancellation)
              ├── TransportService (direct TCP / SSH)
              ├── DbEngines (Engine SPI registry)
              ├── DbDrivers (verify, load, optional download)
              ├── SecretStore / KnownHostsStore
              └── StructureCache
```

A database engine implements a small interface (`connect`, `listSchemas`, `describe`, `ddl`, `query`,
`explain`, `transaction`, `cancel`) and declares its capabilities and connection form through a descriptor.
The UI is descriptor-driven, so a new engine does not require client changes.

## Driver delivery

The driver packs required by this iteration are **bundled with the plugin package**, so the first connection
works offline and does not need npm or a download step. Each pack is a self-contained ESM module with a
pinned version, SHA-256, and license metadata; the DriverManager still verifies the file before loading it.

| Mode | Meaning | Examples |
|---|---|---|
| `builtin` | Provided by Node/Electron | SQLite (`node:sqlite`) |
| `bundled` | Shipped inside the plugin package | mysql2, pg, tedious, oracledb Thin |
| `download` | Optional future mode for additional/optional drivers | not used in this iteration |
| `user-provided` | Supplied by the user because of licensing | 达梦 `dmdb` (deferred) |
| `jdbc` | Maven jar download, used by the optional JDBC pack | MySQL/Oracle/DM JDBC (deferred) |

Bundling costs a few MB: the M0 MySQL pack is about 1.4 MB; the full SQL Server/Oracle/PostgreSQL set is
expected to remain in the single-digit MB range. The JDBC extension package will reuse the same driver
manager and status UI.

## Repository layout

```text
docs/        design, feasibility, upstream README
poc/         proof-of-concept scripts (SSH + MySQL/PostgreSQL)
src/         upstream plugin source (to be refactored)
bridge/      upstream Java bridge (to be moved to the JDBC extension)
tests/       upstream tests (to be adapted)
```

The source has been renamed to `dsh-database-view` (package, plugin ID, route prefix, data directory, and tab
IDs). The upstream JDBC bridge is still present for the yet-to-be-migrated engines.

## Roadmap

| Milestone | Scope |
|---|---|
| M0 | Rename, Engine SPI, DriverManager, MySQL driver pack, SSH, connection UI |
| M1 | PostgreSQL, SQLite, metadata/DDL/EXPLAIN, v1 migration, table preview |
| M2 | SQL Server, Oracle Thin, TLS, driver packs, integration tests |
| M3 | Console, export, agent tools, read-only policy, error/host-key UX |
| M4 | Hardening, packaging, external-engine contributor guide, release |

Estimated effort for this iteration: **10–14 person-weeks**, or **11–15** without an existing driver-pack
release pipeline.

## npm package

The planned npm package name is **`dsh-database-view`**. A registry check on 2026-11-14 returned 404
(available at that time). The npm account is not logged in yet; publishing requires `npm login` or an npm
token.

## Upstream and license

This project is based on [`qwq1999/dsh-ide-database`](https://github.com/qwq1999/dsh-ide-database), which is
MIT licensed. The original copyright and license notices are retained. The upstream feature documentation is
available at [docs/upstream-readme.zh-CN.md](docs/upstream-readme.zh-CN.md).

达梦's `dmdb` driver is proprietary and is not bundled or redistributed by this project. Oracle and SQL
Server drivers remain subject to their own licenses.
