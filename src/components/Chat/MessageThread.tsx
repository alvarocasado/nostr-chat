import { useEffect, useRef, useState } from 'react'
import { Send, Hash, Lock, Wifi, WifiOff } from 'lucide-react'
import { useNostrStore, type Message } from '../../store/nostrStore'
import { useChannelMessages, useDMMessages, sendChannelMessage, sendDM } from '../../hooks/useNostrSubscriptions'
import { MessageItem } from './MessageItem'
import { Avatar } from './Avatar'

function ChannelHeader({ channelId }: { channelId: string }) {
  const { channels } = useNostrStore()
  const channel = channels.find(c => c.id === channelId)

  return (
    <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-800 bg-gray-900">
      <div className="w-9 h-9 bg-purple-600 rounded-xl flex items-center justify-center">
        <Hash size={18} className="text-white" />
      </div>
      <div>
        <h2 className="font-semibold text-white">{channel?.name || 'Channel'}</h2>
        {channel?.about && (
          <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[300px]">{channel.about}</p>
        )}
      </div>
    </div>
  )
}

function DMHeader({ pubkey }: { pubkey: string }) {
  const { contacts, profiles } = useNostrStore()
  const contact = contacts.find(c => c.pubkey === pubkey)
  const profile = contact?.profile || profiles[pubkey]
  const name = profile?.display_name || profile?.name || pubkey.slice(0, 12) + '...'

  return (
    <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-800 bg-gray-900">
      <Avatar picture={profile?.picture} name={name} pubkey={pubkey} size="md" />
      <div>
        <h2 className="font-semibold text-white">{name}</h2>
        <div className="flex items-center gap-1 mt-0.5">
          <Lock size={11} className="text-green-400" />
          <span className="text-xs text-gray-500">End-to-end encrypted (NIP-04)</span>
        </div>
      </div>
    </div>
  )
}

function MessageInput({
  onSend,
  placeholder,
}: {
  onSend: (content: string) => Promise<void>
  placeholder: string
}) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = async () => {
    const content = text.trim()
    if (!content || sending) return
    setSending(true)
    setText('')
    try {
      await onSend(content)
    } catch (e) {
      setText(content)
    } finally {
      setSending(false)
      textareaRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }, [text])

  return (
    <div className="px-4 py-4 border-t border-gray-800 bg-gray-900">
      <div className="flex items-end gap-3 bg-gray-800 rounded-2xl px-4 py-3">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="flex-1 bg-transparent text-white placeholder-gray-500 resize-none outline-none text-sm leading-relaxed max-h-32 scrollbar-thin"
          style={{ overflow: 'hidden' }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          className="w-9 h-9 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl flex items-center justify-center transition-colors flex-shrink-0"
        >
          <Send size={16} className="text-white" />
        </button>
      </div>
      <p className="text-gray-600 text-xs mt-2 text-center">
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  )
}

function DateSeparator({ date }: { date: Date }) {
  const label = (() => {
    const now = new Date()
    const d = new Date(date)
    if (d.toDateString() === now.toDateString()) return 'Today'
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  })()

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 border-t border-gray-800" />
      <span className="text-xs text-gray-500 px-2">{label}</span>
      <div className="flex-1 border-t border-gray-800" />
    </div>
  )
}

function MessageList({ messages, myPubkey, profiles }: {
  messages: Message[]
  myPubkey: string
  profiles: Record<string, any>
}) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Wifi size={40} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No messages yet. Say hello!</p>
        </div>
      </div>
    )
  }

  const elements: React.ReactNode[] = []
  let lastDate = ''
  let lastPubkey = ''

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const msgDate = new Date(msg.createdAt * 1000).toDateString()

    if (msgDate !== lastDate) {
      elements.push(<DateSeparator key={`date-${msgDate}`} date={new Date(msg.createdAt * 1000)} />)
      lastDate = msgDate
      lastPubkey = ''
    }

    const showAvatar = msg.pubkey !== lastPubkey && msg.pubkey !== myPubkey
    lastPubkey = msg.pubkey

    elements.push(
      <MessageItem
        key={msg.id}
        message={msg}
        profile={profiles[msg.pubkey]}
        isOwn={msg.pubkey === myPubkey}
        showAvatar={showAvatar}
      />
    )
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-1.5">
      {elements}
      <div ref={bottomRef} />
    </div>
  )
}

// Channel thread
function ChannelThread({ channelId }: { channelId: string }) {
  const { publicKey, messages, profiles, relays, getPrivateKey } = useNostrStore()
  useChannelMessages(channelId)

  const chatMessages = messages[channelId] || []

  const handleSend = async (content: string) => {
    const sk = getPrivateKey()
    if (!sk || !publicKey) return
    await sendChannelMessage(sk, content, channelId, relays)
  }

  return (
    <>
      <ChannelHeader channelId={channelId} />
      <MessageList messages={chatMessages} myPubkey={publicKey || ''} profiles={profiles} />
      <MessageInput onSend={handleSend} placeholder="Message channel..." />
    </>
  )
}

// DM thread
function DMThread({ theirPubkey }: { theirPubkey: string }) {
  const { publicKey, messages, profiles, relays, getPrivateKey } = useNostrStore()
  useDMMessages(publicKey, theirPubkey)

  const chatMessages = messages[theirPubkey] || []

  const handleSend = async (content: string) => {
    const sk = getPrivateKey()
    if (!sk || !publicKey) return
    await sendDM(sk, content, theirPubkey, relays)
    // Add our own message locally for immediate feedback
  }

  return (
    <>
      <DMHeader pubkey={theirPubkey} />
      <MessageList messages={chatMessages} myPubkey={publicKey || ''} profiles={profiles} />
      <MessageInput onSend={handleSend} placeholder="Encrypted message..." />
    </>
  )
}

export function MessageThread() {
  const { activeChatId, activeChatType } = useNostrStore()

  if (!activeChatId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950">
        <div className="text-center space-y-4 px-8">
          <div className="w-20 h-20 bg-gray-900 rounded-2xl flex items-center justify-center mx-auto">
            <WifiOff size={36} className="text-gray-600" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-gray-300">Select a chat</h3>
            <p className="text-gray-500 text-sm mt-1">
              Choose a channel or contact from the sidebar to start chatting.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-950 overflow-hidden">
      {activeChatType === 'channel' ? (
        <ChannelThread channelId={activeChatId} />
      ) : (
        <DMThread theirPubkey={activeChatId} />
      )}
    </div>
  )
}
