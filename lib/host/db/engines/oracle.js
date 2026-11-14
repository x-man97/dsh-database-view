import { DbError, errorMessage } from '../../errors.js';
function pick(row, name) {
    return row[name] ?? row[name.toUpperCase()] ?? row[name.toLowerCase()];
}
function quoteIdent(name) {
    return `"${name.replaceAll('"', '""')}"`;
}
function quoteLiteral(value) {
    return `'${value.replaceAll("'", "''")}'`;
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
function generateDdl(description) {
    const lines = description.columns.map((column) => {
        const parts = [quoteIdent(column.name), column.typeName || 'VARCHAR2(255)'];
        if (column.nullable === false)
            parts.push('NOT NULL');
        return `  ${parts.join(' ')}`;
    });
    const primary = description.indexes.find((index) => index.primary);
    if (primary !== undefined && primary.columns.length > 0)
        lines.push(`  PRIMARY KEY (${primary.columns.map(quoteIdent).join(', ')})`);
    return `CREATE TABLE ${quoteIdent(description.schema)}.${quoteIdent(description.table)} (\n${lines.join(',\n')}\n)`;
}
export class OracleEngine {
    descriptor = {
        apiVersion: 1,
        kind: 'oracle',
        label: 'Oracle',
        dialect: 'oracle',
        defaultPort: 1521,
        driverId: 'oracledb-thin',
        capabilities: { schemas: true, ddl: 'server', explain: true, transaction: true, cancel: true, tls: 'none', ssh: true },
    };
    connection;
    oracledb;
    async connect(ctx) {
        const loaded = await ctx.drivers.load('oracledb-thin');
        const oracledb = (loaded.default ?? loaded);
        oracledb.fetchAsString = [oracledb.DATE, oracledb.NUMBER, oracledb.CLOB];
        this.oracledb = oracledb;
        const connectString = `${ctx.endpoint.host}:${ctx.endpoint.port}/${ctx.connection.database}`;
        try {
            this.connection = await oracledb.getConnection({
                user: ctx.connection.user,
                password: ctx.credentials.password,
                connectString,
            });
            let version = 'unknown';
            try {
                const result = await this.connection.execute("SELECT banner AS version FROM v$version WHERE ROWNUM = 1");
                const row = (result.rows?.[0] ?? []);
                version = String(row[0] ?? 'unknown').split('\n')[0];
            }
            catch {
                try {
                    const result = await this.connection.execute("SELECT version FROM product_component_version WHERE product LIKE 'Oracle Database%' AND ROWNUM = 1");
                    const row = (result.rows?.[0] ?? []);
                    version = String(row[0] ?? 'unknown');
                }
                catch {
                    // keep unknown; the user may lack v$version privileges
                }
            }
            return {
                product: 'Oracle',
                version,
                user: ctx.connection.user,
                database: ctx.connection.database,
                url: connectString,
            };
        }
        catch (error) {
            await this.connection?.close().catch(() => undefined);
            this.connection = undefined;
            throw new DbError('connect-failed', `Oracle 连接失败：${errorMessage(error)}`);
        }
    }
    requireConnection() {
        if (this.connection === undefined)
            throw new DbError('not-connected', 'Oracle 连接尚未打开');
        return this.connection;
    }
    async disconnect() {
        const connection = this.connection;
        this.connection = undefined;
        if (connection !== undefined)
            await connection.close().catch(() => undefined);
    }
    async ping() {
        const result = await this.requireConnection().execute("SELECT banner AS version FROM v$version WHERE ROWNUM = 1");
        const rows = result.rows;
        return { ok: true, ...(rows?.[0] === undefined ? {} : { version: String(rows[0][0]) }) };
    }
    async listSchemas(filter = '') {
        const result = await this.requireConnection().execute('SELECT username AS name FROM all_users ORDER BY username', [], { outFormat: this.oracledb?.OUT_FORMAT_OBJECT ?? 4002 });
        const needle = filter.trim().toLowerCase();
        return result.rows
            .map((row) => String(pick(row, 'NAME')))
            .filter((name) => needle === '' || name.toLowerCase().includes(needle))
            .map((name) => ({
            name,
            system: /^(SYS|SYSTEM|AUDSYS|DBSNMP|OUTLN|APPQOSSYS|GSMADMIN_INTERNAL|DBSFWUSER|DVF|DVSYS|GGSYS|GSMCATUSER|GSMUSER|LBACSYS|MDSYS|OJVMSYS|OLAPSYS|ORDDATA|ORDSYS|REMOTE_SCHEDULER_AGENT|SI_INFORMTN_SCHEMA|SYS$UMF|SYSBACKUP|SYSDG|SYSKM|SYSRAC|WMSYS|XDB)$/i.test(name),
        }));
    }
    async listObjects(schema) {
        const result = await this.requireConnection().execute(`SELECT object_name AS name, object_type AS type FROM all_objects
       WHERE owner = :owner_name AND object_type IN ('TABLE','VIEW','PROCEDURE','FUNCTION','SEQUENCE','TRIGGER')
       ORDER BY object_name`, { owner_name: schema }, { outFormat: this.oracledb?.OUT_FORMAT_OBJECT ?? 4002 });
        return result.rows
            .filter((row) => !String(pick(row, 'NAME') ?? '').startsWith('ISEQ$$_'))
            .map((row) => {
            const type = String(pick(row, 'TYPE') ?? '');
            return {
                name: String(pick(row, 'NAME')),
                kind: type === 'TABLE' ? 'table' : type === 'VIEW' ? 'view' : type.toLowerCase(),
            };
        });
    }
    async setSchema(schema) {
        await this.requireConnection().execute(`ALTER SESSION SET CURRENT_SCHEMA = ${quoteIdent(schema)}`);
    }
    async describe(schema, table, kind) {
        if (kind !== 'table' && kind !== 'view')
            return { schema, table, kind, columns: [], indexes: [] };
        const connection = this.requireConnection();
        const columns = await connection.execute(`SELECT column_name, data_type, data_length, data_precision, data_scale, nullable, data_default, column_id
       FROM all_tab_columns WHERE owner = :owner_name AND table_name = :table_name ORDER BY column_id`, { owner_name: schema, table_name: table }, { outFormat: this.oracledb?.OUT_FORMAT_OBJECT ?? 4002 });
        const indexes = await connection.execute(`SELECT i.index_name, i.uniqueness, i.index_type, c.column_name, c.column_position
       FROM all_indexes i JOIN all_ind_columns c ON c.index_owner = i.owner AND c.index_name = i.index_name
       WHERE i.table_owner = :owner_name AND i.table_name = :table_name ORDER BY i.index_name, c.column_position`, { owner_name: schema, table_name: table }, { outFormat: this.oracledb?.OUT_FORMAT_OBJECT ?? 4002 });
        const primary = await connection.execute(`SELECT cc.column_name FROM all_constraints c JOIN all_cons_columns cc
       ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
       WHERE c.owner = :owner_name AND c.table_name = :table_name AND c.constraint_type = 'P'`, { owner_name: schema, table_name: table }, { outFormat: this.oracledb?.OUT_FORMAT_OBJECT ?? 4002 });
        const primaryColumns = new Set(primary.rows.map((row) => String(pick(row, 'COLUMN_NAME'))));
        const byName = new Map();
        for (const row of indexes.rows) {
            const name = String(pick(row, 'INDEX_NAME'));
            const entry = byName.get(name) ?? { name, columns: [], unique: pick(row, 'UNIQUENESS') === 'UNIQUE', primary: false };
            entry.columns.push(String(pick(row, 'COLUMN_NAME')));
            byName.set(name, entry);
        }
        const primaryIndex = [...byName.values()].find((index) => index.columns.every((column) => primaryColumns.has(column)) && primaryColumns.size > 0);
        if (primaryIndex !== undefined)
            primaryIndex.primary = true;
        return {
            schema,
            table,
            kind,
            columns: columns.rows.map((row) => {
                const precision = pick(row, 'DATA_PRECISION');
                const scale = pick(row, 'DATA_SCALE');
                return {
                    name: String(pick(row, 'COLUMN_NAME')),
                    typeName: String(pick(row, 'DATA_TYPE') ?? '') + (precision === null || precision === undefined ? '' : `(${String(precision)}${scale === null || scale === undefined ? '' : `,${String(scale)}`})`),
                    nullable: pick(row, 'NULLABLE') === 'Y',
                    ...(pick(row, 'DATA_DEFAULT') === null || pick(row, 'DATA_DEFAULT') === undefined ? {} : { defaultValue: String(pick(row, 'DATA_DEFAULT')) }),
                    ...(typeof pick(row, 'COLUMN_ID') === 'number' ? { ordinal: Number(pick(row, 'COLUMN_ID')) } : {}),
                    ...(primaryColumns.has(String(pick(row, 'COLUMN_NAME'))) ? { primaryKey: true } : {}),
                };
            }),
            indexes: [...byName.values()],
        };
    }
    async ddl(schema, table, kind) {
        const objectType = kind === 'table' ? 'TABLE' : kind === 'view' ? 'VIEW' : kind.toUpperCase();
        try {
            const result = await this.requireConnection().execute(`SELECT DBMS_METADATA.GET_DDL(${quoteLiteral(objectType)}, ${quoteLiteral(table)}, ${quoteLiteral(schema)}) AS ddl FROM DUAL`, [], { outFormat: this.oracledb?.OUT_FORMAT_OBJECT ?? 4002 });
            const first = result.rows?.[0];
            const ddl = Array.isArray(first) ? String(first[0] ?? '') : String(first?.DDL ?? '');
            if (ddl !== '')
                return { schema, table, kind, ddl, source: 'server', warnings: [] };
        }
        catch {
            // fall through
        }
        const description = await this.describe(schema, table, kind);
        return { schema, table, kind, ddl: generateDdl(description), source: 'generated', warnings: ['DBMS_METADATA 没有返回 DDL，已按结构生成'] };
    }
    async query(sql, options) {
        const started = Date.now();
        const maxRows = Math.max(1, Math.min(options.maxRows ?? 200, 5000));
        try {
            const result = await this.requireConnection().execute(sql, [], { maxRows, outFormat: this.oracledb?.OUT_FORMAT_OBJECT ?? 4002 });
            const meta = result.metaData ?? [];
            if (!Array.isArray(result.rows) || meta.length === 0) {
                return { columns: [], rows: [], rowCount: 0, truncated: false, updateCount: result.rowsAffected ?? 0, elapsedMs: Date.now() - started, warnings: [], sql, ...(options.stmtKey === undefined ? {} : { stmtKey: options.stmtKey }) };
            }
            const rows = result.rows;
            return {
                columns: meta.map((column) => ({ name: column.name, typeName: column.dbTypeName ?? '' })),
                rows: rows.map((row) => meta.map((column) => cell(pick(row, column.name)))),
                rowCount: rows.length,
                truncated: rows.length >= maxRows,
                elapsedMs: Date.now() - started,
                warnings: [],
                sql,
                ...(options.stmtKey === undefined ? {} : { stmtKey: options.stmtKey }),
            };
        }
        catch (error) {
            throw new DbError('query-failed', `Oracle 查询失败：${errorMessage(error)}`);
        }
    }
    async explain(sql) {
        const statements = [`EXPLAIN PLAN FOR ${sql}`, "SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, NULL, 'BASIC'))"];
        await this.requireConnection().execute(`EXPLAIN PLAN FOR ${sql}`);
        const plan = await this.query(statements[1], { maxRows: 500 });
        return { dialect: 'oracle', statements, plan, warnings: [] };
    }
    async transaction(action) {
        const connection = this.requireConnection();
        if (action === 'begin')
            return;
        if (action === 'commit')
            await connection.commit();
        else
            await connection.rollback();
    }
    async cancel() {
        const connection = this.connection;
        if (connection === undefined)
            return false;
        const breakFn = connection.break;
        if (typeof breakFn === 'function')
            await breakFn.call(connection);
        return true;
    }
}
//# sourceMappingURL=oracle.js.map