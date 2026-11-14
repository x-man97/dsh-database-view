import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DbError, errorMessage } from '../errors.js';
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
function sha256(data) {
    return createHash('sha256').update(data).digest('hex');
}
/**
 * Downloads and loads the self-contained ESM driver packs described by
 * drivers.json. The JDBC bridge is not involved; the loaded module is handed to
 * an Engine.
 */
export class DriverManager {
    paths;
    log;
    manifest;
    loaded = new Map();
    constructor(paths, log = () => { }) {
        this.paths = paths;
        this.log = log;
    }
    readManifest() {
        if (this.manifest !== undefined)
            return this.manifest;
        const file = join(this.paths.root, 'drivers.json');
        try {
            const parsed = JSON.parse(readFileSync(file, 'utf8'));
            if (parsed.version !== 1 || !Array.isArray(parsed.packs))
                throw new Error('invalid drivers.json');
            this.manifest = parsed;
            return parsed;
        }
        catch (error) {
            throw new DbError('driver-missing', `无法读取驱动清单：${errorMessage(error)}`, file);
        }
    }
    artifact(id) {
        const artifact = this.readManifest().packs.find((entry) => entry.id === id);
        if (artifact === undefined)
            throw new DbError('driver-missing', `未知驱动：${id}`);
        return artifact;
    }
    fileFor(artifact) {
        if (artifact.delivery === 'bundled') {
            return join(this.paths.root, artifact.file ?? join('drivers', `${artifact.id}-${artifact.version}.mjs`));
        }
        return join(this.paths.dataDir, 'drivers', 'js', `${artifact.id}-${artifact.version}.mjs`);
    }
    status(id) {
        const artifact = this.artifact(id);
        const file = this.fileFor(artifact);
        let installed = false;
        let bytes;
        let error;
        try {
            const stat = statSync(file);
            installed = stat.isFile() && stat.size > 0;
            if (installed)
                bytes = stat.size;
            if (installed && artifact.bytes > 0 && stat.size !== artifact.bytes) {
                installed = false;
                error = `驱动文件大小不符（期望 ${artifact.bytes}，实际 ${stat.size}）`;
            }
        }
        catch {
            // missing
        }
        return {
            id: artifact.id,
            engine: artifact.engine,
            version: artifact.version,
            license: artifact.license,
            installed,
            ...(installed ? { path: file, bytes } : {}),
            downloadAvailable: artifact.delivery === 'download' && (artifact.urls?.length ?? 0) > 0,
            ...(error === undefined ? {} : { error }),
        };
    }
    list() {
        return this.readManifest().packs.map((artifact) => this.status(artifact.id));
    }
    async ensure(id) {
        const status = this.status(id);
        if (!status.installed) {
            throw new DbError('driver-missing', `需要下载驱动：${status.id} ${status.version}`, JSON.stringify(status));
        }
        return status;
    }
    async load(id) {
        const cached = this.loaded.get(id);
        if (cached !== undefined)
            return cached;
        const task = this.loadOnce(id).catch((error) => {
            this.loaded.delete(id);
            throw error;
        });
        this.loaded.set(id, task);
        return task;
    }
    async loadOnce(id) {
        const artifact = this.artifact(id);
        const status = await this.ensure(id);
        const file = status.path;
        const payload = await readFile(file);
        const actual = sha256(payload);
        if (actual !== artifact.sha256) {
            throw new DbError('driver-missing', `驱动校验失败：${id}`, `期望 ${artifact.sha256}，实际 ${actual}`);
        }
        this.log(`loading driver ${id}@${artifact.version}`);
        const href = `${pathToFileURL(file).href}?sha=${artifact.sha256}`;
        return (await import(href));
    }
    async download(id) {
        const artifact = this.artifact(id);
        if (this.status(id).installed)
            return this.status(id);
        if (artifact.delivery === 'bundled') {
            throw new DbError('driver-missing', `内置驱动缺失：${id}`, '请重新安装 dsh-database-view');
        }
        const errors = [];
        for (const url of artifact.urls ?? []) {
            try {
                const payload = await this.fetchOne(url);
                if (payload.length > MAX_DOWNLOAD_BYTES)
                    throw new Error('文件超过 50 MB');
                const actual = sha256(payload);
                if (actual !== artifact.sha256)
                    throw new Error(`SHA-256 不符（期望 ${artifact.sha256}，实际 ${actual}）`);
                const target = this.fileFor(artifact);
                mkdirSync(join(this.paths.dataDir, 'drivers', 'js'), { recursive: true, mode: 0o700 });
                const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
                writeFileSync(temp, payload, { mode: 0o600 });
                renameSync(temp, target);
                this.log(`downloaded driver ${id}@${artifact.version} from ${url}`);
                return this.status(id);
            }
            catch (error) {
                errors.push(`${url}: ${errorMessage(error)}`);
            }
        }
        throw new DbError('download-failed', `下载驱动失败：${id}`, errors.join('\n'));
    }
    async fetchOne(url) {
        if (url.startsWith('file://'))
            return readFile(new URL(url));
        const response = await fetch(url, {
            redirect: 'follow',
            signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        return Buffer.from(await response.arrayBuffer());
    }
    /** Only used by tests and the import endpoint, which is not part of M0. */
    installFile(id, file) {
        const artifact = this.artifact(id);
        const target = this.fileFor(artifact);
        mkdirSync(join(this.paths.dataDir, 'drivers', 'js'), { recursive: true, mode: 0o700 });
        writeFileSync(target, readFileSync(file), { mode: 0o600 });
        this.loaded.delete(id);
        return this.status(id);
    }
    hasManifest() {
        return existsSync(join(this.paths.root, 'drivers.json'));
    }
}
//# sourceMappingURL=manager.js.map