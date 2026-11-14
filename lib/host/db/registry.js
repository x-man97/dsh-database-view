/** Small registry used by the core and, later, optional engine packages. */
export class EngineRegistry {
    entries = new Map();
    register(contribution) {
        if (contribution.apiVersion !== 1)
            throw new Error(`Unsupported engine apiVersion: ${String(contribution.apiVersion)}`);
        if (this.entries.has(contribution.descriptor.kind))
            throw new Error(`Engine already registered: ${contribution.descriptor.kind}`);
        this.entries.set(contribution.descriptor.kind, contribution);
        return () => {
            if (this.entries.get(contribution.descriptor.kind) === contribution)
                this.entries.delete(contribution.descriptor.kind);
        };
    }
    get(kind) {
        return this.entries.get(kind);
    }
    list() {
        return [...this.entries.values()].map((entry) => entry.descriptor);
    }
    create(kind) {
        const entry = this.entries.get(kind);
        if (entry === undefined)
            throw new Error(`Engine not registered: ${kind}`);
        return entry.create();
    }
}
//# sourceMappingURL=registry.js.map