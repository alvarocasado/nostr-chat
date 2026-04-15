import { format } from 'date-fns'
import { Avatar } from './Avatar'
import type { Message } from '../../store/nostrStore'
import type { NostrProfile } from '../../lib/nostr'

interface MessageItemProps {
  message: Message
  profile?: NostrProfile
  isOwn: boolean
  showAvatar: boolean
}

export function MessageItem({ message, profile, isOwn, showAvatar }: MessageItemProps) {
  const name = profile?.display_name || profile?.name || message.pubkey.slice(0, 10) + '...'
  const time = format(new Date(message.createdAt * 1000), 'HH:mm')

  if (isOwn) {
    return (
      <div className="flex flex-col items-end gap-1 group">
        <div className="flex items-end gap-2 max-w-[75%]">
          <span className="text-gray-600 text-xs opacity-0 group-hover:opacity-100 transition-opacity mb-1">
            {time}
          </span>
          <div className="bg-purple-600 rounded-2xl rounded-br-md px-4 py-2.5">
            <p className="text-white text-sm leading-relaxed break-words whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-end gap-2 group">
      <div className="w-8 flex-shrink-0">
        {showAvatar && (
          <Avatar
            picture={profile?.picture}
            name={name}
            pubkey={message.pubkey}
            size="sm"
          />
        )}
      </div>
      <div className="flex flex-col gap-1 max-w-[75%]">
        {showAvatar && (
          <span className="text-xs text-purple-400 font-medium px-1">{name}</span>
        )}
        <div className="flex items-end gap-2">
          <div className="bg-gray-800 rounded-2xl rounded-bl-md px-4 py-2.5">
            <p className="text-gray-100 text-sm leading-relaxed break-words whitespace-pre-wrap">{message.content}</p>
          </div>
          <span className="text-gray-600 text-xs opacity-0 group-hover:opacity-100 transition-opacity mb-1 flex-shrink-0">
            {time}
          </span>
        </div>
      </div>
    </div>
  )
}
