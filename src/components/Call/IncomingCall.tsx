import { Phone, PhoneOff, Video } from 'lucide-react'
import { useCallContext } from '../../contexts/CallContext'
import { useNostrStore } from '../../store/nostrStore'
import { Avatar } from '../Chat/Avatar'
import { getDisplayName } from '../../lib/fileUtils'

export function IncomingCall() {
  const { callState, peer, mediaType, acceptCall, rejectCall } = useCallContext()
  const { profiles, contacts } = useNostrStore()

  if (callState !== 'incoming' || !peer) return null

  const profile = contacts.find(c => c.pubkey === peer.pubkey)?.profile || profiles[peer.pubkey]
  const name = getDisplayName(profile, peer.pubkey)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-3xl shadow-2xl overflow-hidden">
        <div className="flex flex-col items-center gap-4 px-8 py-8">
          <Avatar picture={profile?.picture} name={name} pubkey={peer.pubkey} size="lg" />
          <div className="text-center">
            <p className="text-white font-semibold text-lg">{name}</p>
            <p className="text-gray-400 text-sm mt-1 flex items-center justify-center gap-1.5">
              {mediaType === 'video'
                ? <><Video size={14} />Incoming video call</>
                : <><Phone size={14} />Incoming audio call</>
              }
            </p>
          </div>
        </div>

        <div className="flex border-t border-gray-800">
          <button
            onClick={rejectCall}
            className="flex-1 flex flex-col items-center gap-1.5 py-5 text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center">
              <PhoneOff size={22} />
            </div>
            <span className="text-xs font-medium">Decline</span>
          </button>
          <div className="w-px bg-gray-800" />
          <button
            onClick={acceptCall}
            className="flex-1 flex flex-col items-center gap-1.5 py-5 text-green-400 hover:bg-green-500/10 transition-colors"
          >
            <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center">
              {mediaType === 'video' ? <Video size={22} /> : <Phone size={22} />}
            </div>
            <span className="text-xs font-medium">Accept</span>
          </button>
        </div>
      </div>
    </div>
  )
}
