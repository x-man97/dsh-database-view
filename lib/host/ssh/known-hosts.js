import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
function fingerprintOf(key) {
    return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}
export class KnownHostsStore {
    file;
    data = { version: 1, hosts: {} };
    loaded = false;
    constructor(file) {
        this.file = file;
    }
    load() {
        if (this.loaded)
            return;
        this.loaded = true;
        if (!existsSync(this.file))
            return;
        try {
            const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
            if (parsed.version === 1 && parsed.hosts !== undefined)
                this.data = parsed;
        }
        catch {
            // start empty; the UI can surface a warning in a later milestone
        }
    }
    persist() {
        mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
        const temp = `${this.file}.tmp-${process.pid}`;
        writeFileSync(temp, `${JSON.stringify(this.data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
        renameSync(temp, this.file);
    }
    key(host, port) {
        return `${host}:${port}`;
    }
    get(host, port) {
        this.load();
        return this.data.hosts[this.key(host, port)];
    }
    accepts(host, port, keyType, key, policy) {
        this.load();
        const fingerprint = fingerprintOf(key);
        const existing = this.data.hosts[this.key(host, port)];
        if (existing !== undefined) {
            const changed = existing.fingerprint !== fingerprint || existing.keyType !== keyType;
            return { accepted: !changed, fingerprint, changed };
        }
        if (policy === 'strict')
            return { accepted: false, fingerprint, changed: false };
        this.data.hosts[this.key(host, port)] = { keyType, fingerprint, firstSeenAt: new Date().toISOString() };
        this.persist();
        return { accepted: true, fingerprint, changed: false };
    }
}
//# sourceMappingURL=known-hosts.js.map