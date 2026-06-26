export interface RelayMode { read: boolean; write: boolean }
export type RelayModes = Record<string, RelayMode>

function filterBy(relays: string[], modes: RelayModes, side: 'read' | 'write'): string[] {
  const subset = relays.filter(url => {
    const m = modes[url]
    if (!m) return true // unmarked = read + write
    return m[side]
  })
  return subset.length > 0 ? subset : relays
}

export function filterRead(relays: string[], modes: RelayModes): string[] {
  return filterBy(relays, modes, 'read')
}

export function filterWrite(relays: string[], modes: RelayModes): string[] {
  return filterBy(relays, modes, 'write')
}
