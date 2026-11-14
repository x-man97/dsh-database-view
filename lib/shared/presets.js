export const PLUGIN_NAME = 'dsh-database-view';
export const ROUTE_PREFIX = '/dsh-database-view/api';
export const DATA_DIR_NAME = 'dsh-database-view';
/**
 * Every SQL preset here is backed by a bundled Node.js driver pack. Redis is
 * backed by `ioredis`. There is deliberately no custom-driver escape hatch:
 * adding a database means adding a native Engine and driver pack.
 */
export const PRESETS = {
    mysql: {
        id: 'mysql',
        dialect: 'mysql',
        defaultPort: 3306,
        databaseHint: '数据库名（可留空）',
    },
    mariadb: {
        id: 'mariadb',
        dialect: 'mysql',
        defaultPort: 3306,
        databaseHint: '数据库名（可留空）',
    },
    oracle: {
        id: 'oracle',
        dialect: 'oracle',
        defaultPort: 1521,
        databaseHint: '服务名（Service Name），例如 ORCLPDB1',
    },
    postgres: {
        id: 'postgres',
        dialect: 'postgres',
        defaultPort: 5432,
        databaseHint: '数据库名（留空时连当前用户的默认库）',
    },
    sqlite: {
        id: 'sqlite',
        dialect: 'sqlite',
        defaultPort: 0,
        databaseHint: '数据库文件路径，例如 D:/data/app.db 或 :memory:',
        hostOptional: true,
    },
    mssql: {
        id: 'mssql',
        dialect: 'mssql',
        defaultPort: 1433,
        databaseHint: '数据库名，例如 master',
    },
    redis: {
        id: 'redis',
        dialect: 'redis',
        defaultPort: 6379,
        databaseHint: 'Redis 逻辑库序号（0-15）',
    },
};
export const PRESET_ORDER = [
    'mysql',
    'mariadb',
    'oracle',
    'postgres',
    'sqlite',
    'mssql',
    'redis',
];
/** Per-preset display name; dialect labels cannot carry it because mariadb shares 'mysql'. */
export const PRESET_LABEL = {
    mysql: 'MySQL',
    mariadb: 'MariaDB',
    oracle: 'Oracle',
    postgres: 'PostgreSQL',
    sqlite: 'SQLite',
    mssql: 'SQL Server',
    redis: 'Redis',
};
export const SQL_DIALECT_LABEL = {
    mysql: 'MySQL',
    oracle: 'Oracle',
    postgres: 'PostgreSQL',
    sqlite: 'SQLite',
    mssql: 'SQL Server',
};
export const DIALECT_LABEL = {
    ...SQL_DIALECT_LABEL,
    redis: 'Redis',
};
export function presetOf(id) {
    return PRESETS[id];
}
export function isPresetId(value) {
    return value in PRESETS;
}
export function isSqlDialect(value) {
    return value === 'mysql' || value === 'oracle' || value === 'postgres' || value === 'sqlite' || value === 'mssql';
}
//# sourceMappingURL=presets.js.map