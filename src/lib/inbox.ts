import type { Event } from 'nostr-tools'
import { decryptDM, fetchEvent, parseProfile, buildGroupKeyBackupEvent, publishEvent } from './nostr'
import { decryptWithGroupKey } from './groupCrypto'
import { useNostrStore, type Message, type Group } from '../store/nostrStore'
import { fireNotification } from './notifications'
import { getPeerRelays, combineRelays } from './peerRelays'
import {
  parseTransferPayload,
  handleFileStart,
  handleFileChunk,
  reconstructDataUrl,
  type FileTransferPayload,
  type IncomingTransfer,
} from './fileTransfer'
import { serializeMessage, getDisplayName, getPreviewText } from './fileUtils'
import { parseReactionPayload } from './reactions'
import { parseEditPayload, parseDeletePayload } from './messageOps'
import { parseCallStartPayload } from './groupCall'
import { parseCallLogPayload, callLogLabel } from './callLog'
import { isMentioned } from './mentions'
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
  getPeerRelays(pubkey, relays)
    .then(pr => fetchEvent(combineRelays(relays, pr.write), { kinds: [0], authors: [pubkey] }))
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

/** Apply an incoming reaction control message to the store. Caller dedups by event id. */
function routeReaction(content: string, event: Event): boolean {
  const reaction = parseReactionPayload(content)
  if (!reaction) return false
  if (claimSideEffects(event.id)) {
    useNostrStore.getState().applyReaction(reaction.target, reaction.emoji, event.pubkey, reaction.op)
  }
  return true
}

/**
 * Apply an incoming edit/delete control message. `event.pubkey` is recorded as
 * the requester; the store only honours it at render time when it matches the
 * target message's own author, so nobody can edit or delete another's message.
 */
function routeMessageOp(content: string, event: Event): boolean {
  const edit = parseEditPayload(content)
  if (edit) {
    if (claimSideEffects(event.id)) {
      useNostrStore.getState().applyEdit(edit.target, event.pubkey, edit.content, event.created_at)
    }
    return true
  }
  const del = parseDeletePayload(content)
  if (del) {
    if (claimSideEffects(event.id)) {
      useNostrStore.getState().applyDelete(del.target, event.pubkey)
    }
    return true
  }
  return false
}

/** Route a group call-start announcement: stored as a call row, preview + notification. */
async function routeCallStart(content: string, groupId: string, event: Event, live: boolean): Promise<boolean> {
  const payload = parseCallStartPayload(content)
  if (!payload) return false
  const sideEffects = claimSideEffects(event.id) && !(await alreadyStored(event.id))
  useNostrStore.getState().addMessage(groupId, {
    id: event.id,
    pubkey: event.pubkey,
    content,
    createdAt: event.created_at,
    tags: event.tags,
    kind: event.kind,
  })
  if (sideEffects) {
    const { publicKey, groups, profiles, updateGroupLastMessage } = useNostrStore.getState()
    updateGroupLastMessage(groupId, 'Call started', event.created_at, false, {
      incrementUnread: shouldCountUnread(groupId, event.created_at, live),
    })
    if (live && event.pubkey !== publicKey) {
      const groupName = groups.find((g: Group) => g.id === groupId)?.name || 'Group'
      fireNotification(groupId, 'channel', groupName, `${getDisplayName(profiles[event.pubkey], event.pubkey)} started a call`)
    }
  }
  return true
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

/**
 * Handle a decrypted group_invite DM: join the group and back up the key once.
 * Idempotent — a group we already have is left untouched, so replays from
 * per-chat subscriptions or relay backfill do not re-add or re-publish.
 */
async function handleGroupInvite(event: Event, decrypted: string, relays: string[]): Promise<void> {
  try {
    const payload = JSON.parse(decrypted) as { groupId?: string; groupKeyHex?: string; groupName?: string }
    const { groupId, groupKeyHex, groupName } = payload
    if (!groupId || !groupKeyHex || !groupName) return

    const { groups, publicKey, addGroup, setGroupKey } = useNostrStore.getState()
    if (groups.find(g => g.id === groupId)) return
    if (!publicKey) return

    addGroup({
      id: groupId,
      name: groupName,
      creatorPubkey: event.pubkey,
      memberPubkeys: [publicKey],
      relayUrl: relays[0],
      lastMessage: 'Joined via invite',
      lastMessageAt: event.created_at,
    })
    setGroupKey(groupId, groupKeyHex)

    // Publish own key backup so cross-device recovery works
    const backup = await buildGroupKeyBackupEvent(groupId, [groupKeyHex])
    publishEvent(useNostrStore.getState().writeRelays(), backup).catch(() => {})
  } catch {
    // not a valid group invite or build/publish failed — ignore
  }
}

/** Resolve the chat (channel/group) an event belongs to from its NIP-10 e tags. */
export function extractRootChatId(tags: string[][]): string | null {
  const root = tags.find(t => t[0] === 'e' && t[3] === 'root')
  if (root?.[1]) return root[1]
  return tags.find(t => t[0] === 'e')?.[1] ?? null
}

/**
 * Resolve the private group an event belongs to from its h tag. Group ids
 * are UUIDs, not event ids, so they ride h tags — strict relays reject
 * non-hex values in e tags ("unexpected size for fixed-size tag").
 */
export function extractGroupId(tags: string[][]): string | null {
  return tags.find(t => t[0] === 'h')?.[1] ?? null
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

  // Route reaction / edit / delete control messages; not shown as messages
  if (routeReaction(event.content, event)) return
  if (routeMessageOp(event.content, event)) return

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

  const { publicKey, channels, profiles, updateChannelLastMessage } = useNostrStore.getState()
  const isMention = !!publicKey && isMentioned(publicKey, event.content, event.tags)
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
    decrypted = await decryptDM(peer, event.content)
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

  // Group invites join a group, they are not chat messages. Handle and stop.
  if (decrypted.startsWith('{')) {
    try {
      if ((JSON.parse(decrypted) as { type?: string })?.type === 'group_invite') {
        await handleGroupInvite(event, decrypted, relays)
        return
      }
    } catch { /* not JSON — regular message */ }
  }

  // Route reaction / edit / delete control messages; not shown as messages
  if (routeReaction(decrypted, event)) return
  if (routeMessageOp(decrypted, event)) return

  // 1:1 call history record: stored as a message (rendered as a call row),
  // but with its own preview text and quieter badge/notification rules.
  const callLog = parseCallLogPayload(decrypted)

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
    useNostrStore.setState(state =>
      state.contacts.some(c => c.pubkey === peer)
        ? state
        : { contacts: [{ pubkey: peer, pending: true }, ...state.contacts] }
    )
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
  const preview = callLog ? callLogLabel(callLog, false) : getPreviewText(decrypted)
  // Completed/declined call rows are records of a call you took part in —
  // nothing is unread. Only missed/busy behave like an unread message.
  const isMissedCall = callLog !== null && (callLog.outcome === 'missed' || callLog.outcome === 'busy')
  const countsAsUnread = callLog === null || isMissedCall
  updateContactLastMessage(peer, preview, event.created_at, {
    incrementUnread: countsAsUnread && shouldCountUnread(peer, event.created_at, opts.live),
  })

  if (opts.live && !isPending && (callLog === null || isMissedCall)) {
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

  // Route reaction / edit / delete control messages; not shown as messages
  if (routeReaction(plaintext, event)) return
  if (routeMessageOp(plaintext, event)) return
  if (await routeCallStart(plaintext, groupId, event, opts.live)) return

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
  const isMention = !!publicKey && isMentioned(publicKey, plaintext, event.tags)
  updateGroupLastMessage(groupId, getPreviewText(plaintext), event.created_at, isMention, {
    incrementUnread: shouldCountUnread(groupId, event.created_at, opts.live),
  })

  if (opts.live && event.pubkey !== publicKey) {
    const groupName = groups.find((g: Group) => g.id === groupId)?.name || 'Group'
    fireNotification(groupId, 'channel', groupName, `${getDisplayName(profiles[event.pubkey], event.pubkey)}: ${getPreviewText(plaintext)}`)
  }

  ensureProfile(event.pubkey, relays)
}
