import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { encodeNsec, encodePubkey, type NostrProfile, DEFAULT_RELAYS } from '../lib/nostr'

export type ChatType = 'channel' | 'dm'
export type SettingsTab = 'profile' | 'relays' | 'keys' | 'calls' | 'notifications'

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
  mentions?: number  // @mention count for badge color differentiation
}

export interface Contact {
  pubkey: string
  profile?: NostrProfile
  lastMessage?: string
  lastMessageAt?: number
  unread?: number
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
  // Auth - store private key as hex string for JSON persistence
  privateKeyHex: string | null
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
  showAddChannel: boolean
  showAddContact: boolean

  // Notifications
  notificationSettings: NotificationSettings
  mutedChats: Record<string, number | null>  // chatId -> expiry ms (null = forever)

  // Drafts (session-only, not persisted)
  drafts: Record<string, string>

  // Seen-at timestamps for unread divider (persisted)
  seenAt: Record<string, number>

  // Derived helper
  getPrivateKey: () => Uint8Array | null

  // Actions
  generateAndLogin: () => { nsec: string; npub: string }
  loginFromNsec: (nsec: string) => boolean
  loginFromHex: (hex: string) => boolean
  logout: () => void
  updateProfile: (profile: Partial<NostrProfile>) => void

  addRelay: (url: string) => void
  removeRelay: (url: string) => void

  addChannel: (channel: Channel) => void
  joinChannel: (id: string) => void
  leaveChannel: (id: string) => void

  addContact: (pubkey: string) => void
  removeContact: (pubkey: string) => void

  setActiveChat: (id: string, type: ChatType) => void
  clearActiveChat: () => void

  addMessage: (chatId: string, message: Message) => void
  updateMessageStatus: (chatId: string, msgId: string, status: 'sending' | 'sent' | 'failed') => void
  markRead: (chatId: string) => void
  updateContactLastMessage: (pubkey: string, content: string, at: number) => void
  updateChannelLastMessage: (channelId: string, content: string, at: number, isMention?: boolean) => void

  setProfile: (pubkey: string, profile: NostrProfile) => void

  setSidebarTab: (tab: 'channels' | 'dms' | 'contacts') => void
  setShowSettings: (show: boolean) => void
  setActiveSettingsTab: (tab: SettingsTab | null) => void
  setShowAddChannel: (show: boolean) => void
  setShowAddContact: (show: boolean) => void

  updateNotificationSettings: (s: Partial<NotificationSettings>) => void
  muteChatUntil: (chatId: string, until: number | null) => void
  unmuteChat: (chatId: string) => void

  setDraft: (chatId: string, text: string) => void
  clearDraft: (chatId: string) => void

  updateSeenAt: (chatId: string, at: number) => void
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export const useNostrStore = create<NostrState>()(
  persist(
    (set, get) => ({
      privateKeyHex: null,
      publicKey: null,
      nsec: null,
      npub: null,
      profile: null,
      relays: DEFAULT_RELAYS,
      channels: [],
      joinedChannelIds: [],
      contacts: [],
      activeChatId: null,
      activeChatType: null,
      messages: {},
      profiles: {},
      sidebarTab: 'channels',
      showSettings: false,
      activeSettingsTab: null,
      showAddChannel: false,
      showAddContact: false,
      notificationSettings: DEFAULT_NOTIFICATION_SETTINGS,
      mutedChats: {},
      drafts: {},
      seenAt: {},

      getPrivateKey: () => {
        const hex = get().privateKeyHex
        return hex ? hexToBytes(hex) : null
      },

      generateAndLogin: () => {
        const sk = generateSecretKey()
        const pk = getPublicKey(sk)
        const nsec = encodeNsec(sk)
        const npub = encodePubkey(pk)
        set({
          privateKeyHex: bytesToHex(sk),
          publicKey: pk,
          nsec,
          npub,
          profile: { pubkey: pk },
        })
        return { nsec, npub }
      },

      loginFromNsec: (nsecStr: string) => {
        try {
          const decoded = nip19.decode(nsecStr)
          if (decoded.type !== 'nsec') return false
          const sk = decoded.data as Uint8Array
          const pk = getPublicKey(sk)
          const npub = encodePubkey(pk)
          set({
            privateKeyHex: bytesToHex(sk),
            publicKey: pk,
            nsec: nsecStr,
            npub,
            profile: get().profile?.pubkey === pk ? get().profile : { pubkey: pk },
          })
          return true
        } catch {
          return false
        }
      },

      loginFromHex: (hex: string) => {
        try {
          const sk = hexToBytes(hex.trim())
          const pk = getPublicKey(sk)
          const nsec = encodeNsec(sk)
          const npub = encodePubkey(pk)
          set({
            privateKeyHex: hex.trim(),
            publicKey: pk,
            nsec,
            npub,
            profile: get().profile?.pubkey === pk ? get().profile : { pubkey: pk },
          })
          return true
        } catch {
          return false
        }
      },

      logout: () => {
        set({
          privateKeyHex: null,
          publicKey: null,
          nsec: null,
          npub: null,
          profile: null,
          activeChatId: null,
          activeChatType: null,
          messages: {},
        })
      },

      updateProfile: (profileUpdate) => {
        const current = get().profile || { pubkey: get().publicKey || '' }
        set({ profile: { ...current, ...profileUpdate } })
      },

      addRelay: (url) => {
        const relays = get().relays
        if (!relays.includes(url)) {
          set({ relays: [...relays, url] })
        }
      },

      removeRelay: (url) => {
        set({ relays: get().relays.filter(r => r !== url) })
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
        }
      },

      leaveChannel: (id) => {
        set({
          joinedChannelIds: get().joinedChannelIds.filter(i => i !== id),
          activeChatId: get().activeChatId === id ? null : get().activeChatId,
        })
      },

      addContact: (pubkey) => {
        const existing = get().contacts.find(c => c.pubkey === pubkey)
        if (!existing) {
          set({ contacts: [{ pubkey }, ...get().contacts] })
        }
      },

      removeContact: (pubkey) => {
        set({ contacts: get().contacts.filter(c => c.pubkey !== pubkey) })
      },

      setActiveChat: (id, type) => {
        set({ activeChatId: id, activeChatType: type })
        get().markRead(id)
      },

      clearActiveChat: () => {
        set({ activeChatId: null, activeChatType: null })
      },

      addMessage: (chatId, message) => {
        const existing = get().messages[chatId] || []
        if (existing.find(m => m.id === message.id)) return
        const sorted = [...existing, message].sort((a, b) => a.createdAt - b.createdAt)
        set({ messages: { ...get().messages, [chatId]: sorted } })
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
        set({ contacts, channels })
      },

      updateContactLastMessage: (pubkey, content, at) => {
        const isActive = get().activeChatId === pubkey
        const contacts = get().contacts.map(c =>
          c.pubkey === pubkey
            ? {
                ...c,
                lastMessage: content,
                lastMessageAt: at,
                unread: isActive ? 0 : (c.unread || 0) + 1,
              }
            : c
        )
        // Add if not exists
        if (!contacts.find(c => c.pubkey === pubkey)) {
          contacts.unshift({
            pubkey,
            lastMessage: content,
            lastMessageAt: at,
            unread: isActive ? 0 : 1,
          })
        }
        set({ contacts })
      },

      updateChannelLastMessage: (channelId, content, at, isMention = false) => {
        const isActive = get().activeChatId === channelId
        const channels = get().channels.map(ch =>
          ch.id === channelId
            ? {
                ...ch,
                lastMessage: content,
                lastMessageAt: at,
                unread: isActive ? 0 : (ch.unread || 0) + 1,
                mentions: isActive ? 0 : isMention ? (ch.mentions || 0) + 1 : (ch.mentions || 0),
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

      updateNotificationSettings: (s) =>
        set({ notificationSettings: { ...get().notificationSettings, ...s } }),

      muteChatUntil: (chatId, until) =>
        set({ mutedChats: { ...get().mutedChats, [chatId]: until } }),

      unmuteChat: (chatId) => {
        const { [chatId]: _, ...rest } = get().mutedChats
        set({ mutedChats: rest })
      },

      setDraft: (chatId, text) =>
        set({ drafts: { ...get().drafts, [chatId]: text } }),

      clearDraft: (chatId) => {
        const { [chatId]: _, ...rest } = get().drafts
        set({ drafts: rest })
      },

      updateSeenAt: (chatId, at) =>
        set({ seenAt: { ...get().seenAt, [chatId]: at } }),
    }),
    {
      name: 'nostr-chat-storage',
      // nsec is intentionally excluded — it is derivable from privateKeyHex and
      // storing both doubles the private key exposure footprint in localStorage.
      onRehydrateStorage: () => (state) => {
        if (state?.privateKeyHex && !state.nsec) {
          state.nsec = encodeNsec(hexToBytes(state.privateKeyHex))
        }
        // Fields added after initial release: default to true for existing users
        // whose stored notificationSettings pre-dates these keys.
        if (state?.notificationSettings) {
          const ns = state.notificationSettings
          if (ns.callEnabled === undefined) ns.callEnabled = true
          if (ns.callSound   === undefined) ns.callSound   = true
        }
      },
      partialize: (state) => ({
        privateKeyHex: state.privateKeyHex,
        publicKey: state.publicKey,
        npub: state.npub,
        profile: state.profile,
        relays: state.relays,
        channels: state.channels,
        joinedChannelIds: state.joinedChannelIds,
        contacts: state.contacts,
        profiles: state.profiles,
        notificationSettings: state.notificationSettings,
        mutedChats: state.mutedChats,
        seenAt: state.seenAt,
      }),
    }
  )
)
