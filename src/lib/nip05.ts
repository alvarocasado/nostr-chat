// NIP-05: verify that a `name@domain` identifier maps to a given pubkey by
// fetching https://domain/.well-known/nostr.json?name=<local>. Used both to
// resolve an identifier to a pubkey (adding contacts) and to show a verified
// badge on profiles.

const NIP05_RE = /^(?<local>[a-z0-9\-_.]+)@(?<domain>[a-z0-9.-]+\.[a-z]{2,})$/i

interface Nip05Doc {
  names?: Record<string, string>
}

// Cache resolutions for the session — well-known lookups are slow and repeated.
const resolveCache = new Map<string, string | null>()

export function isNip05Address(value: string): boolean {
  return NIP05_RE.test(value.trim())
}

/** Resolve a `name@domain` identifier to a hex pubkey, or null. Cached. */
export async function resolveNip05(address: string): Promise<string | null> {
  const addr = address.trim().toLowerCase()
  const m = NIP05_RE.exec(addr)
  if (!m?.groups) return null
  if (resolveCache.has(addr)) return resolveCache.get(addr)!

  const { local, domain } = m.groups
  let pubkey: string | null = null
  try {
    const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(local)}`
    const res = await fetch(url, { redirect: 'error' })
    if (res.ok) {
      const doc = (await res.json()) as Nip05Doc
      const found = doc.names?.[local]
      if (typeof found === 'string' && /^[0-9a-f]{64}$/i.test(found)) pubkey = found.toLowerCase()
    }
  } catch { /* network / CORS / parse error — treat as unresolved */ }

  resolveCache.set(addr, pubkey)
  return pubkey
}

/** True when `address` resolves to `pubkey`. False on mismatch or lookup failure. */
export async function verifyNip05(pubkey: string, address: string): Promise<boolean> {
  const resolved = await resolveNip05(address)
  return resolved !== null && resolved === pubkey.toLowerCase()
}
