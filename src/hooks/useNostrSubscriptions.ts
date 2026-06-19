import { useEffect } from 'react'
import {
  subscribeEvents,
  publishEvent,
  parseProfile,
  decryptDM,
  buildChannelCreateEvent,
  buildChannelMessageEvent,
  buildDMEvent,
  buildProfileEvent,
  buildGroupKeyBackupEvent,
  GROUP_MESSAGE_KIND,
  LEGACY_GROUP_MESSAGE_KIND,
  type NostrProfile,
} from '../lib/nostr'
import { useNostrStore, type Channel, type Group } from '../store/nostrStore'
import {
  processChannelEvent,
  processDMEvent,
  processGroupEvent,
  extractRootChatId,
} from '../lib/inbox'
import { sendChunkedFile as sendChunkedFileUtil } from '../lib/fileTransfer'
import { useStableArray } from './useStableArray'
import { getSigner } from '../lib/signer'

// Hook to load profiles for a list of pubkeys
export function useProfileLoader(pubkeys: string[]) {
  const { relays, setProfile } = useNostrStore()
  const stablePubkeys = useStableArray(pubkeys)
  const stableRelays = useStableArray(relays)

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
  const { relays } = useNostrStore()
  const stableRelays = useStableArray(relays)

  useEffect(() => {
    if (!channelId) return

    let live = false
    const sub = subscribeEvents(
      stableRelays,
      { kinds: [42], '#e': [channelId], limit: 200 },
      (event) => { void processChannelEvent(event, channelId, stableRelays, { live }) },
      () => { live = true },
    )
    return () => sub.close()
  }, [channelId, stableRelays])
}

// Hook to subscribe to DMs (two separate subscriptions: sent + received)
export function useDMMessages(myPubkey: string | null, theirPubkey: string | null) {
  const { relays } = useNostrStore()
  const stableRelays = useStableArray(relays)

  useEffect(() => {
    if (!myPubkey || !theirPubkey) return
    if (!getSigner()) return

    // Messages I sent to them
    let live1 = false
    const sub1 = subscribeEvents(
      stableRelays,
      { kinds: [4], authors: [myPubkey], '#p': [theirPubkey], limit: 200 },
      (event) => { void processDMEvent(event, myPubkey, stableRelays, { live: live1 }) },
      () => { live1 = true },
    )
    // Messages they sent to me
    let live2 = false
    const sub2 = subscribeEvents(
      stableRelays,
      { kinds: [4], authors: [theirPubkey], '#p': [myPubkey], limit: 200 },
      (event) => { void processDMEvent(event, myPubkey, stableRelays, { live: live2 }) },
      () => { live2 = true },
    )
    return () => {
      sub1.close()
      sub2.close()
    }
  }, [myPubkey, theirPubkey, stableRelays])
}

// Hook to discover public channels
export function useChannelDiscovery() {
  const { relays, addChannel } = useNostrStore()
  const stableRelays = useStableArray(relays)

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
  const { relays, groupKeys } = useNostrStore()
  const groupKey = groupId ? groupKeys[groupId] : null
  const stableRelays = useStableArray(relays)

  useEffect(() => {
    if (!groupId || !groupKey) return

    let live = false
    const sub = subscribeEvents(
      stableRelays,
      { kinds: [GROUP_MESSAGE_KIND, LEGACY_GROUP_MESSAGE_KIND], '#e': [groupId], limit: 200 },
      (event) => { void processGroupEvent(event, groupId, groupKey, stableRelays, { live }) },
      () => { live = true },
    )
    return () => sub.close()
  }, [groupId, groupKey, stableRelays])
}

// App-level inbox: keeps unread counts, sidebar previews, and notifications
// working for chats that are not currently open. Per-chat hooks above provide
// history backfill; the shared processors deduplicate side effects between them.
export function useGlobalInbox() {
  const { publicKey, relays, joinedChannelIds, groups } = useNostrStore()
  const stableRelays = useStableArray(relays)
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
  }, [publicKey, stableRelays])

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
      { kinds: [GROUP_MESSAGE_KIND, LEGACY_GROUP_MESSAGE_KIND], '#e': groupIds, limit: 50 },
      (event) => {
        const chatId = extractRootChatId(event.tags)
        if (!chatId || !ids.has(chatId)) return
        const key = useNostrStore.getState().groupKeys[chatId]
        if (key) void processGroupEvent(event, chatId, key, stableRelays, { live })
      },
      () => { live = true },
    )
    return () => sub.close()
  }, [publicKey, groupIds, stableRelays])
}

// Hook to detect incoming group invites from kind-4 DMs addressed to the local user.
// Mount once at app level (inside App component when logged in).
export function useGroupInviteListener() {
  const { relays, publicKey, addGroup, setGroupKey } = useNostrStore()
  const stableRelays = useStableArray(relays)

  useEffect(() => {
    if (!publicKey) return
    if (!getSigner()) return

    const sub = subscribeEvents(
      stableRelays,
      { kinds: [4], '#p': [publicKey], limit: 100 },
      async (event) => {
        try {
          const decrypted = await decryptDM(event.pubkey, event.content)
          const payload = JSON.parse(decrypted) as { type?: string; groupId?: string; groupKeyHex?: string; groupName?: string }
          if (payload?.type !== 'group_invite') return
          const { groupId, groupKeyHex, groupName } = payload
          if (!groupId || !groupKeyHex || !groupName) return
          if (useNostrStore.getState().groups.find((g: Group) => g.id === groupId)) return

          addGroup({
            id: groupId,
            name: groupName,
            creatorPubkey: event.pubkey,
            memberPubkeys: [publicKey],
            relayUrl: stableRelays[0],
            lastMessage: 'Joined via invite',
            lastMessageAt: event.created_at,
          })
          setGroupKey(groupId, groupKeyHex)

          // Publish own key backup so cross-device recovery works
          const backup = await buildGroupKeyBackupEvent(groupId, groupKeyHex)
          publishEvent(stableRelays, backup).catch(() => {})
        } catch {
          // not a group invite or decryption failed
        }
      },
    )
    return () => sub.close()
  }, [publicKey, stableRelays, addGroup, setGroupKey])
}

// ─── Send / publish helpers ──────────────────────────────────────────────────

/** Send a large file as chunked Nostr events (DM or channel). */
export async function sendChunkedFile(
  dataUrl: string,
  name: string,
  mime: string,
  size: number,
  chatType: 'dm' | 'channel',
  chatId: string,
  relays: string[],
  onProgress: (sent: number, total: number) => void,
): Promise<void> {
  return sendChunkedFileUtil(dataUrl, name, mime, size, chatType, chatId, relays, onProgress)
}

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
