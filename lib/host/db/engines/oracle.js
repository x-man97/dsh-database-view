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
function columnType(row) {
    const type = String(pick(row, 'DATA_TYPE') ?? '');
    const numeric = (value) => {
        if (typeof value === 'number' && Number.isFinite(value))
            return value;
        if (typeof value === 'string' && /^\d+$/.test(value.trim()))
            return Number(value);
        return undefined;
    };
    const precision = numeric(pick(row, 'DATA_PRECISION'));
    const scale = numeric(pick(row, 'DATA_SCALE'));
    if (precision !== undefined) {
        return `${type}(${String(precision)}${scale === undefined ? '' : `,${String(scale)}`})`;
    }
    if (/^(?:N?VARCHAR2|N?CHAR|RAW)$/i.test(type)) {
        const length = numeric(pick(row, 'CHAR_LENGTH')) ?? numeric(pick(row, 'DATA_LENGTH'));
        if (length !== undefined)
            return `${type}(${String(length)})`;
    }
    return type;
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
    isOpen() {
        return this.connection !== undefined;
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
        const binds = { owner_name: schema, table_name: table };
        const options = { outFormat: this.oracledb?.OUT_FORMAT_OBJECT ?? 4002 };
        const columns = await connection.execute(`SELECT column_name, data_type, data_length, char_length, data_precision, data_scale, nullable, data_default, column_id
       FROM all_tab_columns WHERE owner = :owner_name AND table_name = :table_name ORDER BY column_id`, binds, options);
        const indexes = await connection.execute(`SELECT i.index_name, i.uniqueness, i.index_type, c.column_name, c.column_position
       FROM all_indexes i JOIN all_ind_columns c ON c.index_owner = i.owner AND c.index_name = i.index_name
       WHERE i.table_owner = :owner_name AND i.table_name = :table_name ORDER BY i.index_name, c.column_position`, binds, options);
        const constraints = await connection.execute(`SELECT c.constraint_name, c.constraint_type, cc.column_name, cc.position
       FROM all_constraints c JOIN all_cons_columns cc
       ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
       WHERE c.owner = :owner_name AND c.table_name = :table_name AND c.constraint_type IN ('P','U')
       ORDER BY c.constraint_name, cc.position`, binds, options);
        const primaryName = { value: '' };
        const primaryColumns = [];
        const uniqueConstraints = [];
        for (const row of constraints.rows) {
            const name = String(pick(row, 'CONSTRAINT_NAME'));
            const column = String(pick(row, 'COLUMN_NAME'));
            if (String(pick(row, 'CONSTRAINT_TYPE')) === 'P') {
                primaryName.value = name;
                primaryColumns.push(column);
            }
            else {
                let entry = uniqueConstraints.find((item) => item.name === name);
                if (entry === undefined) {
                    entry = { name, columns: [] };
                    uniqueConstraints.push(entry);
                }
                entry.columns.push(column);
            }
        }
        const identityColumns = new Set();
        try {
            const identities = await connection.execute('SELECT column_name FROM all_tab_identity_cols WHERE owner = :owner_name AND table_name = :table_name', binds, options);
            for (const row of identities.rows)
                identityColumns.add(String(pick(row, 'COLUMN_NAME')));
        }
        catch {
            // Oracle versions before 12c have no identity columns
        }
        const comments = new Map();
        try {
            const commentRows = await connection.execute(`SELECT column_name, comments FROM all_col_comments
         WHERE owner = :owner_name AND table_name = :table_name AND comments IS NOT NULL`, binds, options);
            for (const row of commentRows.rows) {
                comments.set(String(pick(row, 'COLUMN_NAME')), String(pick(row, 'COMMENTS')));
            }
        }
        catch {
            // comments are optional metadata
        }
        const foreignRows = await connection.execute(`SELECT c.constraint_name, cc.column_name,
              rc.owner AS ref_owner, rc.table_name AS ref_table, rcc.column_name AS ref_column,
              c.delete_rule, cc.position
       FROM all_constraints c
       JOIN all_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
       JOIN all_constraints rc ON rc.owner = c.r_owner AND rc.constraint_name = c.r_constraint_name
       JOIN all_cons_columns rcc ON rcc.owner = rc.owner AND rcc.constraint_name = rc.constraint_name AND rcc.position = cc.position
       WHERE c.owner = :owner_name AND c.table_name = :table_name AND c.constraint_type = 'R'
       ORDER BY c.constraint_name, cc.position`, binds, options);
        const foreignByName = new Map();
        for (const row of foreignRows.rows) {
            const name = String(pick(row, 'CONSTRAINT_NAME'));
            let entry = foreignByName.get(name);
            if (entry === undefined) {
                entry = {
                    name,
                    columns: [],
                    referencedSchema: String(pick(row, 'REF_OWNER')),
                    referencedTable: String(pick(row, 'REF_TABLE')),
                    referencedColumns: [],
                    ...(pick(row, 'DELETE_RULE') === null || pick(row, 'DELETE_RULE') === undefined ? {} : { onDelete: String(pick(row, 'DELETE_RULE')) }),
                };
                foreignByName.set(name, entry);
            }
            entry.columns.push(String(pick(row, 'COLUMN_NAME')));
            entry.referencedColumns.push(String(pick(row, 'REF_COLUMN')));
        }
        const primaryColumnSet = new Set(primaryColumns);
        const uniqueByName = new Map(uniqueConstraints.map((item) => [item.name, item]));
        const byName = new Map();
        for (const row of indexes.rows) {
            const name = String(pick(row, 'INDEX_NAME'));
            const column = pick(row, 'COLUMN_NAME');
            const entry = byName.get(name) ?? {
                name,
                columns: [],
                unique: pick(row, 'UNIQUENESS') === 'UNIQUE',
                primary: false,
            };
            if (column !== null && column !== undefined)
                entry.columns.push(String(column));
            byName.set(name, entry);
        }
        for (const entry of byName.values()) {
            const constraint = uniqueByName.get(entry.name);
            if (entry.name === primaryName.value || (primaryColumns.length > 0 && entry.columns.length === primaryColumns.length && entry.columns.every((column) => primaryColumnSet.has(column)))) {
                entry.primary = true;
                entry.constraint = true;
            }
            else if (constraint !== undefined && constraint.columns.length === entry.columns.length && constraint.columns.every((column) => entry.columns.includes(column))) {
                entry.constraint = true;
            }
        }
        if (primaryColumns.length > 0 && ![...byName.values()].some((index) => index.primary)) {
            byName.set(primaryName.value || 'PRIMARY', {
                name: primaryName.value || 'PRIMARY',
                columns: primaryColumns,
                unique: true,
                primary: true,
                constraint: true,
            });
        }
        return {
            schema,
            table,
            kind,
            columns: columns.rows.map((row) => {
                const name = String(pick(row, 'COLUMN_NAME'));
                const defaultValue = pick(row, 'DATA_DEFAULT');
                const identity = identityColumns.has(name);
                return {
                    name,
                    typeName: columnType(row),
                    nullable: pick(row, 'NULLABLE') === 'Y',
                    ...(identity || defaultValue === null || defaultValue === undefined ? {} : { defaultValue: String(defaultValue).trim() }),
                    ...(typeof pick(row, 'COLUMN_ID') === 'number' ? { ordinal: Number(pick(row, 'COLUMN_ID')) } : {}),
                    ...(primaryColumnSet.has(name) ? { primaryKey: true } : {}),
                    ...(identity ? { autoIncrement: true } : {}),
                    ...(comments.has(name) ? { comment: comments.get(name) } : {}),
                };
            }),
            indexes: [...byName.values()],
            foreignKeys: [...foreignByName.values()],
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