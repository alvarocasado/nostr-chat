import { useEffect, useRef } from 'react'
import { Mic, MicOff, Video, VideoOff, PhoneOff } from 'lucide-react'
import { useGroupCallContext } from '../../contexts/GroupCallContext'
import { useNostrStore } from '../../store/nostrStore'
import { Avatar } from '../Chat/Avatar'
import { getDisplayName } from '../../lib/fileUtils'
import { formatDuration } from '../../lib/format'

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

export function GroupCallOverlay() {
  const {
    groupCallState, mediaType, localStream, remoteStreams, peerStates,
    isMuted, isCameraOff, duration,
    leave, toggleMute, toggleCamera,
  } = useGroupCallContext()
  const { publicKey, profiles, contacts } = useNostrStore()

  if (groupCallState !== 'in-call') return null

  const myPubkey = publicKey ?? ''
  const remoteKeys = new Set<string>([...remoteStreams.keys(), ...peerStates.keys()])
  const participants = [myPubkey, ...remoteKeys]
  const total = participants.length
  const gridColsClass = total <= 2 ? 'grid-cols-1' : 'grid-cols-2'

  return (
    <div className="fixed inset-0 z-[70] bg-gray-950 flex flex-col">
      {[...remoteStreams.entries()].map(([pubkey, stream]) => (
        <RemoteAudio key={pubkey} stream={stream} />
      ))}

      {/* Top-center status */}
      <div className="flex flex-col items-center gap-1 pt-4 pb-2 pointer-events-none">
        <p className="text-white font-semibold text-sm drop-shadow">{total} in call</p>
        <p className="text-white/70 text-xs drop-shadow tabular-nums">{formatDuration(duration)}</p>
      </div>

      <div data-testid="tile-grid" className={`grid gap-2 p-2 flex-1 overflow-hidden ${gridColsClass}`}>
        {participants.map(pubkey => {
          const isSelf = pubkey === myPubkey
          const profile = isSelf
            ? profiles[pubkey]
            : (contacts.find(c => c.pubkey === pubkey)?.profile || profiles[pubkey])
          const name = isSelf ? 'You' : getDisplayName(profile, pubkey)
          const stream = isSelf ? localStream : (remoteStreams.get(pubkey) ?? null)
          const peerState = isSelf ? undefined : peerStates.get(pubkey)
          const showVideo = mediaType === 'video' && !!stream && (!isSelf || !isCameraOff)

          return (
            <div
              key={pubkey}
              data-testid="call-tile"
              className="relative rounded-2xl overflow-hidden bg-gray-900 min-h-0"
            >
              {showVideo ? (
                <VideoEl
                  stream={stream}
                  muted={isSelf}
                  className={`w-full h-full object-cover ${isSelf ? 'scale-x-[-1]' : ''}`}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                  <Avatar picture={profile?.picture} name={name} pubkey={pubkey} size="lg" />
                  <p className="text-white text-sm font-medium">{name}</p>
                </div>
              )}

              <div className="absolute bottom-2 left-2 bg-black/50 rounded-full px-2 py-0.5">
                <p className="text-white text-xs">{name}</p>
              </div>

              {peerState === 'connecting' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <p className="text-white text-sm">Connecting…</p>
                </div>
              )}
              {peerState === 'failed' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <p className="text-red-400 text-sm">Connection failed</p>
                </div>
              )}
            </div>
          )
        })}
      </div>

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

        <button
          onClick={leave}
          className="w-16 h-16 bg-red-600 hover:bg-red-500 rounded-full flex items-center justify-center transition-colors shadow-lg"
          title="Hang up"
        >
          <PhoneOff size={26} className="text-white" />
        </button>

        {mediaType === 'audio' && <div className="w-14 h-14" />}
      </div>
    </div>
  )
}
