/**
 * Generic map helper. No domain-specific dependencies.
 */

// Store an entry in a capped Map, evicting the oldest entry when over capacity.
export function storeRecent(id: string, msg: any, map: Map<string, any>, cap: number): void {
  map.set(id, msg)
  if (map.size > cap) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
}
