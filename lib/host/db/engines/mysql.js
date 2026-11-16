import { DbError, errorMessage } from '../../errors.js';
import { loadTls } from '../../tls.js';
const TYPE_NAMES = {
    0: 'DECIMAL', 1: 'TINYINT', 2: 'SMALLINT', 3: 'INT', 4: 'FLOAT', 5: 'DOUBLE',
    6: 'NULL', 7: 'TIMESTAMP', 8: 'BIGINT', 9: 'MEDIUMINT', 10: 'DATE', 11: 'TIME',
    12: 'DATETIME', 13: 'YEAR', 14: 'DATE', 15: 'VARCHAR', 16: 'BIT', 245: 'JSON',
    246: 'DECIMAL', 247: 'ENUM', 248: 'SET', 249: 'TINYBLOB', 250: 'MEDIUMBLOB',
    251: 'LONGBLOB', 252: 'BLOB', 253: 'VARCHAR', 254: 'CHAR', 255: 'GEOMETRY',
};
function typeName(field) {
    const type = Number(field.type);
    const binary = Number(field.characterSet ?? 63) === 63;
    if (type === 252)
        return binary ? 'BLOB' : 'TEXT';
    if (type === 253)
        return binary ? 'VARBINARY' : 'VARCHAR';
    if (type === 254)
        return binary ? 'BINARY' : 'CHAR';
    return TYPE_NAMES[type] ?? `TYPE_${String(field.type)}`;
}
function cell(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        return value;
    if (typeof value === 'bigint')
        return value.toString();
    if (Buffer.isBuffer(value))
        return `0x${value.subarray(0, 4096).toString('hex')}`;
    if (value instanceof Date)
        return value.toISOString();
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function quoteIdent(name) {
    return `\`${name.replaceAll('`', '``')}\``;
}
function qualified(schema, table) {
    return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}
function connectionOptions(ctx) {
    const tls = loadTls(ctx.connection.tls);
    return {
        host: ctx.endpoint.host,
        port: ctx.endpoint.port,
        user: ctx.connection.user,
        password: ctx.credentials.password,
        ...(ctx.connection.database.trim() === '' ? {} : { database: ctx.connection.database }),
        charset: 'utf8mb4',
        dateStrings: true,
        supportBigNumbers: true,
        bigNumberStrings: true,
        multipleStatements: false,
        connectTimeout: ctx.settings.connectTimeoutSec * 1000,
        ...(tls === undefined
            ? {}
            : {
                ssl: {
                    rejectUnauthorized: tls.rejectUnauthorized,
                    verifyIdentity: tls.verifyIdentity,
                    ...(tls.ca === undefined ? {} : { ca: tls.ca }),
                    ...(tls.cert === undefined ? {} : { cert: tls.cert }),
                    ...(tls.key === undefined ? {} : { key: tls.key }),
                },
            }),
    };
}
function generateDdl(description) {
    const lines = description.columns.map((column) => {
        const parts = [quoteIdent(column.name), column.typeName || 'TEXT'];
        if (column.nullable === false)
            parts.push('NOT NULL');
        if (column.defaultValue !== undefined && column.defaultValue !== '')
            parts.push(`DEFAULT ${column.defaultValue}`);
        return `  ${parts.join(' ')}`;
    });
    const primary = description.indexes.find((index) => index.primary);
    if (primary !== undefined && primary.columns.length > 0) {
        lines.push(`  PRIMARY KEY (${primary.columns.map(quoteIdent).join(', ')})`);
    }
    return `CREATE TABLE ${qualified(description.schema, description.table)} (\n${lines.join(',\n')}\n)`;
}
export const MYSQL_DESCRIPTOR = {
    apiVersion: 1,
    kind: 'mysql',
    label: 'MySQL',
    dialect: 'mysql',
    defaultPort: 3306,
    driverId: 'mysql2',
    capabilities: {
        schemas: true,
        ddl: 'server',
        explain: true,
        transaction: true,
        cancel: true,
        tls: 'optional',
        ssh: true,
    },
};
export class MysqlEngine {
    descriptor = MYSQL_DESCRIPTOR;
    connection;
    context;
    running = new Set();
    async connect(ctx) {
        const mysql = await ctx.drivers.load('mysql2');
        this.context = ctx;
        try {
            this.connection = await mysql.createConnection(connectionOptions(ctx));
            if (ctx.connection.readOnly) {
                await this.connection.query('SET SESSION TRANSACTION READ ONLY').catch(() => undefined);
            }
            const [rows] = await this.connection.query('SELECT VERSION() AS version, DATABASE() AS db, CURRENT_USER() AS user');
            const row = (Array.isArray(rows) ? rows[0] : undefined);
            return {
                product: 'MySQL',
                version: typeof row?.version === 'string' ? row.version : 'unknown',
                ...(typeof row?.user === 'string' ? { user: row.user } : {}),
                ...(typeof row?.db === 'string' ? { database: row.db } : {}),
                url: `${ctx.endpoint.host}:${ctx.endpoint.port}`,
            };
        }
        catch (error) {
            this.connection = undefined;
            throw new DbError('connect-failed', `MySQL 连接失败：${errorMessage(error)}`);
        }
    }
    requireConnection() {
        if (this.connection === undefined)
            throw new DbError('not-connected', 'MySQL 连接尚未打开');
        return this.connection;
    }
    async disconnect() {
        const connection = this.connection;
        this.connection = undefined;
        if (connection !== undefined)
            await connection.end().catch(() => undefined);
    }
    isOpen() {
        return this.connection !== undefined;
    }
    async ping() {
        const [rows] = await this.requireConnection().query('SELECT VERSION() AS version');
        const row = (Array.isArray(rows) ? rows[0] : undefined);
        return { ok: true, ...(typeof row?.version === 'string' ? { version: row.version } : {}) };
    }
    async listSchemas(filter = '') {
        const [rows] = await this.requireConnection().query('SELECT SCHEMA_NAME AS name FROM information_schema.schemata ORDER BY SCHEMA_NAME');
        const list = (Array.isArray(rows) ? rows : []);
        const needle = filter.trim().toLowerCase();
        return list
            .filter((row) => typeof row.name === 'string' && (needle === '' || row.name.toLowerCase().includes(needle)))
            .map((row) => ({
            name: String(row.name),
            system: ['information_schema', 'mysql', 'performance_schema', 'sys'].includes(String(row.name)),
        }));
    }
    async listObjects(schema) {
        const [rows] = await this.requireConnection().query(`SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_COMMENT AS comment
       FROM information_schema.tables WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`, [schema]);
        const list = (Array.isArray(rows) ? rows : []);
        return list
            .filter((row) => typeof row.name === 'string')
            .map((row) => ({
            name: String(row.name),
            kind: String(row.type).toUpperCase().includes('VIEW') ? 'view' : 'table',
            ...(typeof row.comment === 'string' && row.comment !== '' ? { comment: row.comment } : {}),
        }));
    }
    async setSchema(schema) {
        await this.requireConnection().query(`USE ${quoteIdent(schema)}`);
    }
    async describe(schema, table, kind) {
        if (kind !== 'table' && kind !== 'view')
            return { schema, table, kind, columns: [], indexes: [] };
        const connection = this.requireConnection();
        const [columnRows] = await connection.query(`SELECT COLUMN_NAME AS name, COLUMN_TYPE AS typeName, IS_NULLABLE AS nullable,
              COLUMN_DEFAULT AS defaultValue, COLUMN_COMMENT AS comment,
              ORDINAL_POSITION AS ordinal, COLUMN_KEY AS columnKey
       FROM information_schema.columns
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`, [schema, table]);
        const columns = (Array.isArray(columnRows) ? columnRows : []).map((row) => ({
            name: String(row.name),
            typeName: String(row.typeName ?? ''),
            nullable: row.nullable !== 'NO',
            ...(row.defaultValue === null || row.defaultValue === undefined ? {} : { defaultValue: String(row.defaultValue) }),
            ...(typeof row.comment === 'string' && row.comment !== '' ? { comment: row.comment } : {}),
            ...(typeof row.ordinal === 'number' ? { ordinal: row.ordinal } : {}),
            ...(row.columnKey === 'PRI' ? { primaryKey: true } : {}),
        }));
        const [indexRows] = await connection.query(`SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName
       FROM information_schema.statistics
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`, [schema, table]);
        const byName = new Map();
        for (const row of (Array.isArray(indexRows) ? indexRows : [])) {
            const name = String(row.name);
            const existing = byName.get(name);
            const entry = existing ?? { name, columns: [], unique: Number(row.nonUnique) === 0, primary: name === 'PRIMARY' };
            entry.columns.push(String(row.columnName));
            byName.set(name, entry);
        }
        return { schema, table, kind, columns, indexes: [...byName.values()] };
    }
    async ddl(schema, table, kind) {
        if (kind === 'table' || kind === 'view') {
            const statement = kind === 'view' ? `SHOW CREATE VIEW ${qualified(schema, table)}` : `SHOW CREATE TABLE ${qualified(schema, table)}`;
            try {
                const [rows] = await this.requireConnection().query(statement);
                const row = (Array.isArray(rows) ? rows[0] : undefined);
                const ddl = row === undefined
                    ? ''
                    : Object.values(row)
                        .filter((value) => typeof value === 'string')
                        .reduce((longest, value) => (value.length > longest.length ? value : longest), '');
                if (ddl.trim() !== '')
                    return { schema, table, kind, ddl, source: 'server', warnings: [] };
            }
            catch (error) {
                // fall through to a generated statement
                void error;
            }
            const description = await this.describe(schema, table, kind);
            return {
                schema,
                table,
                kind,
                ddl: generateDdl(description),
                source: 'generated',
                warnings: ['服务器没有返回 DDL，已按结构生成'],
            };
        }
        throw new DbError('unsupported', `暂不支持查看${kind}的 DDL`);
    }
    async query(sql, options) {
        const started = Date.now();
        const connection = this.requireConnection();
        const maxRows = Math.max(1, Math.min(options.maxRows ?? 200, 5000));
        const timeout = Math.max(1, options.timeoutSec ?? 30) * 1000;
        if (options.stmtKey !== undefined)
            this.running.add(options.stmtKey);
        try {
            const [rows, fields] = await connection.query({ sql, timeout });
            const elapsedMs = Date.now() - started;
            if (!Array.isArray(rows)) {
                const header = rows;
                return {
                    columns: [],
                    rows: [],
                    rowCount: 0,
                    truncated: false,
                    updateCount: typeof header.affectedRows === 'number' ? header.affectedRows : 0,
                    elapsedMs,
                    warnings: [],
                    sql,
                    ...(options.stmtKey === undefined ? {} : { stmtKey: options.stmtKey }),
                };
            }
            const list = rows;
            const shown = list.slice(0, maxRows);
            const columns = (fields ?? []).map((field) => ({
                name: field.name,
                typeName: typeName(field),
                nullable: (Number(field.flags) & 1) === 0,
            }));
            return {
                columns,
                rows: shown.map((row) => columns.map((column) => cell(row[column.name]))),
                rowCount: shown.length,
                truncated: list.length > maxRows,
                elapsedMs,
                warnings: [],
                sql,
                ...(options.stmtKey === undefined ? {} : { stmtKey: options.stmtKey }),
            };
        }
        catch (error) {
            throw new DbError('query-failed', `MySQL 查询失败：${errorMessage(error)}`);
        }
        finally {
            if (options.stmtKey !== undefined)
                this.running.delete(options.stmtKey);
        }
    }
    async explain(sql) {
        const plan = await this.query(`EXPLAIN ${sql}`, { maxRows: 500 });
        return { dialect: 'mysql', statements: [`EXPLAIN ${sql}`], plan, warnings: [] };
    }
    async transaction(action) {
        const connection = this.requireConnection();
        if (action === 'begin')
            await connection.beginTransaction();
        else if (action === 'commit')
            await connection.commit();
        else
            await connection.rollback();
    }
    async cancel(stmtKey) {
        // A stale key (the statement already finished) must never touch the shared
        // connection: several tabs can run on the same session.
        if (!this.running.has(stmtKey))
            return false;
        const connection = this.connection;
        if (connection === undefined)
            return false;
        const ctx = this.context;
        const threadId = connection.threadId;
        if (ctx === undefined || typeof threadId !== 'number' || threadId <= 0) {
            this.dropConnection(connection);
            return true;
        }
        try {
            // The driver's single connection cannot issue KILL while it is busy, so a
            // short-lived control connection cancels just this query and leaves the
            // session (tables and consoles sharing it) usable.
            const mysql = await ctx.drivers.load('mysql2');
            const control = await mysql.createConnection(connectionOptions(ctx));
            try {
                await control.query('KILL QUERY ?', [threadId]);
            }
            finally {
                await control.end().catch(() => undefined);
            }
            return true;
        }
        catch {
            // Without a control connection dropping the query's connection is the only
            // way to stop it; connect() reopens the session on next use.
            this.dropConnection(connection);
            return true;
        }
    }
    dropConnection(connection) {
        connection.destroy();
        if (this.connection === connection)
            this.connection = undefined;
    }
}
//# sourceMappingURL=mysql.js.map