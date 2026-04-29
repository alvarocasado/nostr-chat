import { useState, useMemo, useRef, useEffect } from 'react'
import { Hash, MessageCircle, Users, Settings, Plus, LogOut, Zap, X, Search, BellOff, Bell, User, Wifi, Key, Phone } from 'lucide-react'
import { useNostrStore, type Channel, type Contact, type Message, type ChatType } from '../../store/nostrStore'
import { Avatar } from './Avatar'
import { getDisplayName, getPreviewText } from '../../lib/fileUtils'
import { formatDistanceToNowStrict } from 'date-fns'

function formatTime(ts?: number) {
  if (!ts) return ''
  try {
    return formatDistanceToNowStrict(new Date(ts * 1000), { addSuffix: false })
  } catch {
    return ''
  }
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className="bg-purple-500/40 text-white not-italic rounded px-0.5">{part}</mark>
          : part
      )}
    </>
  )
}

interface SearchResult {
  chatId: string
  chatType: ChatType
  chatName: string
  message: Message
  senderName: string
}

function SearchResultItem({ result, query, onSelect }: { result: SearchResult; query: string; onSelect: () => void }) {
  const { setActiveChat } = useNostrStore()

  const handleClick = () => {
    setActiveChat(result.chatId, result.chatType)
    onSelect()
  }

  const preview = getPreviewText(result.message.content)

  return (
    <button
      onClick={handleClick}
      className="w-full flex items-start gap-3 px-3 py-3 rounded-xl hover:bg-white/5 text-left transition-colors"
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
        result.chatType === 'channel' ? 'bg-gray-800' : 'bg-purple-600/20'
      }`}>
        {result.chatType === 'channel'
          ? <Hash size={14} className="text-gray-400" />
          : <MessageCircle size={14} className="text-purple-400" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <span className="text-xs font-semibold text-gray-300 truncate">{result.chatName}</span>
          <span className="text-gray-600 text-xs flex-shrink-0">{formatTime(result.message.createdAt)}</span>
        </div>
        <p className="text-xs text-gray-500 truncate">{result.senderName}</p>
        <p className="text-xs text-gray-400 mt-0.5 line-clamp-2 leading-relaxed">
          <Highlight text={preview} query={query} />
        </p>
      </div>
    </button>
  )
}

const MUTE_OPTIONS: { label: string; ms: number | null }[] = [
  { label: '8 hours',  ms: 8 * 60 * 60 * 1000 },
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: '1 week',   ms: 7 * 24 * 60 * 60 * 1000 },
  { label: 'Always',   ms: null },
]

function MuteButton({ chatId }: { chatId: string }) {
  const { mutedChats, muteChatUntil, unmuteChat } = useNostrStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const muteUntil = mutedChats[chatId]
  const isMuted = muteUntil !== undefined && (muteUntil === null || Date.now() < muteUntil)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(v => !v)}
        title={isMuted ? 'Muted — click to change' : 'Mute notifications'}
        className={`p-1.5 rounded-lg transition-colors ${
          isMuted
            ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10'
            : 'text-gray-600 hover:text-gray-400 hover:bg-white/5 opacity-0 group-hover:opacity-100'
        }`}
      >
        {isMuted ? <BellOff size={13} /> : <Bell size={13} />}
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-50 bg-gray-800 border border-gray-700 rounded-xl shadow-xl py-1 w-36">
          {isMuted ? (
            <button
              onClick={() => { unmuteChat(chatId); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm text-green-400 hover:bg-white/5 transition-colors"
            >
              Unmute
            </button>
          ) : null}
          {MUTE_OPTIONS.map(opt => (
            <button
              key={opt.label}
              onClick={() => {
                muteChatUntil(chatId, opt.ms === null ? null : Date.now() + opt.ms)
                setOpen(false)
              }}
              className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/5 transition-colors"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ChannelItem({ channel, isActive, onSelect }: { channel: Channel; isActive: boolean; onSelect: () => void }) {
  const { setActiveChat, joinChannel } = useNostrStore()

  const handleClick = () => {
    joinChannel(channel.id)
    setActiveChat(channel.id, 'channel')
    onSelect()
  }

  const hasMention = (channel.mentions || 0) > 0
  const hasUnread = (channel.unread || 0) > 0

  return (
    <div className="group relative">
      <button
        onClick={handleClick}
        className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-left ${
          isActive
            ? 'bg-purple-600/20 border border-purple-500/30 text-white'
            : 'hover:bg-white/5 text-gray-300 hover:text-white'
        }`}
      >
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
          isActive ? 'bg-purple-600' : 'bg-gray-800'
        }`}>
          <Hash size={16} className={isActive ? 'text-white' : 'text-gray-400'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className={`font-medium truncate text-sm ${hasMention ? 'text-white' : ''}`}>{channel.name}</span>
            <span className="text-gray-500 text-xs flex-shrink-0">{formatTime(channel.lastMessageAt)}</span>
          </div>
          {channel.lastMessage && (
            <p className="text-xs text-gray-500 truncate mt-0.5">{channel.lastMessage}</p>
          )}
        </div>
        {hasUnread && (
          <span className={`flex-shrink-0 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center ${
            hasMention ? 'bg-amber-500' : 'bg-gray-600'
          }`}>
            {hasMention
              ? (channel.mentions! > 9 ? '9+' : channel.mentions)
              : (channel.unread! > 9 ? '9+' : channel.unread)}
          </span>
        )}
      </button>
      <div className="absolute right-2 top-1/2 -translate-y-1/2">
        <MuteButton chatId={channel.id} />
      </div>
    </div>
  )
}

function ContactItem({ contact, isActive, onSelect }: { contact: Contact; isActive: boolean; onSelect: () => void }) {
  const { setActiveChat, profiles, setViewingProfilePubkey } = useNostrStore()
  const profile = contact.profile || profiles[contact.pubkey]
  const name = getDisplayName(profile, contact.pubkey, 10)

  return (
    <div className="group relative">
      <div
        role="button"
        tabIndex={0}
        onClick={() => { setActiveChat(contact.pubkey, 'dm'); onSelect() }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { setActiveChat(contact.pubkey, 'dm'); onSelect() } }}
        className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-left cursor-pointer ${
          isActive
            ? 'bg-purple-600/20 border border-purple-500/30 text-white'
            : 'hover:bg-white/5 text-gray-300 hover:text-white'
        }`}
      >
        <div
          className="relative flex-shrink-0"
          onClick={e => { e.stopPropagation(); setViewingProfilePubkey(contact.pubkey) }}
        >
          <Avatar picture={profile?.picture} name={name} pubkey={contact.pubkey} size="sm" onClick={() => setViewingProfilePubkey(contact.pubkey)} />
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-gray-900 pointer-events-none" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className={`font-medium truncate text-sm ${(contact.unread || 0) > 0 ? 'text-white' : ''}`}>{name}</span>
            <span className="text-gray-500 text-xs flex-shrink-0">{formatTime(contact.lastMessageAt)}</span>
          </div>
          {contact.lastMessage && (
            <p className="text-xs text-gray-500 truncate mt-0.5">{contact.lastMessage}</p>
          )}
        </div>
        {(contact.unread || 0) > 0 && (
          <span className="flex-shrink-0 bg-amber-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {contact.unread! > 9 ? '9+' : contact.unread}
          </span>
        )}
      </div>
      <div className="absolute right-2 top-1/2 -translate-y-1/2">
        <MuteButton chatId={contact.pubkey} />
      </div>
    </div>
  )
}

const MAX_SEARCH_RESULTS = 50

type SidebarSection = 'search' | 'messages' | 'channels' | 'contacts' | 'settings'

const SECTION_LABELS: Record<SidebarSection, string> = {
  search: 'Search',
  messages: 'Messages',
  channels: 'Channels',
  contacts: 'Contacts',
  settings: 'Settings',
}

function NavRailButton({
  icon, label, active, danger, onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
        active
          ? 'bg-purple-600 text-white'
          : danger
          ? 'text-gray-500 hover:text-red-400 hover:bg-red-500/10'
          : 'text-gray-500 hover:text-white hover:bg-white/10'
      }`}
    >
      {icon}
    </button>
  )
}

function BottomNavButton({
  icon, label, active, onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 transition-colors ${
        active ? 'text-purple-400' : 'text-gray-500 active:text-gray-300'
      }`}
    >
      {icon}
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  )
}

export function Sidebar() {
  const [activeSection, setActiveSection] = useState<SidebarSection | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const {
    publicKey, profile, channels, joinedChannelIds, contacts,
    activeChatId, activeChatType, messages, profiles,
    activeSettingsTab, setActiveSettingsTab,
    setShowAddChannel, setShowAddContact,
    logout,
  } = useNostrStore()

  const myProfile = profile || profiles[publicKey || '']
  const myName = publicKey ? getDisplayName(myProfile, publicKey) : 'You'
  const joinedChannels = channels.filter(c => joinedChannelIds.includes(c.id))

  const toggleSection = (section: SidebarSection) => {
    setActiveSection(prev => {
      if (prev !== 'search' && section !== 'search') setSearchQuery('')
      if (prev === section && section === 'settings') setActiveSettingsTab(null)
      if (prev !== section && prev === 'settings') setActiveSettingsTab(null)
      return prev === section ? null : section
    })
  }

  const closePanelOnly = () => {
    setActiveSection(null)
    setSearchQuery('')
  }

  const closePanel = () => {
    if (activeSection === 'settings') setActiveSettingsTab(null)
    closePanelOnly()
  }

  const searchResults = useMemo<SearchResult[]>(() => {
    const q = searchQuery.trim().toLowerCase()
    if (q.length < 2) return []

    const results: SearchResult[] = []

    for (const [chatId, msgs] of Object.entries(messages)) {
      const channel = channels.find(c => c.id === chatId)
      const contact = contacts.find(c => c.pubkey === chatId)
      if (!channel && !contact) continue

      const chatType: ChatType = channel ? 'channel' : 'dm'
      const chatName = channel
        ? channel.name
        : getDisplayName(contact?.profile || profiles[chatId], chatId, 10)

      for (const msg of msgs) {
        if (!msg.content.toLowerCase().includes(q)) continue
        const sp = msg.pubkey === publicKey
          ? (profile || profiles[publicKey || ''])
          : (profiles[msg.pubkey] || contact?.profile)
        const senderName = getDisplayName(sp, msg.pubkey)
        results.push({ chatId, chatType, chatName, message: msg, senderName })
      }
    }

    return results
      .sort((a, b) => b.message.createdAt - a.message.createdAt)
      .slice(0, MAX_SEARCH_RESULTS)
  }, [searchQuery, messages, channels, contacts, profiles, publicKey, profile])

  const isSearching = searchQuery.trim().length >= 2

  // ── Section panel bodies ─────────────────────────────────────
  const searchSection = (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 flex-shrink-0">
        <div className="flex items-center gap-2 bg-gray-800 rounded-xl px-3 py-2 border border-gray-700 focus-within:border-purple-500/50 transition-colors">
          <Search size={14} className="text-gray-500 flex-shrink-0" />
          <input
            autoFocus
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search messages…"
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none min-w-0"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-gray-500 hover:text-gray-300 flex-shrink-0">
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin py-1 px-2 space-y-0.5">
        {!isSearching ? (
          <p className="text-gray-600 text-xs text-center py-8">Type at least 2 characters to search</p>
        ) : searchResults.length === 0 ? (
          <p className="text-gray-500 text-xs text-center px-4 py-8">No messages found for "{searchQuery.trim()}"</p>
        ) : (
          <>
            <p className="text-gray-600 text-xs px-3 py-1">
              {searchResults.length}{searchResults.length === MAX_SEARCH_RESULTS ? '+' : ''} result{searchResults.length !== 1 ? 's' : ''}
            </p>
            {searchResults.map(result => (
              <SearchResultItem
                key={`${result.chatId}-${result.message.id}`}
                result={result}
                query={searchQuery.trim()}
                onSelect={closePanel}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )

  const actionButton = (label: string, onClick: () => void) => (
    <div className="px-3 pt-3 pb-2 flex-shrink-0">
      <button
        onClick={onClick}
        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold transition-colors"
      >
        <Plus size={16} />
        {label}
      </button>
    </div>
  )

  const messagesSection = (
    <div className="flex flex-col h-full">
      {actionButton('New Message', () => { setShowAddContact(true); closePanel() })}
      <div className="flex-1 overflow-y-auto scrollbar-thin py-1 px-2 space-y-0.5">
        {contacts.length === 0 && (
          <p className="text-gray-500 text-xs text-center px-4 py-6">No conversations yet.</p>
        )}
        {contacts.map(c => (
          <ContactItem
            key={c.pubkey}
            contact={c}
            isActive={activeChatId === c.pubkey && activeChatType === 'dm'}
            onSelect={closePanel}
          />
        ))}
      </div>
    </div>
  )

  const channelsSection = (
    <div className="flex flex-col h-full">
      {actionButton('Add / Discover Channels', () => { setShowAddChannel(true); closePanel() })}
      <div className="flex-1 overflow-y-auto scrollbar-thin py-1 px-2 space-y-0.5">
        {joinedChannels.length === 0 && (
          <p className="text-gray-500 text-xs text-center px-4 py-6">No channels yet. Discover or create one above.</p>
        )}
        {joinedChannels.map(ch => (
          <ChannelItem
            key={ch.id}
            channel={ch}
            isActive={activeChatId === ch.id && activeChatType === 'channel'}
            onSelect={closePanel}
          />
        ))}
      </div>
    </div>
  )

  const contactsSection = (
    <div className="flex flex-col h-full">
      {actionButton('Add Contact', () => { setShowAddContact(true); closePanel() })}
      <div className="flex-1 flex items-start justify-center px-6 pt-6">
        <p className="text-gray-600 text-xs text-center leading-relaxed">
          Search by public key or Nostr address to start a private conversation.
        </p>
      </div>
    </div>
  )

  const sectionBody: Record<SidebarSection, React.ReactNode> = {
    search: searchSection,
    messages: messagesSection,
    channels: channelsSection,
    contacts: contactsSection,
    settings: (
      <div className="flex flex-col h-full py-2 px-2">
        {(
          [
            { tab: 'profile',       label: 'Profile',       icon: <User    size={16} /> },
            { tab: 'relays',        label: 'Relays',        icon: <Wifi    size={16} /> },
            { tab: 'keys',          label: 'Keys',          icon: <Key     size={16} /> },
            { tab: 'calls',         label: 'Calls',         icon: <Phone   size={16} /> },
            { tab: 'notifications', label: 'Notifications', icon: <Bell    size={16} /> },
          ] as const
        ).map(({ tab, label, icon }) => (
          <button
            key={tab}
            onClick={() => { setActiveSettingsTab(tab); closePanelOnly() }}
            className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-sm transition-colors ${
              activeSettingsTab === tab
                ? 'bg-purple-600/20 border border-purple-500/30 text-white'
                : 'text-gray-300 hover:bg-white/5 hover:text-white'
            }`}
          >
            <span className={activeSettingsTab === tab ? 'text-purple-400' : 'text-gray-500'}>
              {icon}
            </span>
            {label}
          </button>
        ))}
      </div>
    ),
  }

  // ── Profile footer (shared between desktop panel and mobile sheet) ──
  const profileFooter = (
    <div
      className="px-3 py-3 border-t border-gray-800 flex-shrink-0"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors">
        <Avatar picture={myProfile?.picture} name={myName} pubkey={publicKey || ''} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{myName}</p>
          <p className="text-xs text-gray-500 truncate">{publicKey?.slice(0, 16)}...</p>
        </div>
        <button
          onClick={logout}
          title="Logout"
          className="p-2 text-gray-500 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10"
        >
          <LogOut size={16} />
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* ── Desktop ──────────────────────────────────────────────── */}
      <div className="hidden md:flex h-full flex-shrink-0">

        {/* Icon rail */}
        <div className="w-14 flex flex-col items-center py-3 gap-1 bg-gray-900 border-r border-gray-800 flex-shrink-0">
          {/* Logo */}
          <div className="w-9 h-9 bg-purple-600 rounded-xl flex items-center justify-center mb-3 flex-shrink-0">
            <Zap size={18} className="text-white" />
          </div>

          <NavRailButton icon={<Search size={18} />}        label="Search"   active={activeSection === 'search'}   onClick={() => toggleSection('search')} />
          <NavRailButton icon={<MessageCircle size={18} />} label="Messages" active={activeSection === 'messages'} onClick={() => toggleSection('messages')} />
          <NavRailButton icon={<Hash size={18} />}          label="Channels" active={activeSection === 'channels'} onClick={() => toggleSection('channels')} />
          <NavRailButton icon={<Users size={18} />}         label="Contacts" active={activeSection === 'contacts'} onClick={() => toggleSection('contacts')} />

          <div className="flex-1" />

          <NavRailButton icon={<Settings size={18} />} label="Settings" active={activeSection === 'settings'} onClick={() => toggleSection('settings')} />

          {/* User avatar */}
          <div className="my-1">
            <Avatar picture={myProfile?.picture} name={myName} pubkey={publicKey || ''} size="sm" />
          </div>

          <NavRailButton icon={<LogOut size={18} />} label="Logout" danger onClick={logout} />
        </div>

        {/* Section panel — slides in by revealing fixed-width inner content */}
        <div className={`flex flex-col bg-gray-900 border-r border-gray-800 overflow-hidden transition-all duration-300 ease-in-out ${activeSection ? 'w-72' : 'w-0'}`}>
          <div className="w-72 flex flex-col h-full">
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800 flex-shrink-0">
              <h2 className="font-bold text-white text-base">
                {activeSection ? SECTION_LABELS[activeSection] : ''}
              </h2>
              <button
                onClick={closePanel}
                className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            {/* Panel body */}
            <div className="flex-1 overflow-hidden">
              {activeSection && sectionBody[activeSection]}
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile ───────────────────────────────────────────────── */}

      {/* Sheet backdrop */}
      <div
        className={`md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          activeSection ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={closePanel}
      />

      {/* Sheet — anchored at top:0 so translateY(100vh) guarantees full off-screen hide */}
      <div
        className="md:hidden fixed inset-x-0 top-0 z-50 bg-gray-900 rounded-t-2xl shadow-2xl flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          height: `calc(100vh - 4rem - env(safe-area-inset-bottom, 0px))`,
          transform: activeSection ? 'translateY(4rem)' : 'translateY(100vh)',
        }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-700" />
        </div>

        {/* Sheet header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
          <h2 className="font-bold text-white text-base">
            {activeSection ? SECTION_LABELS[activeSection] : ''}
          </h2>
          <button
            onClick={closePanel}
            className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Sheet body */}
        <div className="flex-1 overflow-hidden">
          {activeSection && sectionBody[activeSection]}
        </div>

        {/* Profile footer inside sheet */}
        {profileFooter}
      </div>

      {/* Bottom nav */}
      <div
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-gray-900 border-t border-gray-800 flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <BottomNavButton icon={<Search size={20} />}        label="Search"   active={activeSection === 'search'}   onClick={() => toggleSection('search')} />
        <BottomNavButton icon={<MessageCircle size={20} />} label="Messages" active={activeSection === 'messages'} onClick={() => toggleSection('messages')} />
        <BottomNavButton icon={<Hash size={20} />}          label="Channels" active={activeSection === 'channels'} onClick={() => toggleSection('channels')} />
        <BottomNavButton icon={<Users size={20} />}         label="Contacts" active={activeSection === 'contacts'} onClick={() => toggleSection('contacts')} />
        <BottomNavButton icon={<Settings size={20} />}      label="Settings" active={activeSection === 'settings'} onClick={() => toggleSection('settings')} />
      </div>
    </>
  )
}
