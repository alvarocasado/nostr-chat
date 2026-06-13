import type { Event } from 'nostr-tools'
import { decryptDM, fetchEvent, parseProfile } from './nostr'
import { decryptWithGroupKey } from './groupCrypto'
import { useNostrStore, type Message, type Group } from '../store/nostrStore'
import { fireNotification } from './notifications'
import {
  parseTransferPayload,
  handleFileStart,
  handleFileChunk,
  reconstructDataUrl,
  type FileTransferPayload,
  type IncomingTransfer,
} from './fileTransfer'
import { serializeMessage, getDisplayName, getPreviewText } from './fileUtils'
import { getUserDb } from './userDb'

// Plaintext content limit (channels + decrypted DMs): covers inline attachments
// up to the 150 KB INLINE_BASE64_THRESHOLD plus JSON wrapper overhead.
export const MAX_CONTENT_LEN = 200_000
// NIP-04 encrypts then base64-encodes, inflating size by ~33%.
// 200 KB plaintext → ~270 KB encrypted; use 300 KB to give headroom.
export const MAX_ENCRYPTED_CONTENT_LEN = 300_000

// ─── Side-effect dedup ───────────────────────────────────────────────────────
// The same event can be delivered by both the global inbox subscription and a
// per-chat subscription (and again as relay backfill after a restart). Adding
// the message is idempotent, but unread counts and notifications must run once.

const processedIds = new Set<string>()
const MAX_PROCESSED_IDS = 5000

/** Sync check-and-claim: returns true for the first caller per event id this session. */
function claimSideEffects(eventId: string): boolean {
  if (processedIds.has(eventId)) return false
  if (processedIds.size >= MAX_PROCESSED_IDS) {
    // Sets iterate in insertion order — drop the oldest half
    let toDrop = MAX_PROCESSED_IDS / 2
    for (const id of processedIds) {
      processedIds.delete(id)
      if (--toDrop <= 0) break
    }
  }
  processedIds.add(eventId)
  return true
}

/** Cross-session dedup: a message already in Dexie was counted when it first arrived. */
async function alreadyStored(eventId: string): Promise<boolean> {
  const db = getUserDb()
  if (!db) return false
  try {
    return (await db.messages.get(eventId)) !== undefined
  } catch {
    return false
  }
}

export function resetInboxDedup(): void {
  processedIds.clear()
  fetchingProfiles.clear()
}

// Backfilled (pre-EOSE) events only count as unread when newer than the last
// message the user saw in that chat — replays of old history stay quiet.
function shouldCountUnread(chatId: string, createdAt: number, live: boolean): boolean {
  if (live) return true
  return createdAt > (useNostrStore.getState().seenAt[chatId] ?? 0)
}

// ─── Profile loading ─────────────────────────────────────────────────────────

// Module-level set to deduplicate concurrent in-flight profile fetches
const fetchingProfiles = new Set<string>()

export function ensureProfile(pubkey: string, relays: string[]): void {
  const { profiles, setProfile } = useNostrStore.getState()
  if (profiles[pubkey] || fetchingProfiles.has(pubkey)) return
  fetchingProfiles.add(pubkey)
  fetchEvent(relays, { kinds: [0], authors: [pubkey] })
    .then(profileEvent => { if (profileEvent) setProfile(profileEvent.pubkey, parseProfile(profileEvent)) })
    .catch(() => {})
    .finally(() => fetchingProfiles.delete(pubkey))
}

// ─── File transfers ──────────────────────────────────────────────────────────

/** Called when the last chunk of an incoming transfer arrives. Reconstructs and stores the message. */
function finishTransfer(t: IncomingTransfer) {
  const { addMessage, publicKey } = useNostrStore.getState()
  // Sender already added the message optimistically in handleSendChunked
  if (t.senderPubkey === publicKey) return
  const dataUrl = reconstructDataUrl(t.mime, t.chunks, t.totalChunks)
  const content = serializeMessage('', { name: t.name, type: t.mime, size: t.size, data: dataUrl })
  addMessage(t.chatId, {
    id: `transfer-${t.transferId}`,
    pubkey: t.senderPubkey,
    content,
    createdAt: t.createdAt,
    tags: [],
    kind: 4,
  })
}

function routeTransfer(transfer: FileTransferPayload, chatId: string, event: Event): void {
  if (transfer.type === 'file_start') {
    handleFileStart(transfer.transferId, transfer, chatId, event.pubkey, event.created_at)
  } else {
    const completed = handleFileChunk(transfer.transferId, transfer.index, transfer.data)
    if (completed) finishTransfer(completed)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve the chat (channel/group) an event belongs to from its NIP-10 e tags. */
export function extractRootChatId(tags: string[][]): string | null {
  const root = tags.find(t => t[0] === 'e' && t[3] === 'root')
  if (root?.[1]) return root[1]
  return tags.find(t => t[0] === 'e')?.[1] ?? null
}

export interface ProcessOpts {
  /** True when the event arrived after EOSE (a live message, not relay backfill). */
  live: boolean
}

// ─── Event processors ────────────────────────────────────────────────────────
// Shared by the global inbox and per-chat subscriptions; safe to call multiple
// times with the same event.

export async function processChannelEvent(
  event: Event,
  channelId: string,
  relays: string[],
  opts: ProcessOpts,
): Promise<void> {
  if (event.content.length > MAX_CONTENT_LEN) return

  // Route file-transfer control messages; don't add them to the message list
  const transfer = parseTransferPayload(event.content)
  if (transfer) {
    if (claimSideEffects(event.id)) routeTransfer(transfer, channelId, event)
    return
  }

  const sideEffects = claimSideEffects(event.id) && !(await alreadyStored(event.id))

  const msg: Message = {
    id: event.id,
    pubkey: event.pubkey,
    content: event.content,
    createdAt: event.created_at,
    tags: event.tags,
    kind: event.kind,
    channelId,
  }
  useNostrStore.getState().addMessage(channelId, msg)
  if (!sideEffects) return

  const { publicKey, npub, channels, profiles, updateChannelLastMessage } = useNostrStore.getState()
  const isMention = !!(
    publicKey && (event.content.includes(publicKey) || (npub && event.content.includes(npub)))
  )
  updateChannelLastMessage(channelId, getPreviewText(event.content), event.created_at, isMention, {
    incrementUnread: shouldCountUnread(channelId, event.created_at, opts.live),
  })

  if (opts.live && event.pubkey !== publicKey) {
    const channelName = channels.find(c => c.id === channelId)?.name || 'Channel'
    const senderName = getDisplayName(profiles[event.pubkey], event.pubkey)
    const preview = getPreviewText(event.content)
    fireNotification(channelId, isMention ? 'mention' : 'channel', `#${channelName}`, `${senderName}: ${preview}`)
  }

  ensureProfile(event.pubkey, relays)
}

export async function processDMEvent(
  event: Event,
  sk: Uint8Array,
  myPubkey: string,
  relays: string[],
  opts: ProcessOpts,
): Promise<void> {
  if (event.content.length > MAX_ENCRYPTED_CONTENT_LEN) return

  const peer = event.pubkey === myPubkey
    ? event.tags.find(t => t[0] === 'p')?.[1]
    : event.pubkey
  if (!peer) return

  let decrypted: string
  try {
    decrypted = await decryptDM(sk, peer, event.content)
  } catch {
    return // decryption failed — skip
  }
  if (decrypted.length > MAX_CONTENT_LEN) return

  // Route file-transfer control messages
  const transfer = parseTransferPayload(decrypted)
  if (transfer) {
    if (claimSideEffects(event.id)) routeTransfer(transfer, peer, event)
    return
  }

  // Group invites are handled by useGroupInviteListener — not chat messages
  if (decrypted.startsWith('{')) {
    try {
      if ((JSON.parse(decrypted) as { type?: string })?.type === 'group_invite') return
    } catch { /* not JSON — regular message */ }
  }

  // Request gate (incoming only)
  const incoming = event.pubkey !== myPubkey
  if (incoming) {
    const { blockedPubkeys, dismissedRequests } = useNostrStore.getState()
    if (blockedPubkeys.includes(peer)) return
    const dismissedAt = dismissedRequests[peer]
    if (dismissedAt !== undefined && event.created_at <= dismissedAt) return
  }

  const sideEffects = claimSideEffects(event.id) && !(await alreadyStored(event.id))

  // Unknown sender (no contact yet) becomes a pending request; insert the
  // contact directly so it is NOT published to the public kind-3 follow list.
  const existingContact = useNostrStore.getState().contacts.find(c => c.pubkey === peer)
  const isPending = incoming && (!existingContact || existingContact.pending === true)
  if (incoming && !existingContact) {
    useNostrStore.setState({
      contacts: [{ pubkey: peer, pending: true }, ...useNostrStore.getState().contacts],
    })
  }

  const msg: Message = {
    id: event.id,
    pubkey: event.pubkey,
    content: decrypted,
    createdAt: event.created_at,
    tags: event.tags,
    kind: event.kind,
    recipientPubkey: peer,
    decrypted: true,
  }
  useNostrStore.getState().addMessage(peer, msg)
  if (!sideEffects || event.pubkey === myPubkey) return

  const { profiles, updateContactLastMessage } = useNostrStore.getState()
  const preview = getPreviewText(decrypted)
  updateContactLastMessage(peer, preview, event.created_at, {
    incrementUnread: shouldCountUnread(peer, event.created_at, opts.live),
  })

  if (opts.live && !isPending) {
    const senderName = getDisplayName(profiles[event.pubkey], event.pubkey)
    fireNotification(peer, 'dm', senderName, preview, profiles[event.pubkey]?.picture)
  }

  ensureProfile(event.pubkey, relays)
}

export async function processGroupEvent(
  event: Event,
  groupId: string,
  groupKey: string,
  relays: string[],
  opts: ProcessOpts,
): Promise<void> {
  let plaintext: string
  try {
    plaintext = await decryptWithGroupKey(event.content, groupKey)
  } catch {
    return // decryption failed — skip
  }
  if (plaintext.length > MAX_CONTENT_LEN) return

  const sideEffects = claimSideEffects(event.id) && !(await alreadyStored(event.id))

  const msg: Message = {
    id: event.id,
    pubkey: event.pubkey,
    content: plaintext,
    createdAt: event.created_at,
    tags: event.tags,
    kind: event.kind,
  }
  useNostrStore.getState().addMessage(groupId, msg)
  if (!sideEffects) return

  const { publicKey, groups, profiles, updateGroupLastMessage } = useNostrStore.getState()
  const isMention = !!(publicKey && plaintext.includes(publicKey))
  updateGroupLastMessage(groupId, getPreviewText(plaintext), event.created_at, isMention, {
    incrementUnread: shouldCountUnread(groupId, event.created_at, opts.live),
  })

  if (opts.live && event.pubkey !== publicKey) {
    const groupName = groups.find((g: Group) => g.id === groupId)?.name || 'Group'
    fireNotification(groupId, 'channel', groupName, `${getDisplayName(profiles[event.pubkey], event.pubkey)}: ${getPreviewText(plaintext)}`)
  }

  ensureProfile(event.pubkey, relays)
}
