import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { coreEngines, nativeKindFor } from './db/catalog.js';
import { EngineRegistry } from './db/registry.js';
import { isReadOnlySql, } from './sql.js';
import { DbError, errorMessage } from './errors.js';
import { SecretStore as Secrets } from './secrets.js';
import { SshTransport } from './ssh/transport.js';
function probeId() {
    return `probe-${randomBytes(4).toString('hex')}`;
}
function dialectFor(driver) {
    switch (driver) {
        case 'postgres': return 'postgres';
        case 'sqlite': return 'sqlite';
        case 'mssql': return 'mssql';
        case 'oracle': return 'oracle';
        default: return 'mysql';
    }
}
function draftConfig(draft, id) {
    return {
        id,
        name: draft.name,
        driver: draft.driver,
        dialect: dialectFor(draft.driver),
        host: draft.host,
        port: draft.port,
        user: draft.user,
        hasPassword: false,
        database: draft.database,
        redisDb: 0,
        params: draft.params,
        readOnly: true,
        nativeEngine: true,
        ...(draft.ssh === undefined ? {} : { ssh: draft.ssh }),
        ...(draft.tls === undefined ? {} : { tls: draft.tls }),
        createdAt: new Date().toISOString(),
    };
}
/**
 * Native SQL service. It owns Java-free sessions and is called by SqlService
 * for connections with nativeEngine=true; JDBC remains in place for presets
 * that are not migrated yet.
 */
export class NativeSqlService {
    paths;
    config;
    secrets;
    drivers;
    log;
    sessions = new Map();
    engines = new EngineRegistry();
    constructor(paths, config, secrets, drivers, log = () => { }) {
        this.paths = paths;
        this.config = config;
        this.secrets = secrets;
        this.drivers = drivers;
        this.log = log;
        for (const contribution of coreEngines)
            this.engines.register(contribution);
    }
    isConnected(id) {
        return this.sessions.has(id);
    }
    connectedIds() {
        return [...this.sessions.keys()];
    }
    serverOf(id) {
        return this.sessions.get(id)?.server;
    }
    require(id) {
        const session = this.sessions.get(id);
        if (session === undefined)
            throw new DbError('not-connected', '连接尚未打开', '请先连接数据库。');
        return session;
    }
    async open(config, password, sshPassword, sshPassphrase) {
        if (this.sessions.has(config.id))
            return this.sessions.get(config.id);
        let transport;
        let endpoint = { host: config.host, port: config.port };
        try {
            if (config.ssh !== undefined) {
                transport = new SshTransport(config.ssh, { password: sshPassword, passphrase: sshPassphrase }, join(this.paths.dataDir, 'ssh-known-hosts.json'), this.log);
                const local = await transport.forwardTo(config.host, config.port);
                endpoint = { host: local.host, port: local.port };
            }
            const kind = nativeKindFor(config.driver);
            if (kind === undefined)
                throw new DbError('unsupported', `该数据库尚未启用内置引擎：${config.driver}`);
            if (config.driver === 'sqlite' && config.ssh !== undefined)
                throw new DbError('unsupported', 'SQLite 不支持 SSH 隧道');
            const contribution = this.engines.get(kind);
            if (contribution === undefined)
                throw new DbError('unsupported', `内置引擎未注册：${kind}`);
            if (!contribution.descriptor.driverId.startsWith('node:'))
                await this.drivers.ensure(contribution.descriptor.driverId);
            const engine = this.engines.create(kind);
            const server = await engine.connect({
                connection: config,
                endpoint,
                credentials: { password },
                settings: {
                    maxRows: this.config.settings().maxRows,
                    queryTimeoutSec: this.config.settings().queryTimeoutSec,
                    connectTimeoutSec: this.config.settings().connectTimeoutSec,
                },
                drivers: this.drivers,
                log: this.log,
            });
            const session = { config, engine, ...(transport === undefined ? {} : { transport }), server };
            this.sessions.set(config.id, session);
            return session;
        }
        catch (error) {
            if (transport !== undefined)
                await transport.close().catch(() => undefined);
            throw error instanceof DbError ? error : new DbError('connect-failed', `连接失败：${errorMessage(error)}`);
        }
    }
    passwordFor(config, draftPassword) {
        if (draftPassword !== undefined && draftPassword !== '')
            return draftPassword;
        if (config.secretName === undefined)
            return '';
        return this.secrets.resolve(config.secretName)?.value ?? '';
    }
    async test(draft) {
        const started = Date.now();
        const id = draft.id ?? probeId();
        let config = draftConfig(draft, id);
        const existing = draft.id === undefined ? undefined : this.config.connection(draft.id);
        if (existing?.secretName !== undefined)
            config = { ...config, secretName: existing.secretName };
        let session;
        try {
            const password = this.passwordFor(config, draft.password);
            session = await this.open(config, password, draft.sshPassword, draft.sshPassphrase);
            return { ok: true, server: session.server, latencyMs: Date.now() - started };
        }
        catch (error) {
            return {
                ok: false,
                latencyMs: Date.now() - started,
                message: errorMessage(error),
                ...(error instanceof DbError ? { code: error.code } : {}),
            };
        }
        finally {
            if (session !== undefined)
                await session.engine.disconnect().catch(() => undefined);
            await session?.transport?.close().catch(() => undefined);
            this.sessions.delete(id);
        }
    }
    async connect(id) {
        const config = this.config.connection(id);
        if (config === undefined)
            throw new DbError('not-found', `连接不存在：${id}`);
        if (config.nativeEngine !== true || nativeKindFor(config.driver) === undefined)
            throw new DbError('unsupported', '该连接未启用内置引擎');
        const session = this.sessions.get(id);
        if (session !== undefined)
            return session.server;
        const password = this.passwordFor(config);
        const sshPassword = this.secrets.resolve(Secrets.nameForSshPassword(id))?.value;
        const sshPassphrase = this.secrets.resolve(Secrets.nameForSshPassphrase(id))?.value;
        const created = await this.open(config, password, sshPassword, sshPassphrase);
        this.config.touchConnection(id);
        return created.server;
    }
    async disconnect(id) {
        const session = this.sessions.get(id);
        if (session === undefined)
            return;
        this.sessions.delete(id);
        await session.engine.disconnect().catch(() => undefined);
        await session.transport?.close().catch(() => undefined);
    }
    async schemas(id, filter = '') {
        return this.require(id).engine.listSchemas(filter);
    }
    async objects(id, schema) {
        return this.require(id).engine.listObjects(schema);
    }
    async setSchema(id, schema) {
        await this.require(id).engine.setSchema(schema);
    }
    async describe(id, schema, table, kind = 'table') {
        return this.require(id).engine.describe(schema, table, kind);
    }
    async ddl(id, schema, table, kind = 'table') {
        return this.require(id).engine.ddl(schema, table, kind);
    }
    async explain(id, sql) {
        return this.require(id).engine.explain(sql);
    }
    async transaction(id, action) {
        const session = this.require(id);
        await session.engine.transaction(action === 'begin' ? 'begin' : action);
    }
    async query(id, sql, options = {}) {
        const session = this.require(id);
        const statement = sql.trim();
        if (statement === '')
            throw new DbError('invalid', 'SQL 不能为空');
        if (session.config.readOnly && options.allowWrite === true) {
            throw new DbError('read-only', '只读连接不允许写操作');
        }
        if (options.allowWrite !== true && !isReadOnlySql(statement)) {
            throw new DbError('read-only', '该操作只允许只读语句（SELECT/SHOW/DESCRIBE/EXPLAIN 等）', '请打开连接或先在面板中确认执行。');
        }
        if (options.schema !== undefined && options.schema !== '')
            await session.engine.setSchema(options.schema);
        const stmtKey = options.stmtKey ?? `stmt-${randomBytes(6).toString('hex')}`;
        return session.engine.query(statement, {
            maxRows: options.maxRows,
            timeoutSec: options.timeoutSec,
            stmtKey,
            schema: options.schema,
        });
    }
    async cancel(stmtKey) {
        let cancelled = false;
        for (const session of this.sessions.values()) {
            if (await session.engine.cancel(stmtKey))
                cancelled = true;
        }
        return cancelled;
    }
    async ping() {
        return { bridge: 0, java: 'none', vm: 'node', threads: this.sessions.size };
    }
    async dispose() {
        const ids = [...this.sessions.keys()];
        for (const id of ids)
            await this.disconnect(id);
    }
}
//# sourceMappingURL=native.js.map