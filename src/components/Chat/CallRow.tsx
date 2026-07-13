import { format } from 'date-fns'
import { Phone, PhoneMissed, Video } from 'lucide-react'
import type { Message } from '../../store/nostrStore'
import { useNostrStore } from '../../store/nostrStore'
import { useCallContext } from '../../contexts/CallContext'
import { callLogLabel, type CallLogPayload } from '../../lib/callLog'

interface CallRowProps {
  message: Message
  isOwn: boolean
  /** Parsed 1:1 call-log payload, or null for a group call-start row. */
  callLog: CallLogPayload | null
  senderName: string
}

/** Centered system row for call history records — replaces the bubble. */
export function CallRow({ message, isOwn, callLog, senderName }: CallRowProps) {
  const { initiateCall } = useCallContext()
  const activeCallType = useNostrStore(s => s.activeCallType)
  const time = format(new Date(message.createdAt * 1000), 'HH:mm')

  if (!callLog) {
    // Group call-start record: informational only (join happens via the banner).
    return (
      <div className="flex justify-center py-1" data-message-id={message.id}>
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 bg-gray-800/60 rounded-full px-3 py-1">
          <Phone size={12} className="text-gray-400" />
          {isOwn ? 'You' : senderName} started a call
          <span className="text-gray-600">· {time}</span>
        </span>
      </div>
    )
  }

  const missed = !isOwn && (callLog.outcome === 'missed' || callLog.outcome === 'busy')
  const peer = message.recipientPubkey
  const Icon = callLog.mediaType === 'video' ? Video : missed ? PhoneMissed : Phone

  return (
    <div className="flex justify-center py-1" data-message-id={message.id}>
      <button
        type="button"
        onClick={() => peer && initiateCall(peer, callLog.mediaType)}
        disabled={activeCallType !== 'none' || !peer}
        title="Call back"
        className="inline-flex items-center gap-1.5 text-xs bg-gray-800/60 hover:bg-gray-700/60 disabled:hover:bg-gray-800/60 disabled:cursor-default rounded-full px-3 py-1 transition-colors"
      >
        <Icon size={12} className={missed ? 'text-red-400' : 'text-gray-400'} />
        <span className={missed ? 'text-red-400' : 'text-gray-400'}>{callLogLabel(callLog, isOwn)}</span>
        <span className="text-gray-600">· {time}</span>
      </button>
    </div>
  )
}
