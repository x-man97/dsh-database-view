# dsh-database-view design

## Goal

A DeepSeek Harness plugin with a JetBrains-style right-sidebar database tool window. All data access is
native Node.js; there is no Java runtime, JDBC bridge, jar download, or custom-driver path.

## Supported engines

| Engine | Driver | Connection | TLS |
|---|---|---|---|
| MySQL / MariaDB | `mysql2` bundled ESM | TCP / SSH | yes |
| PostgreSQL | `pg` bundled ESM | TCP / SSH | yes |
| SQLite | `node:sqlite` | local file | n/a |
| SQL Server | `tedious` bundled ESM | TCP / SSH | yes |
| Oracle | `oracledb` Thin bundled ESM | TCP / SSH | not yet |
| Redis | `ioredis` | TCP | n/a |

## Layers

```text
React client
  └── POST /dsh-database-view/api/*
        └── SqlService (thin facade)
              └── NativeSqlService
                    ├── EngineRegistry
                    │     ├── MysqlEngine
                    │     ├── PostgresEngine
                    │     ├── SqliteEngine
                    │     ├── MssqlEngine
                    │     └── OracleEngine
                    ├── DriverManager (manifest + SHA-256 + ESM import)
                    └── SshTransport (ssh2, local port forwarding)
```

Redis is a separate `RedisManager`; it is not a SQL engine.

## Engine SPI

Each engine exposes a descriptor and implements:

```ts
connect(ctx): Promise<ServerInfo>
disconnect(): Promise<void>
listSchemas(filter?): Promise<SchemaInfo[]>
listObjects(schema): Promise<SchemaObject[]>
setSchema(schema): Promise<void>
describe(schema, table, kind): Promise<TableDescription>
ddl(schema, table, kind): Promise<DdlResult>
query(sql, options): Promise<QueryResult>
explain(sql): Promise<ExplainResult>
transaction(action): Promise<void>
cancel(): Promise<boolean>
```

The descriptor carries `kind`, `dialect`, `defaultPort`, `driverId`, and capability flags.

## Driver packs

`drivers.json` lists each pack with id, engine, version, license, file, SHA-256, and byte length. Packs are
self-contained ESM modules built by `scripts/build-drivers.mjs`; SQLite uses Node's built-in module. The
manager verifies the hash before importing. No pack is fetched at runtime.

## Configuration

`connections.json` stores version 2 data: connections, recycle bin, and settings. Passwords and SSH secrets
live in `secrets.json` through `SecretStore`. Legacy version-1 connections whose driver has no native engine
are dropped during hydration. `params`, `customDriverId`, `nativeEngine`, `javaPath`, `mavenMirror`, and the
old `drivers` array are no longer read or written.

## SSH and TLS

SSH uses `ssh2` with password, private key, or agent auth. Host keys are pinned in
`ssh-known-hosts.json` (TOFU) and a mismatch aborts the connection. The engine connects to a loopback
forwarded port.

TLS is configured per connection: `verify-full`, `verify-ca`, `require`, optional CA/cert/key paths, and an
explicit test-only `allowInvalidHostname`. MySQL, PostgreSQL, and SQL Server map these settings to their
native driver options. Oracle TLS is not implemented.

## Safety

- Read-only connections reject writes in both the panel and agent tools.
- Agent writes require `allowAgentWrites`.
- Queries are bounded by row count, timeout, and statement key; cancel uses driver-native cancellation where
  available.
- Destructive UI actions require confirmation.


## Localization

Client copy is registered through `@deepseek-ai/dsh-client-locale` under the `dsh-database-view` namespace with `zh` and `en` dictionaries. Components call the module-level `t()` helper; `useI18n()` subscribes the main surfaces to locale revisions. Other DSH locales fall back through English. The DSH General → Language row is the only language switch; the plugin has no separate locale selector.
