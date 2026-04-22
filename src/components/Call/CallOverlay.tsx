import { useEffect, useRef } from 'react'
import { Mic, MicOff, Video, VideoOff, PhoneOff, Phone, ScreenShare, ScreenShareOff } from 'lucide-react'
import { useCallContext } from '../../contexts/CallContext'
import { useNostrStore } from '../../store/nostrStore'
import { Avatar } from '../Chat/Avatar'
import { getDisplayName } from '../../lib/fileUtils'
import { formatDuration } from '../Chat/AudioMessage'

function VideoEl({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={className}
    />
  )
}

function RemoteAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  return <audio ref={ref} autoPlay />
}

export function CallOverlay() {
  const {
    callState, peer, mediaType,
    localStream, remoteStream,
    isMuted, isCameraOff, isScreenSharing,
    duration, isRtcConnected,
    hangup, toggleMute, toggleCamera, toggleScreenShare,
  } = useCallContext()
  const { profiles, contacts } = useNostrStore()

  if (callState !== 'calling' && callState !== 'connected') return null
  if (!peer) return null

  const profile = contacts.find(c => c.pubkey === peer.pubkey)?.profile || profiles[peer.pubkey]
  const name = getDisplayName(profile, peer.pubkey)
  const statusLabel = callState === 'calling'
    ? 'Calling…'
    : isRtcConnected
      ? formatDuration(duration)
      : 'Connecting…'

  return (
    <div className="fixed inset-0 z-40 bg-gray-950 flex flex-col">
      {/* Hidden audio element plays remote audio for both call types.
          Video calls also get audio through this; VideoEl handles the visuals. */}
      <RemoteAudio stream={remoteStream} />
      {/* Main area — fills all available space */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        {mediaType === 'video' && remoteStream ? (
          <VideoEl
            stream={remoteStream}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-4 pb-32">
            <Avatar picture={profile?.picture} name={name} pubkey={peer.pubkey} size="lg" />
            <div className="text-center">
              <p className="text-white font-semibold text-xl">{name}</p>
              <p className="text-gray-400 text-sm mt-1">{statusLabel}</p>
            </div>
            {/* Audio pulse animation while connecting */}
            {callState === 'connected' && isRtcConnected && (
              <div className="flex gap-1 items-end h-6 mt-2">
                {[0, 1, 2, 3, 4].map(i => (
                  <div
                    key={i}
                    className="w-1 bg-purple-400 rounded-full animate-bounce"
                    style={{ height: `${12 + (i % 3) * 6}px`, animationDelay: `${i * 100}ms` }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Top overlay: name + status (video calls) */}
        {mediaType === 'video' && (
          <div className="absolute top-4 left-0 right-0 flex flex-col items-center gap-1 pointer-events-none">
            <p className="text-white font-semibold text-lg drop-shadow">{name}</p>
            <p className="text-white/70 text-sm drop-shadow">{statusLabel}</p>
            {isScreenSharing && (
              <span className="mt-1 flex items-center gap-1.5 bg-blue-500/30 border border-blue-400/50 rounded-full px-3 py-0.5 text-blue-300 text-xs font-medium">
                <ScreenShare size={12} />
                Sharing your screen
              </span>
            )}
          </div>
        )}

        {/* Local video PiP — sits above the controls bar */}
        {mediaType === 'video' && (
          <div className="absolute bottom-28 right-4 w-28 h-40 rounded-2xl overflow-hidden border-2 border-gray-700 bg-gray-800 shadow-xl">
            {localStream && !isCameraOff ? (
              <VideoEl stream={localStream} muted className="w-full h-full object-cover scale-x-[-1]" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <VideoOff size={20} className="text-gray-500" />
              </div>
            )}
          </div>
        )}

        {/* Controls — always overlaid at the bottom */}
        <div
          className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-6 px-6 pt-12 pb-8 bg-gradient-to-t from-gray-950/90 to-transparent"
          style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
        >
          <button
            onClick={toggleMute}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
              isMuted ? 'bg-red-500/30 text-red-400' : 'bg-gray-800/80 text-white hover:bg-gray-700'
            }`}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
          </button>

          {mediaType === 'video' && (
            <button
              onClick={toggleCamera}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
                isCameraOff ? 'bg-red-500/30 text-red-400' : 'bg-gray-800/80 text-white hover:bg-gray-700'
              }`}
              title={isCameraOff ? 'Turn on camera' : 'Turn off camera'}
            >
              {isCameraOff ? <VideoOff size={22} /> : <Video size={22} />}
            </button>
          )}

          {mediaType === 'video' && (
            <button
              onClick={() => void toggleScreenShare()}
              disabled={!isRtcConnected}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                isScreenSharing
                  ? 'bg-blue-500/30 text-blue-300 ring-1 ring-blue-400/50'
                  : 'bg-gray-800/80 text-white hover:bg-gray-700'
              }`}
              title={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
            >
              {isScreenSharing ? <ScreenShareOff size={22} /> : <ScreenShare size={22} />}
            </button>
          )}

          <button
            onClick={hangup}
            className="w-16 h-16 bg-red-600 hover:bg-red-500 rounded-full flex items-center justify-center transition-colors shadow-lg"
            title="Hang up"
          >
            <PhoneOff size={26} className="text-white" />
          </button>

          {mediaType === 'audio' && <div className="w-14 h-14" />}
        </div>

        {/* Audio-only status pill */}
        {mediaType === 'audio' && callState === 'connected' && isRtcConnected && (
          <div className="absolute top-4 right-4 flex items-center gap-1.5 bg-green-500/20 border border-green-500/40 rounded-full px-3 py-1">
            <Phone size={11} className="text-green-400" />
            <span className="text-green-400 text-xs tabular-nums">{formatDuration(duration)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
