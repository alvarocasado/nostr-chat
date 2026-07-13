import { useEffect } from 'react'
import {
  subscribeEvents,
  publishEvent,
  parseProfile,
  buildChannelCreateEvent,
  buildChannelMessageEvent,
  buildDMEvent,
  buildGroupMessageEvent,
  buildProfileEvent,
  GROUP_MESSAGE_KIND,
  LEGACY_GROUP_MESSAGE_KIND,
  type NostrProfile,
} from '../lib/nostr'
import { encryptWithGroupKey } from '../lib/groupCrypto'
import { serializeReaction } from '../lib/reactions'
import { serializeCallStart } from '../lib/groupCall'
import { useNostrStore, type Channel } from '../store/nostrStore'
import {
  processChannelEvent,
  processDMEvent,
  processGroupEvent,
  extractRootChatId,
  extractGroupId,
} from '../lib/inbox'
import { useStableArray } from './useStableArray'
import { useReadRelays } from './useRelays'
import { usePeerRelays } from './usePeerRelays'
import { combineRelays } from '../lib/peerRelays'
import { getSigner } from '../lib/signer'
import { INITIAL_PAGE } from '../lib/pagination'

// Hook to load profiles for a list of pubkeys
export function useProfileLoader(pubkeys: string[]) {
  const { setProfile } = useNostrStore()
  const stablePubkeys = useStableArray(pubkeys)
  const stableRelays = useReadRelays()

  useEffect(() => {
    if (!stablePubkeys.length) return
    const missing = stablePubkeys.filter(pk => !useNostrStore.getState().profiles[pk])
    if (!missing.length) return

    const sub = subscribeEvents(
      stableRelays,
      { kinds: [0], authors: missing },
      (event) => {
        const profile = parseProfile(event)
        setProfile(event.pubkey, profile)
      }
    )
    return () => sub.close()
  }, [stablePubkeys, stableRelays, setProfile])
}

// Hook to subscribe to public channel messages
export function useChannelMessages(channelId: string | null) {
  const stableRelays = useReadRelays()

  useEffect(() => {
    if (!channelId) return

    let live = false
    const sub = subscribeEvents(
      stableRelays,
      { kinds: [42], '#e': [channelId], limit: INITIAL_PAGE },
      (event) => { void processChannelEvent(event, channelId, stableRelays, { live }) },
      () => { live = true },
    )
    return () => sub.close()
  }, [channelId, stableRelays])
}

// Hook to subscribe to DMs (two separate subscriptions: sent + received)
export function useDMMessages(myPubkey: string | null, theirPubkey: string | null) {
  const stableRelays = useReadRelays()
  const peer = usePeerRelays(theirPubkey)
  const receivedRelays = useStableArray(combineRelays(stableRelays, peer.write))
  // On restored sessions the signer is installed asynchronously after the
  // store rehydrates; setSignerCaps stores a fresh object, so depending on it
  // re-runs this effect once the signer exists (the getSigner guard below
  // otherwise kills the subscription for the whole session).
  const signerCaps = useNostrStore(s => s.signerCaps)

  useEffect(() => {
    if (!myPubkey || !theirPubkey) return
    if (!getSigner()) return

    // Messages I sent to them — my relays
    let live1 = false
    const sub1 = subscribeEvents(
      stableRelays,
      { kinds: [4], authors: [myPubkey], '#p': [theirPubkey], limit: INITIAL_PAGE },
      (event) => { void processDMEvent(event, myPubkey, stableRelays, { live: live1 }) },
      () => { live1 = true },
    )
    // Messages they sent to me — my read relays + their write relays (outbox)
    let live2 = false
    const sub2 = subscribeEvents(
      receivedRelays,
      { kinds: [4], authors: [theirPubkey], '#p': [myPubkey], limit: INITIAL_PAGE },
      (event) => { void processDMEvent(event, myPubkey, receivedRelays, { live: live2 }) },
      () => { live2 = true },
    )
    return () => {
      sub1.close()
      sub2.close()
    }
  }, [myPubkey, theirPubkey, stableRelays, receivedRelays, signerCaps])
}

// Hook to discover public channels
export function useChannelDiscovery() {
  const { addChannel } = useNostrStore()
  const stableRelays = useReadRelays()

  useEffect(() => {
    const sub = subscribeEvents(
      stableRelays,
      { kinds: [40], limit: 50 },
      (event) => {
        try {
          const meta = JSON.parse(event.content)
          const channel: Channel = {
            id: event.id,
            name: meta.name || 'Unnamed Channel',
            about: meta.about,
            picture: meta.picture,
            creatorPubkey: event.pubkey,
            relayUrl: stableRelays[0],
          }
          addChannel(channel)
        } catch {
          // ignore malformed
        }
      }
    )
    return () => sub.close()
  }, [stableRelays, addChannel])
}

// Hook to subscribe to encrypted group messages
export function useGroupMessages(groupId: string | null) {
  const { groupKeys } = useNostrStore()
  const groupKey = groupId ? groupKeys[groupId] : null
  const stableRelays = useReadRelays()

  useEffect(() => {
    if (!groupId || !groupKey) return

    let live = false
    const sub = subscribeEvents(
      stableRelays,
      { kinds: [GROUP_MESSAGE_KIND, LEGACY_GROUP_MESSAGE_KIND], '#h': [groupId], limit: INITIAL_PAGE },
      (event) => { void processGroupEvent(event, groupId, useNostrStore.getState().allGroupKeys(groupId), stableRelays, { live }) },
      () => { live = true },
    )
    return () => sub.close()
  }, [groupId, groupKey, stableRelays])
}

// App-level inbox: keeps unread counts, sidebar previews, and notifications
// working for chats that are not currently open. Per-chat hooks above provide
// history backfill; the shared processors deduplicate side effects between them.
export function useGlobalInbox() {
  const { publicKey, joinedChannelIds, groups, signerCaps } = useNostrStore()
  const stableRelays = useReadRelays()
  const stableJoined = useStableArray(joinedChannelIds)
  const groupIds = useStableArray(groups.map(g => g.id))

  // All DMs addressed to me
  useEffect(() => {
    if (!publicKey) return
    if (!getSigner()) return

    let live = false
    const sub = subscribeEvents(
      stableRelays,
      { kinds: [4], '#p': [publicKey], limit: 100 },
      (event) => { void processDMEvent(event, publicKey, stableRelays, { live }) },
      () => { live = true },
    )
    return () => sub.close()
    // signerCaps: restored sessions install the signer after rehydration; the
    // fresh caps object re-runs this effect so the inbox subscribes at all.
  }, [publicKey, stableRelays, signerCaps])

  // All joined channels in one subscription
  useEffect(() => {
    if (!publicKey || stableJoined.length === 0) return
    const joined = new Set(stableJoined)

    let live = false
    const sub = subscribeEvents(
      stableRelays,
      { kinds: [42], '#e': stableJoined, limit: 50 },
      (event) => {
        const chatId = extractRootChatId(event.tags)
        if (chatId && joined.has(chatId)) void processChannelEvent(event, chatId, stableRelays, { live })
      },
      () => { live = true },
    )
    return () => sub.close()
  }, [publicKey, stableJoined, stableRelays])

  // All groups in one subscription; key looked up at event time so messages
  // flow as soon as a key arrives via invite or relay backup
  useEffect(() => {
    if (!publicKey || groupIds.length === 0) return
    const ids = new Set(groupIds)

    let live = false
    const sub = subscribeEvents(
      stableRelays,
      { kinds: [GROUP_MESSAGE_KIND, LEGACY_GROUP_MESSAGE_KIND], '#h': groupIds, limit: 50 },
      (event) => {
        const chatId = extractGroupId(event.tags)
        if (!chatId || !ids.has(chatId)) return
        const keys = useNostrStore.getState().allGroupKeys(chatId)
        if (keys.length > 0) void processGroupEvent(event, chatId, keys, stableRelays, { live })
      },
      () => { live = true },
    )
    return () => sub.close()
  }, [publicKey, groupIds, stableRelays])
}


// ─── Send / publish helpers ──────────────────────────────────────────────────

// Send a channel message; replyEventId adds NIP-10 reply tag
export async function sendChannelMessage(
  content: string,
  channelId: string,
  relays: string[],
  replyEventId?: string,
) {
  const event = await buildChannelMessageEvent(content, channelId, relays[0], replyEventId)
  await publishEvent(relays, event)
  return event
}

// Send a DM
export async function sendDM(
  content: string,
  recipientPubkey: string,
  relays: string[],
) {
  const event = await buildDMEvent(recipientPubkey, content)
  await publishEvent(relays, event)
  return event
}

// ─── Reactions ───────────────────────────────────────────────────────────────
// Reactions ride the same transports as messages so DM/group reactions stay
// encrypted; the inbox processors route them out before they reach the message
// list. See lib/reactions.ts for the rationale.

export async function sendChannelReaction(
  target: string, emoji: string, op: 'add' | 'remove', channelId: string, relays: string[],
) {
  return sendChannelMessage(serializeReaction(target, emoji, op), channelId, relays)
}

export async function sendDMReaction(
  target: string, emoji: string, op: 'add' | 'remove', peer: string, relays: string[],
) {
  return sendDM(serializeReaction(target, emoji, op), peer, relays)
}

// Send an already-serialized control message (reaction/edit/delete) to a group,
// encrypted with the group key so it rides the same transport as messages.
export async function sendGroupControl(content: string, groupId: string, groupKey: string, relays: string[]) {
  const encrypted = await encryptWithGroupKey(content, groupKey)
  const event = await buildGroupMessageEvent(encrypted, groupId, relays[0])
  await publishEvent(relays, event)
  return event
}

export async function sendGroupReaction(
  target: string, emoji: string, op: 'add' | 'remove', groupId: string, groupKey: string, relays: string[],
) {
  return sendGroupControl(serializeReaction(target, emoji, op), groupId, groupKey, relays)
}

export async function sendGroupCallStart(callId: string, groupId: string, groupKey: string, relays: string[]) {
  return sendGroupControl(serializeCallStart(callId), groupId, groupKey, relays)
}

// Create a new channel
export async function createChannel(
  name: string,
  about: string,
  relays: string[],
) {
  const event = await buildChannelCreateEvent(name, about)
  await publishEvent(relays, event)
  return event
}

// Publish profile
export async function publishProfile(
  profile: Partial<NostrProfile>,
  relays: string[],
) {
  const event = await buildProfileEvent(profile)
  await publishEvent(relays, event)
  return event
}
