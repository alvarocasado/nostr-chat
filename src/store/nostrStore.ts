import { create } from 'zustand'
import { persist, createJSONStorage, type StorageValue } from 'zustand/middleware'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { encodeNsec, encodePubkey, type NostrProfile, DEFAULT_RELAYS } from '../lib/nostr'
import { LocalSigner, setSigner, clearSigner, getSigner } from '../lib/signer'
import {
  openUserDb,
  closeUserDb,
  getUserDb,
  getSetting,
  setSetting,
  setActivePubkey,
  clearActivePubkey,
  setAuthMethod,
} from '../lib/userDb'
import { saveLocalKey } from '../lib/keyStore'
import { messageToRecord, recordToMessage } from '../lib/db'
import {
  syncFromRelays,
  publishContactList,
  publishChannelBookmarks,
  publishAppSettings,
  debounce,
  type CallsSyncedSettings,
} from '../lib/nostrSync'

export type ChatType = 'channel' | 'dm' | 'group'
export type SettingsTab = 'profile' | 'relays' | 'keys' | 'calls' | 'notifications' | 'privacy'

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

  // Channels
  channels: Channel[]
  joinedChannelIds: string[]

  // Contacts / DMs
  contacts: Contact[]

  // Groups
  groups: Group[]
  groupKeys: Record<string, string>

  // Active chat
  activeChatId: string | null
  activeChatType: ChatType | null

  // Messages keyed by channelId or pubkey
  messages: Record<string, Message[]>

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

  // Drafts (session-only, not persisted)
  drafts: Record<string, string>

  // Seen-at timestamps for unread divider (persisted)
  seenAt: Record<string, number>

  // Relay sync: created_at of the last kind-30078 settings event we received or published
  syncedSettingsAt: number | null

  // Actions
  generateAndLogin: () => Promise<{ nsec: string; npub: string }>
  loginFromNsec: (nsec: string) => Promise<boolean>
  loginFromHex: (hex: string) => Promise<boolean>
  logout: () => void
  updateProfile: (profile: Partial<NostrProfile>) => void

  addRelay: (url: string) => void
  removeRelay: (url: string) => void

  addChannel: (channel: Channel) => void
  joinChannel: (id: string) => void
  leaveChannel: (id: string) => void

  addContact: (pubkey: string) => void
  removeContact: (pubkey: string) => void

  acceptMessageRequest: (pubkey: string) => void
  dismissMessageRequest: (pubkey: string) => void
  blockPubkey: (pubkey: string) => void
  unblockPubkey: (pubkey: string) => void

  setActiveChat: (id: string, type: ChatType) => void
  clearActiveChat: () => void

  targetMessageId: string | null

  jumpToMessage: (chatId: string, type: ChatType, messageId: string) => void
  clearTargetMessage: () => void

  addMessage: (chatId: string, message: Message) => void
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

async function completeLogin(
  sk: Uint8Array,
  pk: string,
  nsecStr: string,
  set: (s: Partial<NostrState>) => void,
  get: () => NostrState,
): Promise<void> {
  setSigner(new LocalSigner(sk))
  openUserDb(pk)
  await saveLocalKey(sk)
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
  syncFromRelays(relays).then(result => {
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

    // Group keys: relay backup takes priority for keys we don't have locally
    if (result.groupKeys && Object.keys(result.groupKeys).length > 0) {
      const current = get().groupKeys
      const merged = { ...result.groupKeys, ...current } // local keys take precedence
      set({ groupKeys: merged })
    }

    // Settings: apply only when the relay event is newer than the last one we synced
    if (result.settings) {
      const lastSynced = get().syncedSettingsAt
      if (!lastSynced || result.settings.createdAt > lastSynced) {
        const s = result.settings.settings
        set({
          ...(s.notificationSettings !== undefined ? { notificationSettings: s.notificationSettings } : {}),
          ...(s.mutedChats !== undefined ? { mutedChats: s.mutedChats } : {}),
          ...(s.relays !== undefined ? { relays: s.relays } : {}),
          ...(s.blockedPubkeys !== undefined ? { blockedPubkeys: s.blockedPubkeys } : {}),
          ...(s.dismissedRequests !== undefined ? { dismissedRequests: s.dismissedRequests } : {}),
          syncedSettingsAt: result.settings.createdAt,
        })
        if (s.callsSettings) {
          void setSetting('turn_mode', s.callsSettings.turnMode)
          if (s.callsSettings.turnMetered) void setSetting('turn_metered_config', s.callsSettings.turnMetered)
          if (s.callsSettings.turnCustom) void setSetting('turn_custom_config', s.callsSettings.turnCustom)
        }
      }
    }
  }).catch(() => {}) // non-fatal
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
            const { notificationSettings, mutedChats, relays, blockedPubkeys, dismissedRequests } = get()
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
            void publishAppSettings({ notificationSettings, mutedChats, relays, callsSettings, blockedPubkeys, dismissedRequests }, relays)
              .then(() => set({ syncedSettingsAt: now }))
              .catch(() => {})
          })()
        })
      }

      return {
        publicKey: null,
        nsec: null,
        npub: null,
        profile: null,
        relays: DEFAULT_RELAYS,
        channels: [],
        joinedChannelIds: [],
        contacts: [],
        groups: [],
        groupKeys: {},
        activeChatId: null,
        activeChatType: null,
        targetMessageId: null,
        messages: {},
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
        drafts: {},
        seenAt: {},
        syncedSettingsAt: null,

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

        logout: () => {
          set({
            publicKey: null,
            nsec: null,
            npub: null,
            profile: null,
            activeChatId: null,
            activeChatType: null,
            messages: {},
            groups: [],
            groupKeys: {},
          })
          clearSigner()
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
            set({ relays: [...relays, url] })
            scheduleSettingsSync()
          }
        },

        removeRelay: (url) => {
          set({ relays: get().relays.filter(r => r !== url) })
          scheduleSettingsSync()
        },

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

        setActiveChat: (id, type) => {
          set({ activeChatId: id, activeChatType: type })
          get().markRead(id)
          const db = getUserDb()
          if (db) {
            void db.messages
              .where('[chatId+createdAt]')
              .between([id, -Infinity], [id, Infinity])
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

        updateMessageStatus: (chatId, msgId, status) => {
          const msgs = get().messages[chatId]
          if (!msgs) return
          set({
            messages: {
              ...get().messages,
              [chatId]: msgs.map(m => m.id === msgId ? { ...m, status } : m),
            }
          })
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
        channels: state.channels,
        joinedChannelIds: state.joinedChannelIds,
        contacts: state.contacts,
        groups: state.groups,
        groupKeys: state.groupKeys,
        profiles: state.profiles,
        notificationSettings: state.notificationSettings,
        mutedChats: state.mutedChats,
        seenAt: state.seenAt,
        syncedSettingsAt: state.syncedSettingsAt,
        blockedPubkeys: state.blockedPubkeys,
        dismissedRequests: state.dismissedRequests,
      }),
    }
  )
)
