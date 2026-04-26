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
  fetchEvent,
  type NostrProfile,
} from '../lib/nostr'
import { useNostrStore, type Channel, type Message } from '../store/nostrStore'
import { fireNotification } from '../lib/notifications'
import {
  parseTransferPayload,
  handleFileStart,
  handleFileChunk,
  reconstructDataUrl,
  sendChunkedFile as sendChunkedFileUtil,
  type IncomingTransfer,
} from '../lib/fileTransfer'
import { serializeMessage, getDisplayName, getPreviewText } from '../lib/fileUtils'

// Module-level set to deduplicate concurrent in-flight profile fetches
const fetchingProfiles = new Set<string>()

// Plaintext content limit (channels + decrypted DMs): covers inline attachments
// up to the 150 KB INLINE_BASE64_THRESHOLD plus JSON wrapper overhead.
const MAX_CONTENT_LEN = 200_000
// NIP-04 encrypts then base64-encodes, inflating size by ~33%.
// 200 KB plaintext → ~270 KB encrypted; use 300 KB to give headroom.
const MAX_ENCRYPTED_CONTENT_LEN = 300_000

// Hook to load profiles for a list of pubkeys
export function useProfileLoader(pubkeys: string[]) {
  const { relays, setProfile, profiles } = useNostrStore()

  useEffect(() => {
    if (!pubkeys.length) return
    const missing = pubkeys.filter(pk => !profiles[pk])
    if (!missing.length) return

    const sub = subscribeEvents(
      relays,
      { kinds: [0], authors: missing },
      (event) => {
        const profile = parseProfile(event)
        setProfile(event.pubkey, profile)
      }
    )
    return () => sub.close()
  }, [pubkeys.join(','), relays.join(',')])
}

// Hook to subscribe to public channel messages
export function useChannelMessages(channelId: string | null) {
  const { relays, addMessage, updateChannelLastMessage, setProfile, profiles } = useNostrStore()

  useEffect(() => {
    if (!channelId) return

    const sub = subscribeEvents(
      relays,
      { kinds: [42], '#e': [channelId], limit: 200 },
      (event) => {
        if (event.content.length > MAX_CONTENT_LEN) return
        // Route file-transfer control messages; don't add them to the message list
        const transfer = parseTransferPayload(event.content)
        if (transfer) {
          if (transfer.type === 'file_start') {
            handleFileStart(transfer.transferId, transfer, channelId, event.pubkey, event.created_at)
          } else {
            const completed = handleFileChunk(transfer.transferId, transfer.index, transfer.data)
            if (completed) finishTransfer(completed)
          }
          return
        }

        const msg: Message = {
          id: event.id,
          pubkey: event.pubkey,
          content: event.content,
          createdAt: event.created_at,
          tags: event.tags,
          kind: event.kind,
          channelId,
        }
        addMessage(channelId, msg)

        const { publicKey, npub, channels, profiles: p } = useNostrStore.getState()
        const isMention = !!(
          publicKey && (event.content.includes(publicKey) || (npub && event.content.includes(npub)))
        )
        updateChannelLastMessage(channelId, getPreviewText(event.content), event.created_at, isMention)

        if (event.pubkey !== publicKey) {
          const channelName = channels.find(c => c.id === channelId)?.name || 'Channel'
          const senderName = getDisplayName(p[event.pubkey], event.pubkey)
          const preview = getPreviewText(event.content)
          fireNotification(channelId, isMention ? 'mention' : 'channel', `#${channelName}`, `${senderName}: ${preview}`)
        }

        if (!profiles[event.pubkey] && !fetchingProfiles.has(event.pubkey)) {
          fetchingProfiles.add(event.pubkey)
          fetchEvent(relays, { kinds: [0], authors: [event.pubkey] })
            .then(profileEvent => { if (profileEvent) setProfile(profileEvent.pubkey, parseProfile(profileEvent)) })
            .finally(() => fetchingProfiles.delete(event.pubkey))
        }
      }
    )
    return () => sub.close()
  }, [channelId, relays.join(',')])
}

// Hook to subscribe to DMs (two separate subscriptions: sent + received)
export function useDMMessages(myPubkey: string | null, theirPubkey: string | null) {
  const { relays, getPrivateKey, addMessage, updateContactLastMessage, setProfile, profiles } = useNostrStore()

  useEffect(() => {
    if (!myPubkey || !theirPubkey) return
    const sk = getPrivateKey()
    if (!sk) return

    const chatId = theirPubkey

    const handleEvent = async (event: { id: string; pubkey: string; content: string; created_at: number; tags: string[][]; kind: number }) => {
      if (event.content.length > MAX_ENCRYPTED_CONTENT_LEN) return
      try {
        const peerPubkey = event.pubkey === myPubkey ? theirPubkey : event.pubkey
        const decrypted = await decryptDM(sk, peerPubkey, event.content)
        if (decrypted.length > MAX_CONTENT_LEN) return

        // Route file-transfer control messages
        const transfer = parseTransferPayload(decrypted)
        if (transfer) {
          if (transfer.type === 'file_start') {
            handleFileStart(transfer.transferId, transfer, chatId, event.pubkey, event.created_at)
          } else {
            const completed = handleFileChunk(transfer.transferId, transfer.index, transfer.data)
            if (completed) finishTransfer(completed)
          }
          return
        }

        const msg: Message = {
          id: event.id,
          pubkey: event.pubkey,
          content: decrypted,
          createdAt: event.created_at,
          tags: event.tags,
          kind: event.kind,
          recipientPubkey: theirPubkey,
          decrypted: true,
        }
        addMessage(chatId, msg)
        if (event.pubkey !== myPubkey) {
          updateContactLastMessage(theirPubkey, getPreviewText(decrypted), event.created_at)
          const { profiles: p } = useNostrStore.getState()
          const senderName = getDisplayName(p[event.pubkey], event.pubkey)
          const preview = getPreviewText(decrypted)
          fireNotification(chatId, 'dm', senderName, preview, p[event.pubkey]?.picture)
        }

        if (!profiles[event.pubkey] && !fetchingProfiles.has(event.pubkey)) {
          fetchingProfiles.add(event.pubkey)
          fetchEvent(relays, { kinds: [0], authors: [event.pubkey] })
            .then(profileEvent => { if (profileEvent) setProfile(profileEvent.pubkey, parseProfile(profileEvent)) })
            .finally(() => fetchingProfiles.delete(event.pubkey))
        }
      } catch {
        // Decryption failed - skip
      }
    }

    // Messages I sent to them
    const sub1 = subscribeEvents(
      relays,
      { kinds: [4], authors: [myPubkey], '#p': [theirPubkey], limit: 200 },
      handleEvent,
    )
    // Messages they sent to me
    const sub2 = subscribeEvents(
      relays,
      { kinds: [4], authors: [theirPubkey], '#p': [myPubkey], limit: 200 },
      handleEvent,
    )
    return () => {
      sub1.close()
      sub2.close()
    }
  }, [myPubkey, theirPubkey, relays.join(',')])
}

// Hook to discover public channels
export function useChannelDiscovery() {
  const { relays, addChannel } = useNostrStore()

  useEffect(() => {
    const sub = subscribeEvents(
      relays,
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
            relayUrl: relays[0],
          }
          addChannel(channel)
        } catch {
          // ignore malformed
        }
      }
    )
    return () => sub.close()
  }, [relays.join(',')])
}

// ─── File transfer helpers ───────────────────────────────────────────────────

/** Called when the last chunk of an incoming transfer arrives. Reconstructs and stores the message. */
function finishTransfer(t: IncomingTransfer) {
  const { addMessage, publicKey } = useNostrStore.getState()
  // Sender already added the message optimistically in handleSendChunked
  if (t.senderPubkey === publicKey) return
  const dataUrl = reconstructDataUrl(t.mime, t.chunks, t.totalChunks)
  const content = serializeMessage('', { name: t.name, type: t.mime, size: t.size, data: dataUrl })
  addMessage(t.chatId, {
    id: `transfer-${t.senderPubkey}-${t.createdAt}`,
    pubkey: t.senderPubkey,
    content,
    createdAt: t.createdAt,
    tags: [],
    kind: 4,
  })
}

/** Send a large file as chunked Nostr events (DM or channel). */
export async function sendChunkedFile(
  sk: Uint8Array,
  myPubkey: string,
  dataUrl: string,
  name: string,
  mime: string,
  size: number,
  chatType: 'dm' | 'channel',
  chatId: string,
  relays: string[],
  onProgress: (sent: number, total: number) => void,
): Promise<void> {
  return sendChunkedFileUtil(sk, myPubkey, dataUrl, name, mime, size, chatType, chatId, relays, onProgress)
}

// Send a channel message; replyEventId adds NIP-10 reply tag
export async function sendChannelMessage(
  sk: Uint8Array,
  content: string,
  channelId: string,
  relays: string[],
  replyEventId?: string,
) {
  const event = buildChannelMessageEvent(sk, content, channelId, relays[0], replyEventId)
  await publishEvent(relays, event)
  return event
}

// Send a DM
export async function sendDM(
  sk: Uint8Array,
  content: string,
  recipientPubkey: string,
  relays: string[]
) {
  const event = await buildDMEvent(sk, recipientPubkey, content)
  await publishEvent(relays, event)
  return event
}

// Create a new channel
export async function createChannel(
  sk: Uint8Array,
  name: string,
  about: string,
  relays: string[]
) {
  const event = buildChannelCreateEvent(sk, name, about)
  await publishEvent(relays, event)
  return event
}

// Publish profile
export async function publishProfile(
  sk: Uint8Array,
  profile: Partial<NostrProfile>,
  relays: string[]
) {
  const event = buildProfileEvent(sk, profile)
  await publishEvent(relays, event)
  return event
}
