import { useEffect, useRef, useState } from 'react'
import { Send, Hash, Lock, Wifi, WifiOff, Menu, ArrowLeft, Paperclip, X, Mic, Square } from 'lucide-react'
import { useNostrStore, type Message } from '../../store/nostrStore'
import { useChannelMessages, useDMMessages, sendChannelMessage, sendDM } from '../../hooks/useNostrSubscriptions'
import { MessageItem } from './MessageItem'
import { Avatar } from './Avatar'
import {
  compressImage, encodeFile, serializeMessage, formatBytes,
  MAX_ATTACHMENT_BYTES, MAX_RAW_FILE_BYTES, MAX_AUDIO_BYTES, type AttachmentData,
} from '../../lib/fileUtils'
import { useAudioRecorder, MAX_RECORDING_SECONDS } from '../../hooks/useAudioRecorder'
import { AudioMessage, formatDuration } from './AudioMessage'

interface MessageThreadProps {
  onOpenSidebar: () => void
}

function ChannelHeader({ channelId }: { channelId: string }) {
  const { channels, clearActiveChat } = useNostrStore()
  const channel = channels.find(c => c.id === channelId)

  return (
    <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-800 bg-gray-900">
      {/* Mobile back button */}
      <button
        onClick={clearActiveChat}
        className="md:hidden p-2 -ml-1 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
        aria-label="Back"
      >
        <ArrowLeft size={20} />
      </button>
      <div className="w-9 h-9 bg-purple-600 rounded-xl flex items-center justify-center flex-shrink-0">
        <Hash size={18} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="font-semibold text-white truncate">{channel?.name || 'Channel'}</h2>
        {channel?.about && (
          <p className="text-xs text-gray-500 mt-0.5 truncate">{channel.about}</p>
        )}
      </div>
    </div>
  )
}

function DMHeader({ pubkey }: { pubkey: string }) {
  const { contacts, profiles, clearActiveChat } = useNostrStore()
  const contact = contacts.find(c => c.pubkey === pubkey)
  const profile = contact?.profile || profiles[pubkey]
  const name = profile?.display_name || profile?.name || pubkey.slice(0, 12) + '...'

  return (
    <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-800 bg-gray-900">
      {/* Mobile back button */}
      <button
        onClick={clearActiveChat}
        className="md:hidden p-2 -ml-1 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
        aria-label="Back"
      >
        <ArrowLeft size={20} />
      </button>
      <Avatar picture={profile?.picture} name={name} pubkey={pubkey} size="md" />
      <div className="flex-1 min-w-0">
        <h2 className="font-semibold text-white truncate">{name}</h2>
        <div className="flex items-center gap-1 mt-0.5">
          <Lock size={11} className="text-green-400 flex-shrink-0" />
          <span className="text-xs text-gray-500">End-to-end encrypted</span>
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
  const [attachment, setAttachment] = useState<AttachmentData | null>(null)
  const [attachError, setAttachError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const recorder = useAudioRecorder()

  const canSend = (text.trim().length > 0 || attachment !== null) && !sending

  const handleSend = async () => {
    if (!canSend) return
    const content = serializeMessage(text.trim(), attachment)
    setSending(true)
    setText('')
    setAttachment(null)
    try {
      await onSend(content)
    } catch {
      setText(text)
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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setAttachError(null)
    try {
      let data: string
      if (file.type.startsWith('image/')) {
        data = await compressImage(file)
      } else {
        if (file.size > MAX_RAW_FILE_BYTES) {
          setAttachError(`File too large. Max ${MAX_RAW_FILE_BYTES / 1024} KB for non-image files.`)
          return
        }
        data = await encodeFile(file)
        if (data.length > MAX_ATTACHMENT_BYTES) {
          setAttachError(`Encoded file exceeds relay limit (${Math.round(data.length / 1024)} KB > ${MAX_ATTACHMENT_BYTES / 1024} KB).`)
          return
        }
      }
      setAttachment({ name: file.name, type: file.type, size: file.size, data })
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Failed to attach file.')
    }
  }

  // When recording stops, encode the blob and set as attachment
  const handleStopRecording = async () => {
    recorder.stop()
  }

  useEffect(() => {
    if (recorder.state !== 'stopped' || !recorder.audioBlob) return
    const blob = recorder.audioBlob
    const mime = blob.type || recorder.mimeType || 'audio/webm'
    const ext = mime.split(';')[0].split('/')[1] ?? 'webm'
    const reader = new FileReader()
    reader.onload = () => {
      const data = reader.result as string
      if (data.length > MAX_AUDIO_BYTES) {
        setAttachError(`Voice message too large (${Math.round(data.length / 1024)} KB). Try a shorter recording.`)
        recorder.reset()
        return
      }
      setAttachment({ name: `voice-message.${ext}`, type: mime, size: blob.size, data })
      recorder.reset()
    }
    reader.readAsDataURL(blob)
  }, [recorder.state, recorder.audioBlob]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (recorder.error) setAttachError(recorder.error)
  }, [recorder.error])

  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 120) + 'px'
    }
  }, [text])

  const isRecording = recorder.state === 'recording' || recorder.state === 'requesting'

  return (
    <div
      className="px-3 py-3 border-t border-gray-800 bg-gray-900"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      {/* Attachment preview */}
      {attachment && !isRecording && (
        <div className="mb-2 flex items-center gap-2 bg-gray-800 rounded-xl px-3 py-2">
          {attachment.type.startsWith('image/') ? (
            <img src={attachment.data} alt={attachment.name} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
          ) : attachment.type.startsWith('audio/') ? (
            <div className="flex-1 min-w-0 py-1">
              <AudioMessage src={attachment.data} isOwn />
            </div>
          ) : (
            <div className="w-12 h-12 bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0">
              <Paperclip size={18} className="text-gray-400" />
            </div>
          )}
          {!attachment.type.startsWith('audio/') && (
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{attachment.name}</p>
              <p className="text-xs text-gray-500">{formatBytes(attachment.size)}</p>
            </div>
          )}
          <button
            onClick={() => setAttachment(null)}
            className="p-1 text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
            aria-label="Remove attachment"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Error */}
      {attachError && (
        <div className="mb-2 flex items-center justify-between gap-2 bg-red-900/30 border border-red-700/50 rounded-xl px-3 py-2">
          <p className="text-xs text-red-400">{attachError}</p>
          <button onClick={() => setAttachError(null)} className="text-red-500 hover:text-red-300 flex-shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Recording row */}
      {isRecording ? (
        <div className="flex items-center gap-3 bg-gray-800 rounded-2xl px-4 py-3">
          <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
          <span className="text-sm text-white flex-1 tabular-nums">
            {recorder.state === 'requesting' ? 'Waiting for mic…' : `Recording  ${formatDuration(recorder.elapsed)} / ${formatDuration(MAX_RECORDING_SECONDS)}`}
          </span>
          <button
            onClick={handleStopRecording}
            disabled={recorder.state === 'requesting'}
            className="w-9 h-9 bg-red-600 hover:bg-red-500 disabled:opacity-40 rounded-xl flex items-center justify-center transition-colors flex-shrink-0"
            title="Stop recording"
          >
            <Square size={14} className="text-white fill-white" />
          </button>
          <button
            onClick={recorder.reset}
            className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors"
            title="Cancel"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        /* Normal input row */
        <div className="flex items-end gap-2 bg-gray-800 rounded-2xl px-3 py-2.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-gray-500 hover:text-purple-400 transition-colors flex-shrink-0 mb-0.5"
            title="Attach file"
            type="button"
          >
            <Paperclip size={18} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,text/*,audio/*,video/*"
            className="hidden"
            onChange={handleFileChange}
          />
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
          {/* Mic button — shown when no text typed and no attachment */}
          {!text.trim() && !attachment ? (
            <button
              onClick={() => { void recorder.start() }}
              className="w-10 h-10 text-gray-500 hover:text-purple-400 transition-colors flex items-center justify-center flex-shrink-0"
              title="Record voice message"
              type="button"
            >
              <Mic size={20} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="w-10 h-10 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl flex items-center justify-center transition-colors flex-shrink-0"
            >
              <Send size={16} className="text-white" />
            </button>
          )}
        </div>
      )}
      <p className="text-gray-600 text-xs mt-1.5 text-center hidden sm:block">
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
  profiles: Record<string, { name?: string; display_name?: string; picture?: string; pubkey: string }>
}) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center px-6">
          <Wifi size={40} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No messages yet. Say hello!</p>
        </div>
      </div>
    )
  }

  const elements: React.ReactNode[] = []
  let lastDate = ''
  let lastPubkey = ''

  for (const msg of messages) {
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
    <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4 space-y-1.5">
      {elements}
      <div ref={bottomRef} />
    </div>
  )
}

function ChannelThread({ channelId }: { channelId: string }) {
  const { publicKey, messages, profiles, relays, getPrivateKey } = useNostrStore()
  useChannelMessages(channelId)

  const handleSend = async (content: string) => {
    const sk = getPrivateKey()
    if (!sk || !publicKey) return
    await sendChannelMessage(sk, content, channelId, relays)
  }

  return (
    <>
      <ChannelHeader channelId={channelId} />
      <MessageList messages={messages[channelId] || []} myPubkey={publicKey || ''} profiles={profiles} />
      <MessageInput onSend={handleSend} placeholder="Message channel..." />
    </>
  )
}

function DMThread({ theirPubkey }: { theirPubkey: string }) {
  const { publicKey, messages, profiles, relays, getPrivateKey } = useNostrStore()
  useDMMessages(publicKey, theirPubkey)

  const handleSend = async (content: string) => {
    const sk = getPrivateKey()
    if (!sk || !publicKey) return
    await sendDM(sk, content, theirPubkey, relays)
  }

  return (
    <>
      <DMHeader pubkey={theirPubkey} />
      <MessageList messages={messages[theirPubkey] || []} myPubkey={publicKey || ''} profiles={profiles} />
      <MessageInput onSend={handleSend} placeholder="Encrypted message..." />
    </>
  )
}

export function MessageThread({ onOpenSidebar }: MessageThreadProps) {
  const { activeChatId, activeChatType } = useNostrStore()

  if (!activeChatId) {
    return (
      <div className="flex-1 flex flex-col bg-gray-950 overflow-hidden">
        {/* Mobile top bar (no active chat) */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-800 bg-gray-900 md:hidden">
          <button
            onClick={onOpenSidebar}
            className="p-2 -ml-1 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Menu"
          >
            <Menu size={22} />
          </button>
          <div className="w-7 h-7 bg-purple-600 rounded-lg flex items-center justify-center">
            <Hash size={14} className="text-white" />
          </div>
          <span className="font-bold text-white">NostrChat</span>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4 px-8">
            <div className="w-20 h-20 bg-gray-900 rounded-2xl flex items-center justify-center mx-auto">
              <WifiOff size={36} className="text-gray-600" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-gray-300">Select a chat</h3>
              <p className="text-gray-500 text-sm mt-1">
                Choose a channel or contact to start chatting.
              </p>
            </div>
            <button
              onClick={onOpenSidebar}
              className="md:hidden inline-flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              <Menu size={16} />
              Open Menu
            </button>
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
