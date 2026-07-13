import type { Event } from 'nostr-tools'
import { getSigner, requireSigner } from './signer'

// Read receipts: ephemeral range, in the app's 241xx block next to the
// call-signal kind (24100) and typing indicator (24101). Relays relay but
// never store these, so no persistent metadata trail is created.
export const READ_RECEIPT_KIND = 24102

// Never trust a peer watermark further than slightly ahead of our clock.
const MAX_CLOCK_SKEW_S = 300

// Validates a decrypted watermark value. Returns the (possibly clamped)
// unix-seconds timestamp, or null when the value is unusable.
export function clampReadUntil(value: unknown, nowS = Math.floor(Date.now() / 1000)): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.min(value, nowS + MAX_CLOCK_SKEW_S)
}

// Pure decision: should the client emit a receipt right now?
export function shouldSendReceipt(args: {
  enabled: boolean
  visible: boolean
  newestReceivedAt: number | undefined
  lastSent: number
}): boolean {
  const { enabled, visible, newestReceivedAt, lastSent } = args
  return enabled && visible && newestReceivedAt !== undefined && newestReceivedAt > lastSent
}

// Build the ephemeral receipt event. Content is NIP-04-encrypted to the peer
// so relays only see that *some* 24102 event passed between the two pubkeys
// while it is in flight.
export async function buildReadReceiptEvent(peerPubkey: string, readUntil: number): Promise<Event> {
  const signer = requireSigner()
  const content = await signer.nip04Encrypt(peerPubkey, JSON.stringify({ read_until: readUntil }))
  return signer.signEvent({
    kind: READ_RECEIPT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', peerPubkey]],
    content,
  })
}

// Decrypt and validate an incoming receipt. Returns the clamped watermark,
// or null for wrong-kind, undecryptable, or malformed payloads.
export async function parseReadReceiptEvent(event: Event): Promise<number | null> {
  const signer = getSigner()
  if (!signer || event.kind !== READ_RECEIPT_KIND) return null
  try {
    const plaintext = await signer.nip04Decrypt(event.pubkey, event.content)
    const parsed = JSON.parse(plaintext) as { read_until?: unknown }
    return clampReadUntil(parsed.read_until)
  } catch {
    return null
  }
}
