// NIP-17/NIP-59 gift wrap, hand-rolled from the two Signer primitives
// (signEvent + nip44Encrypt/Decrypt) so one code path serves LocalSigner and
// NIP-07 — nostr-tools' nip17 helpers require a raw private key, which NIP-07
// never exposes. Rumor (kind 14, UNSIGNED, real created_at) → seal (kind 13,
// signed by sender, nip44 to target) → wrap (kind 1059, signed by a throwaway
// ephemeral key, nip44 to target, created_at randomized into the past).
import {
  finalizeEvent, generateSecretKey, getEventHash, verifyEvent,
  nip44, type Event, type UnsignedEvent,
} from 'nostr-tools'
import { requireSigner, getSigner } from './signer'

export const GIFT_WRAP_KIND = 1059
export const SEAL_KIND = 13
export const RUMOR_KIND = 14

// Mirror inbox limits; kept local to avoid an import cycle with inbox.ts.
const MAX_ENCRYPTED_LEN = 300_000
const MAX_PLAINTEXT_LEN = 200_000

const TWO_DAYS_S = 2 * 24 * 60 * 60

function randomPastTimestamp(): number {
  return Math.floor(Date.now() / 1000) - Math.floor(Math.random() * TWO_DAYS_S)
}

export interface GiftWrapResult {
  rumorId: string
  createdAt: number
  wrapForRecipient: Event
  wrapForSelf: Event
}

export interface UnwrappedDM {
  senderPubkey: string
  content: string
  createdAt: number
  rumorId: string
  tags: string[][]
}

export async function buildGiftWraps(recipientPubkey: string, content: string): Promise<GiftWrapResult> {
  const signer = requireSigner()
  const createdAt = Math.floor(Date.now() / 1000)
  const rumor: UnsignedEvent = {
    kind: RUMOR_KIND,
    created_at: createdAt,
    tags: [['p', recipientPubkey]],
    content,
    pubkey: signer.pubkey,
  }
  const rumorId = getEventHash(rumor)
  const rumorJson = JSON.stringify({ ...rumor, id: rumorId })

  const wrapFor = async (target: string): Promise<Event> => {
    const seal = await signer.signEvent({
      kind: SEAL_KIND,
      created_at: randomPastTimestamp(),
      tags: [],
      content: await signer.nip44Encrypt(target, rumorJson),
    })
    const ephemeralSk = generateSecretKey()
    return finalizeEvent({
      kind: GIFT_WRAP_KIND,
      created_at: randomPastTimestamp(),
      tags: [['p', target]],
      content: nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(ephemeralSk, target)),
    }, ephemeralSk)
  }

  return {
    rumorId,
    createdAt,
    wrapForRecipient: await wrapFor(recipientPubkey),
    wrapForSelf: await wrapFor(signer.pubkey),
  }
}

export async function unwrapGiftWrap(event: Event): Promise<UnwrappedDM | null> {
  const signer = getSigner()
  if (!signer || !signer.caps.nip44) return null
  if (event.kind !== GIFT_WRAP_KIND) return null
  if (event.content.length > MAX_ENCRYPTED_LEN) return null
  try {
    const seal = JSON.parse(await signer.nip44Decrypt(event.pubkey, event.content)) as Event
    if (seal.kind !== SEAL_KIND || typeof seal.pubkey !== 'string') return null
    if (typeof seal.content !== 'string' || seal.content.length > MAX_ENCRYPTED_LEN) return null
    if (!verifyEvent(seal)) return null
    const rumor = JSON.parse(await signer.nip44Decrypt(seal.pubkey, seal.content)) as UnsignedEvent
    if (rumor.kind !== RUMOR_KIND) return null
    if (rumor.pubkey !== seal.pubkey) return null // NIP-17 anti-spoof
    if (typeof rumor.content !== 'string' || rumor.content.length > MAX_PLAINTEXT_LEN) return null
    if (typeof rumor.created_at !== 'number') return null
    const tags = Array.isArray(rumor.tags) ? rumor.tags : []
    // Recompute the id from contents — never trust an embedded one
    const rumorId = getEventHash({ kind: rumor.kind, created_at: rumor.created_at, tags, content: rumor.content, pubkey: rumor.pubkey })
    return { senderPubkey: seal.pubkey, content: rumor.content, createdAt: rumor.created_at, rumorId, tags }
  } catch {
    return null // undecryptable / malformed — not addressed to us or garbage
  }
}
