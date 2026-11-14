import type { EngineContribution, EngineDescriptor, DatabaseEngine } from './types.js'

/** Small registry used by the core and, later, optional engine packages. */
export class EngineRegistry {
  private readonly entries = new Map<string, EngineContribution>()

  register(contribution: EngineContribution): () => void {
    if (contribution.apiVersion !== 1) throw new Error(`Unsupported engine apiVersion: ${String(contribution.apiVersion)}`)
    if (this.entries.has(contribution.descriptor.kind)) throw new Error(`Engine already registered: ${contribution.descriptor.kind}`)
    this.entries.set(contribution.descriptor.kind, contribution)
    return () => {
      if (this.entries.get(contribution.descriptor.kind) === contribution) this.entries.delete(contribution.descriptor.kind)
    }
  }

  get(kind: string): EngineContribution | undefined {
    return this.entries.get(kind)
  }

  list(): EngineDescriptor[] {
    return [...this.entries.values()].map((entry) => entry.descriptor)
  }

  create(kind: string): DatabaseEngine {
    const entry = this.entries.get(kind)
    if (entry === undefined) throw new Error(`Engine not registered: ${kind}`)
    return entry.create()
  }
}
