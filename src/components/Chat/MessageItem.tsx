import { format } from 'date-fns'
import { Download, FileText, Film, Music, File } from 'lucide-react'
import { Avatar } from './Avatar'
import { AudioMessage } from './AudioMessage'
import type { Message } from '../../store/nostrStore'
import type { NostrProfile } from '../../lib/nostr'
import { parseMessageContent, formatBytes, type AttachmentData } from '../../lib/fileUtils'

interface MessageItemProps {
  message: Message
  profile?: NostrProfile
  isOwn: boolean
  showAvatar: boolean
}

function fileIcon(type: string) {
  if (type.startsWith('video/')) return <Film size={20} className="text-blue-400" />
  if (type.startsWith('audio/')) return <Music size={20} className="text-green-400" />
  if (type === 'application/pdf') return <FileText size={20} className="text-red-400" />
  return <File size={20} className="text-gray-400" />
}

function handleDownload(attachment: AttachmentData) {
  const a = document.createElement('a')
  a.href = attachment.data
  a.download = attachment.name
  a.click()
}

function AttachmentView({ attachment, isOwn }: { attachment: AttachmentData; isOwn: boolean }) {
  if (attachment.type.startsWith('image/')) {
    return (
      <img
        src={attachment.data}
        alt={attachment.name}
        className="max-w-full rounded-xl object-contain"
        style={{ maxHeight: 300 }}
      />
    )
  }

  if (attachment.type.startsWith('audio/')) {
    return <AudioMessage src={attachment.data} isOwn={isOwn} />
  }

  return (
    <button
      onClick={() => handleDownload(attachment)}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors w-full text-left ${
        isOwn
          ? 'bg-purple-700/60 border-purple-500/40 hover:bg-purple-700/80'
          : 'bg-gray-700/60 border-gray-600/40 hover:bg-gray-700/80'
      }`}
    >
      {fileIcon(attachment.type)}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{attachment.name}</p>
        <p className="text-xs text-gray-400">{formatBytes(attachment.size)}</p>
      </div>
      <Download size={16} className="text-gray-400 flex-shrink-0" />
    </button>
  )
}

function MessageBubble({ content, isOwn }: { content: string; isOwn: boolean }) {
  if (!content) return null
  return (
    <p className={`text-sm leading-relaxed break-words whitespace-pre-wrap ${isOwn ? 'text-white' : 'text-gray-100'}`}>
      {content}
    </p>
  )
}

export function MessageItem({ message, profile, isOwn, showAvatar }: MessageItemProps) {
  const name = profile?.display_name || profile?.name || message.pubkey.slice(0, 10) + '...'
  const time = format(new Date(message.createdAt * 1000), 'HH:mm')
  const { text, attachment } = parseMessageContent(message.content)

  if (isOwn) {
    return (
      <div className="flex flex-col items-end gap-1 group">
        <div className="flex items-end gap-2 max-w-[75%]">
          <span className="text-gray-600 text-xs opacity-0 group-hover:opacity-100 transition-opacity mb-1">
            {time}
          </span>
          <div className="bg-purple-600 rounded-2xl rounded-br-md px-4 py-2.5 flex flex-col gap-2">
            {attachment && <AttachmentView attachment={attachment} isOwn />}
            <MessageBubble content={text} isOwn />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-end gap-2 group">
      <div className="w-8 flex-shrink-0">
        {showAvatar && (
          <Avatar picture={profile?.picture} name={name} pubkey={message.pubkey} size="sm" />
        )}
      </div>
      <div className="flex flex-col gap-1 max-w-[75%]">
        {showAvatar && (
          <span className="text-xs text-purple-400 font-medium px-1">{name}</span>
        )}
        <div className="flex items-end gap-2">
          <div className="bg-gray-800 rounded-2xl rounded-bl-md px-4 py-2.5 flex flex-col gap-2">
            {attachment && <AttachmentView attachment={attachment} isOwn={false} />}
            <MessageBubble content={text} isOwn={false} />
          </div>
          <span className="text-gray-600 text-xs opacity-0 group-hover:opacity-100 transition-opacity mb-1 flex-shrink-0">
            {time}
          </span>
        </div>
      </div>
    </div>
  )
}
