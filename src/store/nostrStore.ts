import { create } from 'zustand'
import { persist, createJSONStorage, type StorageValue } from 'zustand/middleware'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { encodeNsec, encodePubkey, type NostrProfile, DEFAULT_RELAYS } from '../lib/nostr'
import { LocalSigner, Nip07Signer, setSigner, clearSigner, getSigner } from '../lib/signer'
import {
  openUserDb,
  closeUserDb,
  getUserDb,
  getSetting,
  setSetting,
  setActivePubkey,
  clearActivePubkey,
  setAuthMethod,
  clearAuthMethod,
} from '../lib/userDb'
import { saveLocalKey, clearLocalKey, hasLocalKey, keyProtection } from '../lib/keyStore'
import { messageToRecord, recordToMessage } from '../lib/db'
import { INITIAL_PAGE } from '../lib/pagination'
import {
  syncFromRelays,
  publishContactList,
  publishChannelBookmarks,
  publishAppSettings,
  publishRelayList,
  debounce,
  type CallsSyncedSettings,
} from '../lib/nostrSync'
import { filterRead, filterWrite, type RelayModes } from '../lib/relayRouting'
import type { ActiveCallType } from '../lib/webrtc'

export type ChatType = 'channel' | 'dm' | 'group'
export type SettingsTab = 'profile' | 'relays' | 'keys' | 'calls' | 'files' | 'notifications' | 'privacy'

export interface NotificationSettings {
  dmEnabled: boolean
  dmSound: boolean
  mentionEnabled: boolean
  mentionSound: boolean
  groupEnabled: boolean
  callEnabled: boolean
  callSound: boolean
  dndEnabled: boolean
  dndUntil: number | null  // epoch ms; null = indefinite
}

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  dmEnabled: true,
  dmSound: true,
  mentionEnabled: true,
  mentionSound: true,
  groupEnabled: false,
  callEnabled: true,
  callSound: true,
  dndEnabled: false,
  dndUntil: null,
}

export interface Channel {
  id: string
  name: string
  about?: string
  picture?: string
  creatorPubkey: string
  relayUrl: string
  lastMessage?: string
  lastMessageAt?: number
  unread?: number
  mentions?: number
}

export interface Contact {
  pubkey: string
  profile?: NostrProfile
  lastMessage?: string
  lastMessageAt?: number
  unread?: number
  pending?: boolean
}

export interface Group {
  id: string
  name: string
  about?: string
  creatorPubkey: string
  memberPubkeys: string[]
  relayUrl: string
  lastMessage?: string
  lastMessageAt?: number
  unread?: number
  mentions?: number
  removed?: boolean
}

export interface Message {
  id: string
  pubkey: string
  content: string
  createdAt: number
  tags: string[][]
  kind: number
  channelId?: string
  recipientPubkey?: string
  decrypted?: boolean
  profile?: NostrProfile
  replyTo?: {
    id: string
    pubkey: string
    previewText: string
  }
  status?: 'sending' | 'sent' | 'failed'
}

interface NostrState {
  // Auth
  publicKey: string | null
  nsec: string | null
  npub: string | null
  profile: NostrProfile | null

  // Relays
  relays: string[]
  relayModes: RelayModes

  // Channels
  channels: Channel[]
  joinedChannelIds: string[]

  // Contacts / DMs
  contacts: Contact[]

  // Groups
  groups: Group[]
  groupKeys: Record<string, string>
  groupKeyHistory: Record<string, string[]>
  groupKeyRotatedAt: Record<string, number>
  groupMembersUpdatedAt: Record<string, number>

  // Active chat
  activeChatId: string | null
  activeChatType: ChatType | null

  // Messages keyed by channelId or pubkey
  messages: Record<string, Message[]>

  // Reactions keyed by target messageId → emoji → reactor pubkeys (session-only)
  reactions: Record<string, Record<string, string[]>>

  // Edit/delete overlays keyed by target messageId. `by` is the requester; a
  // change is only honoured when `by` matches the message's own author.
  deletedMessages: Record<string, { by: string }>
  editedMessages: Record<string, { by: string; content: string; at: number }>

  // Profiles cache
  profiles: Record<string, NostrProfile>

  // UI
  sidebarTab: 'channels' | 'dms' | 'contacts'
  showSettings: boolean
  activeSettingsTab: SettingsTab | null
  viewingProfilePubkey: string | null
  showAddChannel: boolean
  showAddContact: boolean
  showAddGroup: boolean

  // Notifications
  notificationSettings: NotificationSettings
  mutedChats: Record<string, number | null>

  // Message requests: unsolicited-DM gating
  blockedPubkeys: string[]
  dismissedRequests: Record<string, number>  // pubkey → unix-seconds of dismissal

  // Read receipts (opt-in, reciprocal; DMs only). readUntilByPeer maps peer
  // pubkey to the newest watermark received from them. The receipt events are
  // ephemeral; this local copy is what survives reload (persisted like seenAt).
  readReceiptsEnabled: boolean
  readUntilByPeer: Record<string, number>

  // Drafts (session-only, not persisted)
  drafts: Record<string, string>

  // Seen-at timestamps for unread divider (persisted)
  seenAt: Record<string, number>

  // Relay sync: created_at of the last kind-30078 settings event we received or published
  syncedSettingsAt: number | null

  // Signer capabilities (runtime-only, never persisted)
  signerCaps: { nip04: boolean }

  // Which call engine holds the media (runtime-only, never persisted)
  activeCallType: ActiveCallType

  // Actions
  setSignerCaps: (caps: { nip04: boolean }) => void
  setActiveCallType: (t: ActiveCallType) => void
  generateAndLogin: () => Promise<{ nsec: string; npub: string }>
  loginFromNsec: (nsec: string) => Promise<boolean>
  loginFromHex: (hex: string) => Promise<boolean>
  loginWithExtension: () => Promise<boolean>
  logout: () => Promise<void>
  updateProfile: (profile: Partial<NostrProfile>) => void

  addRelay: (url: string) => void
  removeRelay: (url: string) => void
  setRelayMode: (url: string, read: boolean, write: boolean) => void
  readRelays: () => string[]
  writeRelays: () => string[]

  addChannel: (channel: Channel) => void
  joinChannel: (id: string) => void
  leaveChannel: (id: string) => void

  addContact: (pubkey: string) => void
  removeContact: (pubkey: string) => void

  acceptMessageRequest: (pubkey: string) => void
  dismissMessageRequest: (pubkey: string) => void
  blockPubkey: (pubkey: string) => void
  unblockPubkey: (pubkey: string) => void

  setReadReceiptsEnabled: (enabled: boolean) => void
  setPeerReadUntil: (peerPubkey: string, readUntil: number) => void

  setActiveChat: (id: string, type: ChatType) => void
  clearActiveChat: () => void

  targetMessageId: string | null

  jumpToMessage: (chatId: string, type: ChatType, messageId: string) => void
  clearTargetMessage: () => void

  addMessage: (chatId: string, message: Message) => void
  applyReaction: (messageId: string, emoji: string, pubkey: string, op: 'add' | 'remove') => void
  applyDelete: (messageId: string, by: string) => void
  removeDelete: (messageId: string) => void
  applyEdit: (messageId: string, by: string, content: string, at: number) => void
  removeEdit: (messageId: string) => void
  prependMessages: (chatId: string, msgs: Message[]) => void
  updateMessageStatus: (chatId: string, msgId: string, status: 'sending' | 'sent' | 'failed') => void
  markRead: (chatId: string) => void
  updateContactLastMessage: (pubkey: string, content: string, at: number, opts?: { incrementUnread?: boolean }) => void
  updateChannelLastMessage: (channelId: string, content: string, at: number, isMention?: boolean, opts?: { incrementUnread?: boolean }) => void

  setProfile: (pubkey: string, profile: NostrProfile) => void

  setSidebarTab: (tab: 'channels' | 'dms' | 'contacts') => void
  setShowSettings: (show: boolean) => void
  setActiveSettingsTab: (tab: SettingsTab | null) => void
  setShowAddChannel: (show: boolean) => void
  setShowAddContact: (show: boolean) => void
  addGroup: (group: Group) => void
  removeGroup: (id: string) => void
  updateGroupLastMessage: (groupId: string, content: string, at: number, isMention?: boolean, opts?: { incrementUnread?: boolean }) => void
  setGroupKey: (groupId: string, keyHex: string) => void
  rotateGroupKey: (groupId: string, newKeyHex: string, rotatedAt: number) => void
  setGroupMembers: (groupId: string, memberPubkeys: string[], updatedAt: number) => void
  markGroupRemoved: (groupId: string) => void
  clearGroupRemoved: (groupId: string) => void
  allGroupKeys: (groupId: string) => string[]
  setShowAddGroup: (show: boolean) => void
  setViewingProfilePubkey: (pubkey: string | null) => void

  updateNotificationSettings: (s: Partial<NotificationSettings>) => void
  muteChatUntil: (chatId: string, until: number | null) => void
  unmuteChat: (chatId: string) => void

  setDraft: (chatId: string, text: string) => void
  clearDraft: (chatId: string) => void

  updateSeenAt: (chatId: string, at: number) => void
  triggerSettingsSync: () => void
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

// Rehydrate existing user data from Dexie before completing login.
async function loadExistingUserState(pubkey: string): Promise<Partial<NostrState>> {
  const db = getUserDb()
  if (!db) return {}
  try {
    const record = await db.settings.get('nostr-chat-storage')
    if (!record) return {}
    const parsed = JSON.parse(record.value) as StorageValue<Partial<NostrState>>
    const stored = parsed?.state ?? {}
    if (stored.publicKey && stored.publicKey !== pubkey) return {}
    return stored
  } catch {
    return {}
  }
}

// Shared helper: merge relay sync result into store state. Non-fatal — caller wraps in .catch(()=>{}).
export function applySyncResult(
  result: Awaited<ReturnType<typeof syncFromRelays>>,
  set: (s: Partial<NostrState>) => void,
  get: () => NostrState,
): void {
  // Relay list (kind 10002): adopt as source of truth when present.
  if (result.relayList && result.relayList.urls.length > 0) {
    set({ relays: result.relayList.urls, relayModes: result.relayList.modes })
  } else {
    // No published relay list yet — publish current relays so future logins find it.
    get().triggerSettingsSync()
  }

  // Contacts: additive merge — relay contacts added to local, never removed here
  if (result.contacts) {
    const current = get().contacts
    const localSet = new Set(current.map(c => c.pubkey))
    const incoming = result.contacts.pubkeys
      .filter(p => !localSet.has(p))
      .map(p => ({ pubkey: p }))
    if (incoming.length > 0) {
      set({ contacts: [...current, ...incoming] })
    }
  }

  // Joined channels: additive merge
  if (result.channels) {
    const localSet = new Set(get().joinedChannelIds)
    const incoming = result.channels.channelIds.filter(id => !localSet.has(id))
    if (incoming.length > 0) {
      set({ joinedChannelIds: [...get().joinedChannelIds, ...incoming] })
    }
  }

  // Group keys: relay backup fills gaps; local state takes precedence
  if (result.groupKeys && Object.keys(result.groupKeys).length > 0) {
    const mergedKeys = { ...get().groupKeys }
    const mergedHistory = { ...get().groupKeyHistory }
    for (const [gid, list] of Object.entries(result.groupKeys)) {
      if (mergedKeys[gid] !== undefined || list.length === 0) continue
      mergedKeys[gid] = list[list.length - 1]
      if (list.length > 1) mergedHistory[gid] = list.slice(0, -1)
    }
    set({ groupKeys: mergedKeys, groupKeyHistory: mergedHistory })
  }

  // Settings: apply only when the relay event is newer than the last one we synced
  if (result.settings) {
    const lastSynced = get().syncedSettingsAt
    if (!lastSynced || result.settings.createdAt > lastSynced) {
      const s = result.settings.settings
      set({
        ...(s.notificationSettings !== undefined ? { notificationSettings: s.notificationSettings } : {}),
        ...(s.mutedChats !== undefined ? { mutedChats: s.mutedChats } : {}),
        ...(s.relays !== undefined && !result.relayList ? { relays: s.relays } : {}),
        ...(s.blockedPubkeys !== undefined ? { blockedPubkeys: s.blockedPubkeys } : {}),
        ...(s.dismissedRequests !== undefined ? { dismissedRequests: s.dismissedRequests } : {}),
        ...(s.readReceiptsEnabled !== undefined ? { readReceiptsEnabled: s.readReceiptsEnabled } : {}),
        syncedSettingsAt: result.settings.createdAt,
      })
      if (s.callsSettings) {
        void setSetting('turn_mode', s.callsSettings.turnMode)
        if (s.callsSettings.turnMetered) void setSetting('turn_metered_config', s.callsSettings.turnMetered)
        if (s.callsSettings.turnCustom) void setSetting('turn_custom_config', s.callsSettings.turnCustom)
      }
    }
  }
}

async function completeLogin(
  sk: Uint8Array,
  pk: string,
  nsecStr: string,
  set: (s: Partial<NostrState>) => void,
  get: () => NostrState,
): Promise<void> {
  setSigner(new LocalSigner(sk))
  set({ signerCaps: getSigner()!.caps })
  openUserDb(pk)
  if (!(await hasLocalKey()) || (await keyProtection()) !== 'passphrase') {
    await saveLocalKey(sk)
  }
  setAuthMethod('local')
  const existing = await loadExistingUserState(pk)
  if (existing.publicKey === pk) {
    set(existing)
  }
  set({
    publicKey: pk,
    nsec: nsecStr,
    npub: encodePubkey(pk),
    profile: get().profile?.pubkey === pk ? get().profile : (existing.profile ?? { pubkey: pk }),
  })
  setActivePubkey(pk)

  // Relay sync runs in background — never blocks login
  const relays = get().relays
  syncFromRelays(relays).then(result => applySyncResult(result, set, get)).catch(() => {}) // non-fatal
}

// Custom Dexie-backed storage adapter for Zustand persist.
const dexieStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const db = getUserDb()
    if (!db) return null
    try {
      const record = await db.settings.get(name)
      return record?.value ?? null
    } catch {
      return null
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    const db = getUserDb()
    if (!db) return
    await db.settings.put({ key: name, value })
  },
  removeItem: async (name: string): Promise<void> => {
    const db = getUserDb()
    if (!db) return
    await db.settings.delete(name)
  },
}

export const useNostrStore = create<NostrState>()(
  persist(
    (set, get) => {
      // Debounced relay publish helpers — read fresh state at publish time
      const scheduleContactsSync = () => {
        debounce('contacts', () => {
          const { contacts, relays } = get()
          if (getSigner()) void publishContactList(contacts, relays).catch(() => {})
        })
      }

      const scheduleChannelsSync = () => {
        debounce('channels', () => {
          const { joinedChannelIds, relays } = get()
          if (getSigner()) void publishChannelBookmarks(joinedChannelIds, relays).catch(() => {})
        })
      }

      const scheduleSettingsSync = () => {
        debounce('settings', () => {
          void (async () => {
            const { notificationSettings, mutedChats, blockedPubkeys, dismissedRequests, readReceiptsEnabled } = get()
            if (!getSigner()) return
            const now = Math.floor(Date.now() / 1000)
            const [turnMode, turnMetered, turnCustom] = await Promise.all([
              getSetting<string>('turn_mode', 'none'),
              getSetting<{ subdomain: string; apiKey: string } | null>('turn_metered_config', null),
              getSetting<{ url: string; username: string; credential: string } | null>('turn_custom_config', null),
            ])
            const VALID_TURN_MODES = ['none', 'metered', 'custom'] as const
            const safeMode: 'none' | 'metered' | 'custom' = (VALID_TURN_MODES as readonly string[]).includes(turnMode)
              ? turnMode as 'none' | 'metered' | 'custom'
              : 'none'
            const callsSettings: CallsSyncedSettings = {
              turnMode: safeMode,
              ...(turnMetered ? { turnMetered } : {}),
              ...(turnCustom  ? { turnCustom  } : {}),
            }
            const wr = get().writeRelays()
            void Promise.all([
              publishAppSettings({ notificationSettings, mutedChats, callsSettings, blockedPubkeys, dismissedRequests, readReceiptsEnabled }, wr),
              publishRelayList(wr, get().relays, get().relayModes),
            ]).then(() => set({ syncedSettingsAt: now })).catch(() => {})
          })()
        })
      }

      return {
        publicKey: null,
        nsec: null,
        npub: null,
        profile: null,
        relays: DEFAULT_RELAYS,
        relayModes: {},
        channels: [],
        joinedChannelIds: [],
        contacts: [],
        groups: [],
        groupKeys: {},
        groupKeyHistory: {},
        groupKeyRotatedAt: {},
        groupMembersUpdatedAt: {},
        activeChatId: null,
        activeChatType: null,
        targetMessageId: null,
        messages: {},
        reactions: {},
        deletedMessages: {},
        editedMessages: {},
        profiles: {},
        sidebarTab: 'channels',
        showSettings: false,
        activeSettingsTab: null,
        showAddChannel: false,
        showAddContact: false,
        showAddGroup: false,
        viewingProfilePubkey: null,
        notificationSettings: DEFAULT_NOTIFICATION_SETTINGS,
        mutedChats: {},
        blockedPubkeys: [],
        dismissedRequests: {},
        readReceiptsEnabled: false,
        readUntilByPeer: {},
        drafts: {},
        seenAt: {},
        syncedSettingsAt: null,
        signerCaps: { nip04: true },
        activeCallType: 'none',

        setSignerCaps: (caps) => set({ signerCaps: caps }),
        setActiveCallType: (t) => set({ activeCallType: t }),

        generateAndLogin: async () => {
          const sk = generateSecretKey()
          const pk = getPublicKey(sk)
          const nsec = encodeNsec(sk)
          await completeLogin(sk, pk, nsec, set, get)
          return { nsec, npub: encodePubkey(pk) }
        },

        loginFromNsec: async (nsecStr: string) => {
          try {
            const decoded = nip19.decode(nsecStr)
            if (decoded.type !== 'nsec') return false
            const sk = decoded.data as Uint8Array
            const pk = getPublicKey(sk)
            await completeLogin(sk, pk, nsecStr, set, get)
            return true
          } catch {
            return false
          }
        },

        loginFromHex: async (hex: string) => {
          try {
            const sk = hexToBytes(hex.trim())
            const pk = getPublicKey(sk)
            const nsec = encodeNsec(sk)
            await completeLogin(sk, pk, nsec, set, get)
            return true
          } catch {
            return false
          }
        },

        loginWithExtension: async () => {
          try {
            const signer = await Nip07Signer.create()
            setSigner(signer)
            set({ signerCaps: signer.caps })
            const pk = signer.pubkey
            openUserDb(pk)
            await clearLocalKey()
            const existing = await loadExistingUserState(pk)
            if (existing.publicKey === pk) set(existing)
            set({ publicKey: pk, npub: encodePubkey(pk), nsec: null, profile: existing.profile ?? { pubkey: pk } })
            setActivePubkey(pk)
            setAuthMethod('nip07')
            syncFromRelays(get().relays).then(r => applySyncResult(r, set, get)).catch(() => {})
            return true
          } catch {
            return false
          }
        },

        logout: async () => {
          set({
            publicKey: null,
            nsec: null,
            npub: null,
            profile: null,
            activeChatId: null,
            activeChatType: null,
            messages: {},
            reactions: {},
            deletedMessages: {},
            editedMessages: {},
            groups: [],
            groupKeys: {},
            groupKeyHistory: {},
            groupKeyRotatedAt: {},
            groupMembersUpdatedAt: {},
            signerCaps: { nip04: true },
            readReceiptsEnabled: false,
            readUntilByPeer: {},
            activeCallType: 'none',
          })
          clearSigner()
          await clearLocalKey()
          clearAuthMethod()
          closeUserDb()
          clearActivePubkey()
        },

        updateProfile: (profileUpdate) => {
          const current = get().profile || { pubkey: get().publicKey || '' }
          set({ profile: { ...current, ...profileUpdate } })
        },

        addRelay: (url) => {
          const relays = get().relays
          if (!relays.includes(url)) {
            set({
              relays: [...relays, url],
              relayModes: { ...get().relayModes, [url]: { read: true, write: true } },
            })
            scheduleSettingsSync()
          }
        },

        removeRelay: (url) => {
          const { [url]: _removed, ...restModes } = get().relayModes
          set({
            relays: get().relays.filter(r => r !== url),
            relayModes: restModes,
          })
          scheduleSettingsSync()
        },

        setRelayMode: (url, read, write) => {
          // never allow neither — keep at least read
          const safe = read || write ? { read, write } : { read: true, write: false }
          set({ relayModes: { ...get().relayModes, [url]: safe } })
          scheduleSettingsSync()
        },

        readRelays: () => filterRead(get().relays, get().relayModes),
        writeRelays: () => filterWrite(get().relays, get().relayModes),

        addChannel: (channel) => {
          const existing = get().channels.find(c => c.id === channel.id)
          if (!existing) {
            set({ channels: [channel, ...get().channels] })
          }
        },

        joinChannel: (id) => {
          const joined = get().joinedChannelIds
          if (!joined.includes(id)) {
            set({ joinedChannelIds: [...joined, id] })
            scheduleChannelsSync()
          }
        },

        leaveChannel: (id) => {
          set({
            joinedChannelIds: get().joinedChannelIds.filter(i => i !== id),
            activeChatId: get().activeChatId === id ? null : get().activeChatId,
          })
          scheduleChannelsSync()
        },

        addGroup: (group) => {
          if (!get().groups.find(g => g.id === group.id)) {
            set({ groups: [group, ...get().groups] })
          }
        },

        removeGroup: (id) => {
          set({
            groups: get().groups.filter(g => g.id !== id),
            activeChatId: get().activeChatId === id ? null : get().activeChatId,
          })
        },

        updateGroupLastMessage: (groupId, content, at, isMention = false, opts = {}) => {
          const isActive = get().activeChatId === groupId
          const count = opts.incrementUnread !== false
          set({
            groups: get().groups.map(g =>
              g.id === groupId
                ? {
                    ...g,
                    // Keep the newest preview: relay backfill can arrive out of order
                    ...(at >= (g.lastMessageAt ?? 0) ? { lastMessage: content, lastMessageAt: at } : {}),
                    unread: isActive ? 0 : (g.unread || 0) + (count ? 1 : 0),
                    mentions: isActive ? 0 : count && isMention ? (g.mentions || 0) + 1 : (g.mentions || 0),
                  }
                : g
            ),
          })
        },

        setGroupKey: (groupId, keyHex) => {
          set({ groupKeys: { ...get().groupKeys, [groupId]: keyHex } })
        },

        rotateGroupKey: (groupId, newKeyHex, rotatedAt) => {
          const current = get().groupKeys[groupId]
          const history = get().groupKeyHistory[groupId] ?? []
          const prevAt = get().groupKeyRotatedAt[groupId] ?? 0
          if (current === newKeyHex || history.includes(newKeyHex)) {
            if (rotatedAt > prevAt) {
              set({ groupKeyRotatedAt: { ...get().groupKeyRotatedAt, [groupId]: Math.max(prevAt, rotatedAt) } })
            }
            return
          }
          set({
            groupKeys: { ...get().groupKeys, [groupId]: newKeyHex },
            groupKeyRotatedAt: { ...get().groupKeyRotatedAt, [groupId]: Math.max(prevAt, rotatedAt) },
            ...(current !== undefined
              ? { groupKeyHistory: { ...get().groupKeyHistory, [groupId]: [...history, current] } }
              : {}),
          })
        },

        setGroupMembers: (groupId, memberPubkeys, updatedAt) => {
          const mark = get().groupMembersUpdatedAt[groupId] ?? 0
          if (updatedAt < mark) return
          set({
            groups: get().groups.map(g => g.id === groupId ? { ...g, memberPubkeys } : g),
            groupMembersUpdatedAt: { ...get().groupMembersUpdatedAt, [groupId]: Math.max(mark, updatedAt) },
          })
        },

        markGroupRemoved: (groupId) => {
          set({ groups: get().groups.map(g => g.id === groupId ? { ...g, removed: true } : g) })
        },

        clearGroupRemoved: (groupId) => {
          set({ groups: get().groups.map(g => g.id === groupId ? { ...g, removed: undefined } : g) })
        },

        allGroupKeys: (groupId) => {
          const current = get().groupKeys[groupId]
          if (!current) return []
          return [current, ...(get().groupKeyHistory[groupId] ?? []).slice().reverse()]
        },

        addContact: (pubkey) => {
          const { [pubkey]: _removed, ...restDismissed } = get().dismissedRequests
          const blockedChanged = get().blockedPubkeys.includes(pubkey)
          const hadDismissal = get().dismissedRequests[pubkey] !== undefined
          set({
            blockedPubkeys: get().blockedPubkeys.filter(p => p !== pubkey),
            dismissedRequests: restDismissed,
          })
          const existing = get().contacts.find(c => c.pubkey === pubkey)
          if (existing) {
            if (existing.pending) set({ contacts: get().contacts.map(c => c.pubkey === pubkey ? { ...c, pending: false } : c) })
          } else {
            set({ contacts: [{ pubkey }, ...get().contacts] })
          }
          scheduleContactsSync()
          if (blockedChanged || hadDismissal) scheduleSettingsSync()
        },

        removeContact: (pubkey) => {
          set({ contacts: get().contacts.filter(c => c.pubkey !== pubkey) })
          scheduleContactsSync()
        },

        acceptMessageRequest: (pubkey) => {
          const hadDismissal = get().dismissedRequests[pubkey] !== undefined
          const { [pubkey]: _removed, ...restDismissed } = get().dismissedRequests
          set({
            contacts: get().contacts.map(c => c.pubkey === pubkey ? { ...c, pending: false } : c),
            dismissedRequests: restDismissed,
          })
          scheduleContactsSync()
          if (hadDismissal) scheduleSettingsSync()
        },

        dismissMessageRequest: (pubkey) => {
          const { [pubkey]: _removed, ...restMessages } = get().messages
          set({
            contacts: get().contacts.filter(c => c.pubkey !== pubkey),
            messages: restMessages,
            dismissedRequests: { ...get().dismissedRequests, [pubkey]: Math.floor(Date.now() / 1000) },
            activeChatId: get().activeChatId === pubkey ? null : get().activeChatId,
            activeChatType: get().activeChatId === pubkey ? null : get().activeChatType,
          })
          const db = getUserDb()
          if (db) void db.messages.where('[chatId+createdAt]').between([pubkey, -Infinity], [pubkey, Infinity]).delete()
          scheduleSettingsSync()
        },

        blockPubkey: (pubkey) => {
          get().dismissMessageRequest(pubkey)
          if (!get().blockedPubkeys.includes(pubkey)) {
            set({ blockedPubkeys: [...get().blockedPubkeys, pubkey] })
          }
          scheduleSettingsSync()
        },

        unblockPubkey: (pubkey) => {
          const { [pubkey]: _removed, ...restDismissed } = get().dismissedRequests
          set({
            blockedPubkeys: get().blockedPubkeys.filter(p => p !== pubkey),
            dismissedRequests: restDismissed,
          })
          scheduleSettingsSync()
        },

        setReadReceiptsEnabled: (enabled) => {
          set({ readReceiptsEnabled: enabled })
          scheduleSettingsSync()
        },

        setPeerReadUntil: (peerPubkey, readUntil) => {
          const current = get().readUntilByPeer[peerPubkey] ?? 0
          if (readUntil <= current) return
          set({ readUntilByPeer: { ...get().readUntilByPeer, [peerPubkey]: readUntil } })
        },

        setActiveChat: (id, type) => {
          set({ activeChatId: id, activeChatType: type })
          get().markRead(id)
          const db = getUserDb()
          if (db) {
            void db.messages
              .where('[chatId+createdAt]')
              .between([id, -Infinity], [id, Infinity])
              .reverse()
              .limit(INITIAL_PAGE)
              .toArray()
              .then(records => {
                if (records.length === 0) return
                const existing = get().messages[id] || []
                const existingIds = new Set(existing.map(m => m.id))
                const fresh = records.map(recordToMessage).filter(m => !existingIds.has(m.id))
                if (fresh.length === 0) return
                const merged = [...existing, ...fresh].sort((a, b) => a.createdAt - b.createdAt)
                set({ messages: { ...get().messages, [id]: merged } })
              })
          }
        },

        clearActiveChat: () => {
          set({ activeChatId: null, activeChatType: null })
        },

        jumpToMessage: (chatId, type, messageId) => {
          get().setActiveChat(chatId, type)
          set({ targetMessageId: messageId })
        },

        clearTargetMessage: () => set({ targetMessageId: null }),

        addMessage: (chatId, message) => {
          const existing = get().messages[chatId] || []
          if (existing.find(m => m.id === message.id)) return
          const sorted = [...existing, message].sort((a, b) => a.createdAt - b.createdAt)
          set({ messages: { ...get().messages, [chatId]: sorted } })
          const db = getUserDb()
          if (db) void db.messages.put(messageToRecord(chatId, message))
        },

        applyReaction: (messageId, emoji, pubkey, op) => {
          const all = get().reactions
          const forMsg = all[messageId] ?? {}
          const reactors = forMsg[emoji] ?? []
          let nextReactors: string[]
          if (op === 'add') {
            if (reactors.includes(pubkey)) return // idempotent — echo of own/duplicate event
            nextReactors = [...reactors, pubkey]
          } else {
            if (!reactors.includes(pubkey)) return
            nextReactors = reactors.filter(p => p !== pubkey)
          }
          const nextForMsg = { ...forMsg }
          if (nextReactors.length > 0) nextForMsg[emoji] = nextReactors
          else delete nextForMsg[emoji]
          set({ reactions: { ...all, [messageId]: nextForMsg } })
        },

        applyDelete: (messageId, by) => {
          if (get().deletedMessages[messageId]) return
          set({ deletedMessages: { ...get().deletedMessages, [messageId]: { by } } })
        },

        removeDelete: (messageId) => {
          const { [messageId]: _removed, ...rest } = get().deletedMessages
          set({ deletedMessages: rest })
        },

        applyEdit: (messageId, by, content, at) => {
          const existing = get().editedMessages[messageId]
          // Keep the newest edit — events can arrive out of order.
          if (existing && existing.at >= at) return
          set({ editedMessages: { ...get().editedMessages, [messageId]: { by, content, at } } })
        },

        removeEdit: (messageId) => {
          const { [messageId]: _removed, ...rest } = get().editedMessages
          set({ editedMessages: rest })
        },

        prependMessages: (chatId, msgs) => {
          if (msgs.length === 0) return
          const existing = get().messages[chatId] || []
          const existingIds = new Set(existing.map(m => m.id))
          const fresh = msgs.filter(m => !existingIds.has(m.id))
          if (fresh.length === 0) return
          const merged = [...fresh, ...existing].sort((a, b) => a.createdAt - b.createdAt)
          set({ messages: { ...get().messages, [chatId]: merged } })
        },

        updateMessageStatus: (chatId, msgId, status) => {
          const msgs = get().messages[chatId]
          if (!msgs) return
          set({
            messages: {
              ...get().messages,
              [chatId]: msgs.map(m => m.id === msgId ? { ...m, status } : m),
            }
          })
          const db = getUserDb()
          if (db) void db.messages.update(msgId, { status })
        },

        markRead: (chatId) => {
          const contacts = get().contacts.map(c =>
            c.pubkey === chatId ? { ...c, unread: 0 } : c
          )
          const channels = get().channels.map(ch =>
            ch.id === chatId ? { ...ch, unread: 0, mentions: 0 } : ch
          )
          const groups = get().groups.map(g =>
            g.id === chatId ? { ...g, unread: 0, mentions: 0 } : g
          )
          set({ contacts, channels, groups })
        },

        updateContactLastMessage: (pubkey, content, at, opts = {}) => {
          const isActive = get().activeChatId === pubkey
          const count = opts.incrementUnread !== false
          const contacts = get().contacts.map(c =>
            c.pubkey === pubkey
              ? {
                  ...c,
                  // Keep the newest preview: relay backfill can arrive out of order
                  ...(at >= (c.lastMessageAt ?? 0) ? { lastMessage: content, lastMessageAt: at } : {}),
                  unread: isActive ? 0 : (c.unread || 0) + (count ? 1 : 0),
                }
              : c
          )
          if (!contacts.find(c => c.pubkey === pubkey)) {
            contacts.unshift({
              pubkey,
              lastMessage: content,
              lastMessageAt: at,
              unread: isActive ? 0 : count ? 1 : 0,
            })
          }
          set({ contacts })
        },

        updateChannelLastMessage: (channelId, content, at, isMention = false, opts = {}) => {
          const isActive = get().activeChatId === channelId
          const count = opts.incrementUnread !== false
          const channels = get().channels.map(ch =>
            ch.id === channelId
              ? {
                  ...ch,
                  // Keep the newest preview: relay backfill can arrive out of order
                  ...(at >= (ch.lastMessageAt ?? 0) ? { lastMessage: content, lastMessageAt: at } : {}),
                  unread: isActive ? 0 : (ch.unread || 0) + (count ? 1 : 0),
                  mentions: isActive ? 0 : count && isMention ? (ch.mentions || 0) + 1 : (ch.mentions || 0),
                }
              : ch
          )
          set({ channels })
        },

        setProfile: (pubkey, profile) => {
          set({ profiles: { ...get().profiles, [pubkey]: profile } })
          if (pubkey === get().publicKey) {
            set({ profile })
          }
          const contacts = get().contacts.map(c =>
            c.pubkey === pubkey ? { ...c, profile } : c
          )
          set({ contacts })
        },

        setSidebarTab: (tab) => set({ sidebarTab: tab }),
        setShowSettings: (show) => set({ showSettings: show }),
        setActiveSettingsTab: (tab) => set({ activeSettingsTab: tab }),
        setShowAddChannel: (show) => set({ showAddChannel: show }),
        setShowAddContact: (show) => set({ showAddContact: show }),
        setShowAddGroup: (show) => set({ showAddGroup: show }),
        setViewingProfilePubkey: (pubkey) => set({ viewingProfilePubkey: pubkey }),

        updateNotificationSettings: (s) => {
          set({ notificationSettings: { ...get().notificationSettings, ...s } })
          scheduleSettingsSync()
        },

        muteChatUntil: (chatId, until) => {
          set({ mutedChats: { ...get().mutedChats, [chatId]: until } })
          scheduleSettingsSync()
        },

        unmuteChat: (chatId) => {
          const { [chatId]: _, ...rest } = get().mutedChats
          set({ mutedChats: rest })
          scheduleSettingsSync()
        },

        triggerSettingsSync: () => scheduleSettingsSync(),

        setDraft: (chatId, text) =>
          set({ drafts: { ...get().drafts, [chatId]: text } }),

        clearDraft: (chatId) => {
          const { [chatId]: _, ...rest } = get().drafts
          set({ drafts: rest })
        },

        updateSeenAt: (chatId, at) =>
          set({ seenAt: { ...get().seenAt, [chatId]: at } }),
      }
    },
    {
      name: 'nostr-chat-storage',
      storage: createJSONStorage(() => dexieStorage),
      onRehydrateStorage: () => (state) => {
        if (state?.notificationSettings) {
          const ns = state.notificationSettings
          if (ns.callEnabled === undefined) ns.callEnabled = true
          if (ns.callSound   === undefined) ns.callSound   = true
        }
      },
      partialize: (state) => ({
        publicKey: state.publicKey,
        npub: state.npub,
        profile: state.profile,
        relays: state.relays,
        relayModes: state.relayModes,
        channels: state.channels,
        joinedChannelIds: state.joinedChannelIds,
        contacts: state.contacts,
        groups: state.groups,
        groupKeys: state.groupKeys,
        groupKeyHistory: state.groupKeyHistory,
        groupKeyRotatedAt: state.groupKeyRotatedAt,
        groupMembersUpdatedAt: state.groupMembersUpdatedAt,
        profiles: state.profiles,
        notificationSettings: state.notificationSettings,
        mutedChats: state.mutedChats,
        seenAt: state.seenAt,
        syncedSettingsAt: state.syncedSettingsAt,
        blockedPubkeys: state.blockedPubkeys,
        dismissedRequests: state.dismissedRequests,
        readReceiptsEnabled: state.readReceiptsEnabled,
        readUntilByPeer: state.readUntilByPeer,
        deletedMessages: state.deletedMessages,
        editedMessages: state.editedMessages,
      }),
    }
  )
)
