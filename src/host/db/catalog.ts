import { MysqlEngine, MYSQL_DESCRIPTOR } from './engines/mysql.js'
import { PostgresEngine } from './engines/postgres.js'
import { SqliteEngine } from './engines/sqlite.js'
import { MssqlEngine } from './engines/mssql.js'
import { OracleEngine } from './engines/oracle.js'
import { defineEngine } from './types.js'

export const mysqlEngine = defineEngine({
  apiVersion: 1,
  descriptor: MYSQL_DESCRIPTOR,
  create: () => new MysqlEngine(),
})

export const postgresEngine = defineEngine({
  apiVersion: 1,
  descriptor: new PostgresEngine().descriptor,
  create: () => new PostgresEngine(),
})

export const sqliteEngine = defineEngine({
  apiVersion: 1,
  descriptor: new SqliteEngine().descriptor,
  create: () => new SqliteEngine(),
})

export const mssqlEngine = defineEngine({
  apiVersion: 1,
  descriptor: new MssqlEngine().descriptor,
  create: () => new MssqlEngine(),
})

export const oracleEngine = defineEngine({
  apiVersion: 1,
  descriptor: new OracleEngine().descriptor,
  create: () => new OracleEngine(),
})

/** Engines compiled into the core package. External packages register later. */
export const coreEngines = [mysqlEngine, postgresEngine, sqliteEngine, mssqlEngine, oracleEngine]


/** Driver preset id → engine kind. MariaDB reuses the MySQL engine. */
export const NATIVE_ENGINE_BY_DRIVER: Record<string, string> = {
  mysql: 'mysql',
  mariadb: 'mysql',
  postgres: 'postgres',
  sqlite: 'sqlite',
  mssql: 'mssql',
  oracle: 'oracle',
}

export function nativeKindFor(driver: string | undefined): string | undefined {
  return driver === undefined ? undefined : NATIVE_ENGINE_BY_DRIVER[driver]
}
