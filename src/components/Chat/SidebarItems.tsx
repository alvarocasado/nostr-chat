import { useState, useRef, useEffect } from 'react'
import { Hash, MessageCircle, Users, BellOff, Bell } from 'lucide-react'
import { useNostrStore, type Channel, type Contact, type Message, type ChatType, type Group } from '../../store/nostrStore'
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

export interface SearchResult {
  chatId: string
  chatType: ChatType
  chatName: string
  message: Message
  senderName: string
}

export function SearchResultItem({ result, query, onSelect, targetMessageId }: { result: SearchResult; query: string; onSelect: () => void; targetMessageId?: string }) {
  const { setActiveChat, jumpToMessage } = useNostrStore()

  const handleClick = () => {
    if (targetMessageId) {
      jumpToMessage(result.chatId, result.chatType, targetMessageId)
    } else {
      setActiveChat(result.chatId, result.chatType)
    }
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

export function ChannelItem({ channel, isActive, onSelect }: { channel: Channel; isActive: boolean; onSelect: () => void }) {
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
            ? 'bg-gradient-to-br from-violet-500/15 to-purple-700/15 border border-violet-500/40 text-white shadow-[0_0_8px_rgba(124,58,237,0.10)]'
            : 'hover:bg-white/5 text-gray-300 hover:text-white'
        }`}
      >
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
          isActive ? 'bg-gradient-to-br from-violet-500 to-purple-700' : 'bg-gray-800'
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

export function ContactItem({ contact, isActive, onSelect }: { contact: Contact; isActive: boolean; onSelect: () => void }) {
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
            ? 'bg-gradient-to-br from-violet-500/15 to-purple-700/15 border border-violet-500/40 text-white shadow-[0_0_8px_rgba(124,58,237,0.10)]'
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

export function GroupItem({ group, isActive, onSelect }: { group: Group; isActive: boolean; onSelect: () => void }) {
  const { setActiveChat } = useNostrStore()

  const hasMention = (group.mentions || 0) > 0
  const hasUnread = (group.unread || 0) > 0

  return (
    <div className="group relative">
      <button
        onClick={() => { setActiveChat(group.id, 'group'); onSelect() }}
        className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-left ${
          isActive
            ? 'bg-gradient-to-br from-violet-500/15 to-purple-700/15 border border-violet-500/40 text-white shadow-[0_0_8px_rgba(124,58,237,0.10)]'
            : 'hover:bg-white/5 text-gray-300 hover:text-white'
        }`}
      >
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
          isActive ? 'bg-gradient-to-br from-violet-500 to-purple-700' : 'bg-gray-800'
        }`}>
          <Users size={16} className={isActive ? 'text-white' : 'text-gray-400'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className={`font-medium truncate text-sm ${hasMention ? 'text-white' : ''}`}>{group.name}</span>
            <span className="text-gray-500 text-xs flex-shrink-0">{formatTime(group.lastMessageAt)}</span>
          </div>
          {group.lastMessage ? (
            <p className="text-xs text-gray-500 truncate mt-0.5">{group.lastMessage}</p>
          ) : (
            <p className="text-xs text-gray-600 truncate mt-0.5">{group.memberPubkeys.length} members</p>
          )}
        </div>
        {hasUnread && (
          <span className={`flex-shrink-0 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center ${
            hasMention ? 'bg-amber-500' : 'bg-gray-600'
          }`}>
            {hasMention ? (group.mentions! > 9 ? '9+' : group.mentions) : (group.unread! > 9 ? '9+' : group.unread)}
          </span>
        )}
      </button>
      <div className="absolute right-2 top-1/2 -translate-y-1/2">
        <MuteButton chatId={group.id} />
      </div>
    </div>
  )
}
