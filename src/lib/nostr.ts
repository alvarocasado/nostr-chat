import {
  generateSecretKey,
  getPublicKey,
  nip19,
  SimplePool,
  type Event,
  type Filter,
} from 'nostr-tools'
import { encryptWithGroupKey } from './groupCrypto'
import { serializeGroupRekey, serializeGroupRemove } from './groupMembership'
import { mentionTags } from './mentions'
import { requireSigner } from './signer'

// Group messages: regular-range kind so relays store full history.
// The previous kind (10042) sits in NIP-01's replaceable range (10000-19999),
// where relays keep only the latest event per pubkey — collapsing group
// history to one message per member. Still read for back-compat.
export const GROUP_MESSAGE_KIND = 1042
export const LEGACY_GROUP_MESSAGE_KIND = 10042

// Typing indicators: ephemeral range, in the app's 241xx block next to the
// call-signal kind (24100). The previous kind (24133) collides with NIP-46.
export const TYPING_INDICATOR_KIND = 24101

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://nostr.wine',
  'wss://relay.primal.net',
]

// Key management
export function generateKeys() {
  const sk = generateSecretKey()
  const pk = getPublicKey(sk)
  return { sk, pk }
}

export function encodeNsec(sk: Uint8Array): string {
  return nip19.nsecEncode(sk)
}

export function encodePubkey(pk: string): string {
  return nip19.npubEncode(pk)
}

// Build kind-0 (profile) event
export async function buildProfileEvent(profile: {
  name?: string
  display_name?: string
  about?: string
  picture?: string
  nip05?: string
}): Promise<Event> {
  return requireSigner().signEvent({
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(profile),
  })
}

// Build kind-4 (encrypted DM) - NIP-04
export async function buildDMEvent(recipientPubkey: string, content: string): Promise<Event> {
  const signer = requireSigner()
  const encryptedContent = await signer.nip04Encrypt(recipientPubkey, content)
  return signer.signEvent({
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', recipientPubkey]],
    content: encryptedContent,
  })
}

// Decrypt kind-4 DM
export async function decryptDM(senderPubkey: string, encryptedContent: string): Promise<string> {
  return requireSigner().nip04Decrypt(senderPubkey, encryptedContent)
}

// Build kind-40 (channel creation)
export async function buildChannelCreateEvent(name: string, about: string): Promise<Event> {
  return requireSigner().signEvent({
    kind: 40,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify({ name, about }),
  })
}

// Build ephemeral typing indicator (not stored by relays)
export async function buildTypingEvent(chatType: 'dm' | 'channel', chatId: string): Promise<Event> {
  const tags = chatType === 'dm' ? [['p', chatId]] : [['e', chatId]]
  return requireSigner().signEvent({
    kind: TYPING_INDICATOR_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: 'typing',
  })
}

// Build kind-42 (channel message); replyEventId adds NIP-10 reply tag
export async function buildChannelMessageEvent(
  content: string,
  channelId: string,
  relayUrl: string,
  replyEventId?: string,
): Promise<Event> {
  const tags: string[][] = [['e', channelId, relayUrl, 'root']]
  if (replyEventId) tags.push(['e', replyEventId, '', 'reply'])
  tags.push(...mentionTags(content))  // NIP-27: p tags for npub/nprofile mentions
  return requireSigner().signEvent({ kind: 42, created_at: Math.floor(Date.now() / 1000), tags, content })
}

// Pool singleton
let pool: SimplePool | null = null

export function getPool(): SimplePool {
  if (!pool) {
    pool = new SimplePool()
  }
  return pool
}

// Fetch single event
export async function fetchEvent(relays: string[], filter: Filter): Promise<Event | null> {
  const p = getPool()
  return p.get(relays, filter)
}

// Subscribe to events with a single filter
export function subscribeEvents(
  relays: string[],
  filter: Filter,
  onEvent: (event: Event) => void,
  onEose?: () => void,
) {
  const p = getPool()
  return p.subscribeMany(relays, filter, {
    onevent: onEvent,
    oneose: onEose,
  })
}

// Publish event to relays
export async function publishEvent(relays: string[], event: Event): Promise<void> {
  const p = getPool()
  await Promise.any(p.publish(relays, event))
}

// Fetch multiple events matching a filter (collects until EOSE)
export async function fetchEvents(relays: string[], filter: Filter): Promise<Event[]> {
  const p = getPool()
  const events: Event[] = []
  await new Promise<void>(resolve => {
    const sub = p.subscribeMany(relays, filter, {
      onevent: (e) => events.push(e),
      oneose: () => { sub.close(); resolve() },
    })
  })
  return events
}

// Build group message event (content is pre-encrypted by caller)
export async function buildGroupMessageEvent(
  encryptedContent: string,
  groupId: string,
  relayUrl: string,
  replyEventId?: string,
): Promise<Event> {
  // Group ids are UUIDs, not event ids: strict relays reject them in e tags,
  // so groups are addressed NIP-29-style via h. Replies still e-tag the
  // real target event id.
  const tags: string[][] = [['h', groupId, relayUrl]]
  if (replyEventId) tags.push(['e', replyEventId, '', 'reply'])
  return requireSigner().signEvent({ kind: GROUP_MESSAGE_KIND, created_at: Math.floor(Date.now() / 1000), tags, content: encryptedContent })
}

// Build kind-30040 group metadata event (content encrypted with group key)
export async function buildGroupMetadataEvent(
  groupKeyHex: string,
  groupId: string,
  name: string,
  about: string,
  memberPubkeys: string[],
): Promise<Event> {
  const encrypted = await encryptWithGroupKey(JSON.stringify({ name, about, memberPubkeys }), groupKeyHex)
  return requireSigner().signEvent({ kind: 30040, created_at: Math.floor(Date.now() / 1000), tags: [['d', groupId]], content: encrypted })
}

// Build kind-30041 self-encrypted key backup (NIP-04 with own pubkey as recipient).
// Content is JSON {keys:[oldest→newest]}; readers also accept the legacy bare hex.
export async function buildGroupKeyBackupEvent(groupId: string, keysOldestFirst: string[]): Promise<Event> {
  const signer = requireSigner()
  const encrypted = await signer.nip04Encrypt(signer.pubkey, JSON.stringify({ keys: keysOldestFirst }))
  return signer.signEvent({ kind: 30041, created_at: Math.floor(Date.now() / 1000), tags: [['d', groupId]], content: encrypted })
}

// Build group invite as NIP-04 DM carrying
// { type: 'group_invite', groupId, groupKeyHex, groupName, memberPubkeys }
export async function buildGroupInviteEvent(
  recipientPubkey: string,
  groupId: string,
  groupKeyHex: string,
  groupName: string,
  memberPubkeys: string[],
): Promise<Event> {
  const signer = requireSigner()
  const payload = JSON.stringify({ type: 'group_invite', groupId, groupKeyHex, groupName, memberPubkeys })
  const encrypted = await signer.nip04Encrypt(recipientPubkey, payload)
  return signer.signEvent({ kind: 4, created_at: Math.floor(Date.now() / 1000), tags: [['p', recipientPubkey]], content: encrypted })
}

// Build group rekey as NIP-04 DM (new epoch key after a member removal)
export async function buildGroupRekeyEvent(
  recipientPubkey: string,
  groupId: string,
  groupKeyHex: string,
  groupName: string,
  memberPubkeys: string[],
): Promise<Event> {
  const signer = requireSigner()
  const encrypted = await signer.nip04Encrypt(
    recipientPubkey,
    serializeGroupRekey(groupId, groupKeyHex, groupName, memberPubkeys),
  )
  return signer.signEvent({ kind: 4, created_at: Math.floor(Date.now() / 1000), tags: [['p', recipientPubkey]], content: encrypted })
}

// Build courtesy removal notice as NIP-04 DM to the removed member
export async function buildGroupRemoveEvent(recipientPubkey: string, groupId: string): Promise<Event> {
  const signer = requireSigner()
  const encrypted = await signer.nip04Encrypt(recipientPubkey, serializeGroupRemove(groupId))
  return signer.signEvent({ kind: 4, created_at: Math.floor(Date.now() / 1000), tags: [['p', recipientPubkey]], content: encrypted })
}

// Shorten pubkey for display
export function shortPubkey(pk: string): string {
  return pk.slice(0, 8) + '...' + pk.slice(-4)
}

// Parse profile from kind-0 event content
export interface NostrProfile {
  name?: string
  display_name?: string
  about?: string
  picture?: string
  nip05?: string
  website?: string
  pubkey: string
}

export function parseProfile(event: Event): NostrProfile {
  try {
    const data = JSON.parse(event.content) as Partial<NostrProfile>
    return { ...data, pubkey: event.pubkey }
  } catch {
    return { pubkey: event.pubkey }
  }
}
