import { DbError, errorMessage } from '../../errors.js';
import { loadTls } from '../../tls.js';
function quoteIdent(name) {
    return `[${name.replaceAll(']', ']]')}]`;
}
function cell(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        return value;
    if (typeof value === 'bigint')
        return value.toString();
    if (value instanceof Date)
        return value.toISOString();
    if (Buffer.isBuffer(value))
        return `0x${value.subarray(0, 4096).toString('hex')}`;
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
export class MssqlEngine {
    descriptor = {
        apiVersion: 1,
        kind: 'mssql',
        label: 'SQL Server',
        dialect: 'mssql',
        defaultPort: 1433,
        driverId: 'tedious',
        capabilities: { schemas: true, ddl: 'generated', explain: true, transaction: true, cancel: true, tls: 'optional', ssh: true },
    };
    connection;
    request;
    tedious;
    async connect(ctx) {
        const tedious = await ctx.drivers.load('tedious');
        const tlsConfig = ctx.connection.tls;
        const tls = loadTls(tlsConfig);
        this.tedious = tedious;
        const connection = new tedious.Connection({
            server: ctx.endpoint.host,
            authentication: { type: 'default', options: { userName: ctx.connection.user, password: ctx.credentials.password } },
            options: {
                port: ctx.endpoint.port,
                ...(ctx.connection.database.trim() === '' ? {} : { database: ctx.connection.database }),
                encrypt: tlsConfig !== undefined && tlsConfig.mode !== 'disable',
                trustServerCertificate: tlsConfig?.allowInvalidHostname === true || tlsConfig?.mode === 'require',
                serverName: tlsConfig?.servername ?? ctx.connection.host,
                ...(tls === undefined
                    ? {}
                    : {
                        cryptoCredentialsDetails: {
                            ...(tls.ca === undefined ? {} : { ca: tls.ca }),
                            ...(tls.cert === undefined ? {} : { cert: tls.cert }),
                            ...(tls.key === undefined ? {} : { key: tls.key }),
                        },
                    }),
                connectTimeout: ctx.settings.connectTimeoutSec * 1000,
                requestTimeout: ctx.settings.queryTimeoutSec * 1000,
                rowCollectionOnRequestCompletion: true,
            },
        });
        try {
            await new Promise((resolve, reject) => {
                connection.connect((error) => (error === undefined || error === null ? resolve() : reject(error)));
                connection.once('error', reject);
            });
            this.connection = connection;
            const result = await this.run('SELECT @@VERSION AS version, DB_NAME() AS db, SUSER_SNAME() AS username');
            const row = result.rows[0];
            return {
                product: 'SQL Server',
                version: String(row?.[0] ?? 'unknown').split('\n')[0],
                ...(row?.[2] === undefined ? {} : { user: String(row[2]) }),
                ...(row?.[1] === undefined ? {} : { database: String(row[1]) }),
                url: `${ctx.endpoint.host}:${ctx.endpoint.port}`,
            };
        }
        catch (error) {
            connection.close();
            throw new DbError('connect-failed', `SQL Server 连接失败：${errorMessage(error)}`);
        }
    }
    requireConnection() {
        if (this.connection === undefined)
            throw new DbError('not-connected', 'SQL Server 连接尚未打开');
        return this.connection;
    }
    run(sql) {
        return new Promise((resolve, reject) => {
            const columns = [];
            const rows = [];
            const tedious = this.tedious;
            if (tedious === undefined)
                throw new Error('tedious not loaded');
            const request = new tedious.Request(sql, (error, rowCount) => {
                this.request = undefined;
                if (error !== undefined && error !== null)
                    reject(error);
                else
                    resolve({ columns, rows, rowCount: rowCount ?? 0 });
            });
            this.request = request;
            const evented = request;
            evented.on('columnMetadata', (metadata) => {
                columns.splice(0, columns.length, ...metadata.map((column) => ({ name: column.colName, typeName: column.type?.name ?? '' })));
            });
            evented.on('row', (cells) => {
                rows.push(cells.map((value) => cell(value.value)));
            });
            this.requireConnection().execSql(request);
        });
    }
    async disconnect() {
        const connection = this.connection;
        this.connection = undefined;
        this.request = undefined;
        connection?.close();
    }
    isOpen() {
        return this.connection !== undefined;
    }
    async ping() {
        const result = await this.run('SELECT @@VERSION AS version');
        return { ok: true, ...(result.rows[0]?.[0] === undefined ? {} : { version: String(result.rows[0][0]) }) };
    }
    async listSchemas(filter = '') {
        const result = await this.run("SELECT name FROM sys.schemas WHERE name NOT IN ('sys','INFORMATION_SCHEMA','guest') AND name NOT LIKE 'db[_]%' ORDER BY name");
        const needle = filter.trim().toLowerCase();
        return result.rows
            .map((row) => String(row[0]))
            .filter((name) => needle === '' || name.toLowerCase().includes(needle))
            .map((name) => ({ name }));
    }
    async listObjects(schema) {
        const result = await this.run(`SELECT o.name, o.type FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE s.name = ${quoteLiteral(schema)} AND o.type IN ('U','V','P','FN','IF','TF','TR') ORDER BY o.name`);
        return result.rows.map((row) => ({
            name: String(row[0]),
            kind: String(row[1]).trim() === 'V' ? 'view' : String(row[1]).trim() === 'U' ? 'table' : 'procedure',
        }));
    }
    async setSchema(schema) {
        await this.run(`USE ${quoteIdent(schema)}`);
    }
    async describe(schema, table, kind) {
        if (kind !== 'table' && kind !== 'view')
            return { schema, table, kind, columns: [], indexes: [] };
        const columns = await this.run(`SELECT c.name, t.name AS type, c.is_nullable, c.column_id,
              OBJECT_DEFINITION(c.default_object_id) AS default_value
       FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
       JOIN sys.objects o ON o.object_id = c.object_id JOIN sys.schemas s ON s.schema_id = o.schema_id
       WHERE s.name = ${quoteLiteral(schema)} AND o.name = ${quoteLiteral(table)} ORDER BY c.column_id`);
        const indexes = await this.run(`SELECT i.name, i.is_unique, i.is_primary_key, COL_NAME(ic.object_id, ic.column_id) AS column_name
       FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
       JOIN sys.objects o ON o.object_id = i.object_id JOIN sys.schemas s ON s.schema_id = o.schema_id
       WHERE s.name = ${quoteLiteral(schema)} AND o.name = ${quoteLiteral(table)}
       ORDER BY i.name, ic.key_ordinal`);
        const byName = new Map();
        for (const row of indexes.rows) {
            const name = String(row[0]);
            const entry = byName.get(name) ?? { name, columns: [], unique: Boolean(row[1]), primary: Boolean(row[2]) };
            if (row[3] !== null && row[3] !== undefined)
                entry.columns.push(String(row[3]));
            byName.set(name, entry);
        }
        return {
            schema,
            table,
            kind,
            columns: columns.rows.map((row) => ({
                name: String(row[0]),
                typeName: String(row[1]),
                nullable: Boolean(row[2]),
                ...(row[4] === null || row[4] === undefined ? {} : { defaultValue: String(row[4]) }),
                ...(typeof row[3] === 'number' ? { ordinal: row[3] } : {}),
            })),
            indexes: [...byName.values()],
        };
    }
    async ddl(schema, table, kind) {
        const result = await this.run(`SELECT OBJECT_DEFINITION(OBJECT_ID(${quoteLiteral(`${schema}.${table}`)})) AS ddl`);
        const ddl = String(result.rows[0]?.[0] ?? '');
        if (ddl !== '')
            return { schema, table, kind, ddl, source: 'server', warnings: [] };
        const description = await this.describe(schema, table, kind);
        return { schema, table, kind, ddl: generateDdl(description), source: 'generated', warnings: ['SQL Server 没有返回 DDL，已按结构生成'] };
    }
    async query(sql, options) {
        const started = Date.now();
        const result = await this.run(sql);
        const maxRows = Math.max(1, Math.min(options.maxRows ?? 200, 5000));
        const shown = result.rows.slice(0, maxRows);
        return {
            columns: result.columns,
            rows: shown,
            rowCount: shown.length,
            truncated: result.rows.length > maxRows,
            ...(result.columns.length === 0 ? { updateCount: result.rowCount } : {}),
            elapsedMs: Date.now() - started,
            warnings: [],
            sql,
            ...(options.stmtKey === undefined ? {} : { stmtKey: options.stmtKey }),
        };
    }
    async explain(sql) {
        await this.run('SET SHOWPLAN_ALL ON');
        try {
            const plan = await this.query(sql, { maxRows: 500 });
            return { dialect: 'mssql', statements: ['SET SHOWPLAN_ALL ON', sql], plan, warnings: [] };
        }
        finally {
            await this.run('SET SHOWPLAN_ALL OFF').catch(() => undefined);
        }
    }
    async transaction(action) {
        if (action === 'begin')
            await this.run('BEGIN TRANSACTION');
        else if (action === 'commit')
            await this.run('COMMIT TRANSACTION');
        else
            await this.run('ROLLBACK TRANSACTION');
    }
    async cancel() {
        const request = this.request;
        if (request === undefined)
            return false;
        request.cancel();
        return true;
    }
}
function quoteLiteral(value) {
    return `'${value.replaceAll("'", "''")}'`;
}
function generateDdl(description) {
    const lines = description.columns.map((column) => {
        const parts = [quoteIdent(column.name), column.typeName || 'nvarchar(255)'];
        if (column.nullable === false)
            parts.push('NOT NULL');
        return `  ${parts.join(' ')}`;
    });
    const primary = description.indexes.find((index) => index.primary);
    if (primary !== undefined && primary.columns.length > 0)
        lines.push(`  PRIMARY KEY (${primary.columns.map(quoteIdent).join(', ')})`);
    return `CREATE TABLE ${quoteIdent(description.schema)}.${quoteIdent(description.table)} (\n${lines.join(',\n')}\n)`;
}
//# sourceMappingURL=mssql.js.map