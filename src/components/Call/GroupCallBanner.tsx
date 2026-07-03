import { Phone } from 'lucide-react'
import { useGroupCallContext } from '../../contexts/GroupCallContext'
import { MAX_GROUP_CALL_PARTICIPANTS } from '../../lib/groupCall'

const DISABLED_LABELS = {
  full: 'Call full',
  busy: 'In another call',
  'other-device': 'In call on another device',
} as const

export function GroupCallBanner({ groupId }: { groupId: string }) {
  const { liveCall, joinState, startOrJoin } = useGroupCallContext()
  if (!liveCall || joinState === 'in-call') return null

  const disabled = joinState !== 'can-join'
  const label = disabled ? DISABLED_LABELS[joinState as keyof typeof DISABLED_LABELS] : 'Join'

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-green-500/10 border-b border-green-500/30">
      <Phone size={16} className="text-green-400 flex-shrink-0" />
      <p className="flex-1 text-sm text-white min-w-0 truncate">
        Call in progress · {liveCall.participants.length}/{MAX_GROUP_CALL_PARTICIPANTS}
      </p>
      <button
        onClick={() => startOrJoin(groupId, liveCall.mediaType)}
        disabled={disabled}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {label}
      </button>
    </div>
  )
}
