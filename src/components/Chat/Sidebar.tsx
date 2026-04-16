import { useState, useMemo } from 'react'
import { Hash, MessageCircle, Users, Settings, Plus, LogOut, Zap, X, Search } from 'lucide-react'
import { useNostrStore, type Channel, type Contact, type Message, type ChatType } from '../../store/nostrStore'
import { Avatar } from './Avatar'
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

  const preview = result.message.content.length > 120
    ? result.message.content.slice(0, 120) + '…'
    : result.message.content

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

function ChannelItem({ channel, isActive, onSelect }: { channel: Channel; isActive: boolean; onSelect: () => void }) {
  const { setActiveChat, joinChannel } = useNostrStore()

  const handleClick = () => {
    joinChannel(channel.id)
    setActiveChat(channel.id, 'channel')
    onSelect()
  }

  return (
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
          <span className="font-medium truncate text-sm">{channel.name}</span>
          <span className="text-gray-500 text-xs flex-shrink-0">{formatTime(channel.lastMessageAt)}</span>
        </div>
        {channel.lastMessage && (
          <p className="text-xs text-gray-500 truncate mt-0.5">{channel.lastMessage}</p>
        )}
      </div>
      {(channel.unread || 0) > 0 && (
        <span className="flex-shrink-0 bg-purple-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
          {channel.unread! > 9 ? '9+' : channel.unread}
        </span>
      )}
    </button>
  )
}

function ContactItem({ contact, isActive, onSelect }: { contact: Contact; isActive: boolean; onSelect: () => void }) {
  const { setActiveChat, profiles } = useNostrStore()
  const profile = contact.profile || profiles[contact.pubkey]
  const name = profile?.display_name || profile?.name || contact.pubkey.slice(0, 10) + '...'

  return (
    <button
      onClick={() => { setActiveChat(contact.pubkey, 'dm'); onSelect() }}
      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-left ${
        isActive
          ? 'bg-purple-600/20 border border-purple-500/30 text-white'
          : 'hover:bg-white/5 text-gray-300 hover:text-white'
      }`}
    >
      <div className="relative">
        <Avatar picture={profile?.picture} name={name} pubkey={contact.pubkey} size="sm" />
        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-gray-900" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="font-medium truncate text-sm">{name}</span>
          <span className="text-gray-500 text-xs flex-shrink-0">{formatTime(contact.lastMessageAt)}</span>
        </div>
        {contact.lastMessage && (
          <p className="text-xs text-gray-500 truncate mt-0.5">{contact.lastMessage}</p>
        )}
      </div>
      {(contact.unread || 0) > 0 && (
        <span className="flex-shrink-0 bg-purple-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
          {contact.unread! > 9 ? '9+' : contact.unread}
        </span>
      )}
    </button>
  )
}

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const {
    publicKey, profile, channels, joinedChannelIds, contacts,
    activeChatId, activeChatType, sidebarTab, messages, profiles,
    setSidebarTab, setShowSettings, setShowAddChannel, setShowAddContact,
    logout,
  } = useNostrStore()

  const myProfile = profile || profiles[publicKey || '']
  const myName = myProfile?.display_name || myProfile?.name || (publicKey ? publicKey.slice(0, 8) + '...' : 'You')
  const joinedChannels = channels.filter(c => joinedChannelIds.includes(c.id))

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
        : (() => {
            const p = contact?.profile || profiles[chatId]
            return p?.display_name || p?.name || chatId.slice(0, 10) + '...'
          })()

      for (const msg of msgs) {
        if (!msg.content.toLowerCase().includes(q)) continue
        const sp = msg.pubkey === publicKey
          ? (profile || profiles[publicKey || ''])
          : (profiles[msg.pubkey] || contact?.profile)
        const senderName = sp?.display_name || sp?.name || msg.pubkey.slice(0, 8) + '...'
        results.push({ chatId, chatType, chatName, message: msg, senderName })
      }
    }

    return results
      .sort((a, b) => b.message.createdAt - a.message.createdAt)
      .slice(0, 50)
  }, [searchQuery, messages, channels, contacts, profiles, publicKey, profile])

  const isSearching = searchQuery.trim().length >= 2

  const sidebarContent = (
    <div className="flex flex-col h-full w-full bg-gray-900">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-800">
        <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
          <Zap size={16} className="text-white" />
        </div>
        <span className="font-bold text-white text-lg flex-1">NostrChat</span>
        <button
          onClick={() => setShowSettings(true)}
          className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          title="Settings"
        >
          <Settings size={18} />
        </button>
        {/* Close button — mobile only */}
        <button
          onClick={onClose}
          className="md:hidden p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
      </div>

      {/* Search bar */}
      <div className="px-3 pt-3">
        <div className="flex items-center gap-2 bg-gray-800 rounded-xl px-3 py-2 border border-gray-700 focus-within:border-purple-500/50 transition-colors">
          <Search size={14} className="text-gray-500 flex-shrink-0" />
          <input
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

      {/* Tab switcher — hidden while searching */}
      {!isSearching && (
        <div className="flex px-3 pt-3 gap-1">
          <button
            onClick={() => setSidebarTab('channels')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
              sidebarTab === 'channels' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Hash size={14} />
            Channels
          </button>
          <button
            onClick={() => setSidebarTab('dms')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
              sidebarTab === 'dms' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <MessageCircle size={14} />
            Messages
          </button>
          <button
            onClick={() => setSidebarTab('contacts')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
              sidebarTab === 'contacts' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Users size={14} />
            Contacts
          </button>
        </div>
      )}

      {/* List / Search results */}
      <div className="flex-1 overflow-y-auto scrollbar-thin py-2 px-2 space-y-0.5">
        {isSearching ? (
          searchResults.length === 0 ? (
            <p className="text-gray-500 text-xs text-center px-4 py-8">
              No messages found for "{searchQuery.trim()}"
            </p>
          ) : (
            <>
              <p className="text-gray-600 text-xs px-3 py-1">
                {searchResults.length}{searchResults.length === 50 ? '+' : ''} result{searchResults.length !== 1 ? 's' : ''}
              </p>
              {searchResults.map(result => (
                <SearchResultItem
                  key={`${result.chatId}-${result.message.id}`}
                  result={result}
                  query={searchQuery.trim()}
                  onSelect={() => { setSearchQuery(''); onClose() }}
                />
              ))}
            </>
          )
        ) : (
          <>
            {sidebarTab === 'channels' && (
              <>
                <button
                  onClick={() => { setShowAddChannel(true); onClose() }}
                  className="w-full flex items-center gap-2 px-3 py-3 text-purple-400 hover:text-purple-300 text-sm transition-colors rounded-xl hover:bg-purple-600/10"
                >
                  <Plus size={16} />
                  <span>Add / Discover Channels</span>
                </button>
                {joinedChannels.length === 0 && (
                  <p className="text-gray-500 text-xs text-center px-4 py-6">
                    No channels yet. Discover or create one above.
                  </p>
                )}
                {joinedChannels.map(ch => (
                  <ChannelItem
                    key={ch.id}
                    channel={ch}
                    isActive={activeChatId === ch.id && activeChatType === 'channel'}
                    onSelect={onClose}
                  />
                ))}
              </>
            )}

            {sidebarTab === 'dms' && (
              <>
                <button
                  onClick={() => { setShowAddContact(true); onClose() }}
                  className="w-full flex items-center gap-2 px-3 py-3 text-purple-400 hover:text-purple-300 text-sm transition-colors rounded-xl hover:bg-purple-600/10"
                >
                  <Plus size={16} />
                  <span>New Message</span>
                </button>
                {contacts.length === 0 && (
                  <p className="text-gray-500 text-xs text-center px-4 py-6">
                    No conversations yet.
                  </p>
                )}
                {contacts.map(c => (
                  <ContactItem
                    key={c.pubkey}
                    contact={c}
                    isActive={activeChatId === c.pubkey && activeChatType === 'dm'}
                    onSelect={onClose}
                  />
                ))}
              </>
            )}

            {sidebarTab === 'contacts' && (
              <>
                <button
                  onClick={() => { setShowAddContact(true); onClose() }}
                  className="w-full flex items-center gap-2 px-3 py-3 text-purple-400 hover:text-purple-300 text-sm transition-colors rounded-xl hover:bg-purple-600/10"
                >
                  <Plus size={16} />
                  <span>Add Contact</span>
                </button>
                {contacts.length === 0 && (
                  <p className="text-gray-500 text-xs text-center px-4 py-6">
                    No contacts yet.
                  </p>
                )}
                {contacts.map(c => (
                  <ContactItem
                    key={c.pubkey}
                    contact={c}
                    isActive={activeChatId === c.pubkey && activeChatType === 'dm'}
                    onSelect={onClose}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Profile footer */}
      <div className="px-3 py-3 border-t border-gray-800" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
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
    </div>
  )

  return (
    <>
      {/* Desktop: static sidebar */}
      <div className="hidden md:flex md:w-72 md:flex-shrink-0 border-r border-gray-800 h-full">
        {sidebarContent}
      </div>

      {/* Mobile: slide-over drawer */}
      {/* Backdrop */}
      <div
        className={`md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      {/* Drawer */}
      <div
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarContent}
      </div>
    </>
  )
}
