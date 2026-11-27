// NIP-46 login: connect to the user's remote signer ("bunker") from a
// bunker:// URL or a NIP-05 name, and restore that session on reload.
import { generateSecretKey } from 'nostr-tools'
import { BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46'
import { getPool } from './nostr'
import { Nip46Signer } from './signer'
import type { BunkerSession } from './keyStore'

// The signer app may be offline; app start must not wait on it forever.
export const RESTORE_TIMEOUT_MS = 15_000
const CONNECT_TIMEOUT_MS = 120_000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Signer did not answer')), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

/** First connection. The signer app may ask the user to approve, sometimes via an auth URL. */
export async function connectBunker(
  input: string,
  onAuthUrl?: (url: string) => void,
): Promise<{ signer: Nip46Signer; session: BunkerSession }> {
  const bp = await parseBunkerInput(input.trim())
  if (!bp) throw new Error('Not a bunker:// URL or NIP-05 name with a bunker')
  const clientSecretKey = generateSecretKey()
  const bunker = BunkerSigner.fromBunker(clientSecretKey, bp, { pool: getPool(), onauth: onAuthUrl })
  try {
    // Generous: the user may need to unlock their signer app and approve.
    await withTimeout(bunker.connect(), CONNECT_TIMEOUT_MS)
    const pubkey = await withTimeout(bunker.getPublicKey(), RESTORE_TIMEOUT_MS)
    return { signer: new Nip46Signer(bunker, pubkey), session: { clientSecretKey, bunker: bp } }
  } catch (e) {
    await bunker.close().catch(() => {})
    throw e
  }
}

/** Reuse an authorized session: no new connect, just confirm the signer answers. */
export async function restoreBunker(session: BunkerSession, timeoutMs = RESTORE_TIMEOUT_MS): Promise<Nip46Signer> {
  const bunker = BunkerSigner.fromBunker(session.clientSecretKey, session.bunker, { pool: getPool() })
  try {
    const pubkey = await withTimeout(bunker.getPublicKey(), timeoutMs)
    return new Nip46Signer(bunker, pubkey)
  } catch (e) {
    await bunker.close().catch(() => {})
    throw e
  }
}
