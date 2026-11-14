import { DatabaseSync } from 'node:sqlite';
import { DbError, errorMessage } from '../../errors.js';
function quoteIdent(name) {
    return `"${name.replaceAll('"', '""')}"`;
}
function cell(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        return value;
    if (typeof value === 'bigint')
        return value.toString();
    if (value instanceof Uint8Array)
        return `0x${Buffer.from(value).subarray(0, 4096).toString('hex')}`;
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
export class SqliteEngine {
    descriptor = {
        apiVersion: 1,
        kind: 'sqlite',
        label: 'SQLite',
        dialect: 'sqlite',
        defaultPort: 0,
        driverId: 'node:sqlite',
        capabilities: { schemas: false, ddl: 'server', explain: true, transaction: true, cancel: false, tls: 'none', ssh: false },
    };
    db;
    async connect(ctx) {
        const file = ctx.connection.database.trim();
        if (file === '')
            throw new DbError('connect-failed', 'SQLite 需要数据库文件路径');
        try {
            const db = new DatabaseSync(file, { readOnly: ctx.connection.readOnly });
            db.exec('PRAGMA busy_timeout = 5000');
            if (ctx.connection.readOnly)
                db.exec('PRAGMA query_only = ON');
            this.db = db;
            const row = db.prepare('select sqlite_version() as version').get();
            return { product: 'SQLite', version: row?.version ?? 'unknown', database: file, url: file };
        }
        catch (error) {
            throw new DbError('connect-failed', `SQLite 打开失败：${errorMessage(error)}`);
        }
    }
    requireDb() {
        if (this.db === undefined)
            throw new DbError('not-connected', 'SQLite 连接尚未打开');
        return this.db;
    }
    async disconnect() {
        const db = this.db;
        this.db = undefined;
        try {
            db?.close();
        }
        catch {
            // already closed
        }
    }
    async ping() {
        const row = this.requireDb().prepare('select sqlite_version() as version').get();
        return { ok: true, ...(row?.version === undefined ? {} : { version: row.version }) };
    }
    async listSchemas() {
        return [{ name: 'main' }];
    }
    async listObjects(_schema) {
        const rows = this.requireDb().prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
        return rows.map((row) => ({ name: row.name, kind: row.type === 'view' ? 'view' : 'table' }));
    }
    async setSchema() {
        // SQLite has a single main schema.
    }
    async describe(_schema, table, kind) {
        if (kind !== 'table' && kind !== 'view')
            return { schema: 'main', table, kind, columns: [], indexes: [] };
        const db = this.requireDb();
        const columns = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all();
        const indexes = db.prepare(`PRAGMA index_list(${quoteIdent(table)})`).all();
        const indexInfos = [];
        for (const index of indexes) {
            const name = String(index.name);
            const info = db.prepare(`PRAGMA index_info(${quoteIdent(name)})`).all();
            indexInfos.push({ name, columns: info.map((row) => String(row.name)), unique: Number(index.unique) === 1 });
        }
        const primary = columns.filter((row) => Number(row.pk) > 0).map((row) => String(row.name));
        if (primary.length > 0)
            indexInfos.push({ name: 'PRIMARY', columns: primary, primary: true, unique: true });
        return {
            schema: 'main',
            table,
            kind,
            columns: columns.map((row) => ({
                name: String(row.name),
                typeName: String(row.type ?? ''),
                nullable: Number(row.notnull) === 0,
                ...(row.dflt_value === null || row.dflt_value === undefined ? {} : { defaultValue: String(row.dflt_value) }),
                ...(Number(row.pk) > 0 ? { primaryKey: true } : {}),
            })),
            indexes: indexInfos,
        };
    }
    async ddl(_schema, table, kind) {
        const row = this.requireDb().prepare("SELECT sql FROM sqlite_master WHERE type = ? AND name = ?").get(kind === 'view' ? 'view' : 'table', table);
        const ddl = row?.sql ?? '';
        if (ddl !== '')
            return { schema: 'main', table, kind, ddl, source: 'server', warnings: [] };
        throw new DbError('unsupported', `SQLite 没有找到 ${table} 的定义`);
    }
    async query(sql, options) {
        const started = Date.now();
        const maxRows = Math.max(1, Math.min(options.maxRows ?? 200, 5000));
        try {
            const db = this.requireDb();
            const statement = db.prepare(sql);
            const read = /^\s*(select|with|pragma|explain)\b/i.test(sql);
            const elapsedMs = () => Date.now() - started;
            if (!read) {
                const result = statement.run();
                return { columns: [], rows: [], rowCount: 0, truncated: false, updateCount: Number(result.changes ?? 0), elapsedMs: elapsedMs(), warnings: [], sql, ...(options.stmtKey === undefined ? {} : { stmtKey: options.stmtKey }) };
            }
            const rows = statement.all();
            const shown = rows.slice(0, maxRows);
            const names = (typeof statement.columns === 'function'
                ? statement.columns()
                : Object.keys(rows[0] ?? {}).map((name) => ({ name })));
            return {
                columns: names.map((column) => ({ name: column.name, typeName: column.type ?? '' })),
                rows: shown.map((row) => names.map((column) => cell(row[column.name]))),
                rowCount: shown.length,
                truncated: rows.length > maxRows,
                elapsedMs: elapsedMs(),
                warnings: [],
                sql,
                ...(options.stmtKey === undefined ? {} : { stmtKey: options.stmtKey }),
            };
        }
        catch (error) {
            throw new DbError('query-failed', `SQLite 查询失败：${errorMessage(error)}`);
        }
    }
    async explain(sql) {
        const plan = await this.query(`EXPLAIN QUERY PLAN ${sql}`, { maxRows: 500 });
        return { dialect: 'sqlite', statements: [`EXPLAIN QUERY PLAN ${sql}`], plan, warnings: [] };
    }
    async transaction(action) {
        const db = this.requireDb();
        if (action === 'begin')
            db.exec('BEGIN');
        else if (action === 'commit')
            db.exec('COMMIT');
        else
            db.exec('ROLLBACK');
    }
    async cancel() {
        return false;
    }
}
//# sourceMappingURL=sqlite.js.map