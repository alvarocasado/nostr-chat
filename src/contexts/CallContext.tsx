import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from 'react'
import { subscribeEvents, publishEvent } from '../lib/nostr'
import { useNostrStore } from '../store/nostrStore'
import { fireCallNotification } from '../lib/notifications'
import {
  buildCallSignalEvent, decryptCallSignal,
  getIceServers, CALL_SIGNAL_KIND,
  type CallSignal, type MediaType,
} from '../lib/webrtc'

export type CallState = 'idle' | 'calling' | 'incoming' | 'connected'

export interface CallPeer { pubkey: string }

interface CallContextValue {
  callState: CallState
  peer: CallPeer | null
  mediaType: MediaType
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  isMuted: boolean
  isCameraOff: boolean
  isScreenSharing: boolean
  duration: number
  isRtcConnected: boolean
  iceConnFailed: boolean
  initiateCall: (peerPubkey: string, type: MediaType) => void
  acceptCall: () => void
  rejectCall: () => void
  hangup: () => void
  toggleMute: () => void
  toggleCamera: () => void
  toggleScreenShare: () => Promise<void>
  dismissIceFailure: () => void
}

const CallContext = createContext<CallContextValue | null>(null)

export function useCallContext() {
  const ctx = useContext(CallContext)
  if (!ctx) throw new Error('useCallContext must be within CallProvider')
  return ctx
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { publicKey, relays, getPrivateKey } = useNostrStore()

  const [callState, setCallState]       = useState<CallState>('idle')
  const [peer, setPeer]                 = useState<CallPeer | null>(null)
  const [mediaType, setMediaType]       = useState<MediaType>('audio')
  const [localStream, setLocalStream]   = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [isMuted, setIsMuted]               = useState(false)
  const [isCameraOff, setIsCameraOff]       = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [duration, setDuration]             = useState(0)
  const [isRtcConnected, setIsRtcConnected] = useState(false)
  const [iceConnFailed, setIceConnFailed]   = useState(false)

  const pcRef              = useRef<RTCPeerConnection | null>(null)
  const callIdRef          = useRef('')
  const pendingCandidates  = useRef<RTCIceCandidateInit[]>([])
  const preOfferCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())
  const pendingOffer       = useRef<{ sdp: string; peerPubkey: string } | null>(null)
  const localStreamRef     = useRef<MediaStream | null>(null)
  const screenStreamRef    = useRef<MediaStream | null>(null)
  const durationTimer      = useRef<ReturnType<typeof setInterval> | null>(null)
  const callStateRef       = useRef<CallState>('idle')

  // Keep ref in sync so callbacks always see current state
  useEffect(() => { callStateRef.current = callState }, [callState])

  // ── Helpers ───────────────────────────────────────────────────────────────

  const sendSignal = useCallback(async (peerPubkey: string, signal: CallSignal) => {
    const sk = getPrivateKey()
    if (!sk) return
    const event = await buildCallSignalEvent(sk, peerPubkey, signal)
    await publishEvent(relays, event)
  }, [relays, getPrivateKey])

  const stopLocalStream = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    localStreamRef.current = null
    setLocalStream(null)
  }, [])

  const cleanup = useCallback(() => {
    pcRef.current?.close()
    pcRef.current = null
    stopLocalStream()
    screenStreamRef.current?.getTracks().forEach(t => t.stop())
    screenStreamRef.current = null
    setRemoteStream(null)
    setIsMuted(false)
    setIsCameraOff(false)
    setIsScreenSharing(false)
    setIsRtcConnected(false)
    setDuration(0)
    callIdRef.current = ''
    pendingCandidates.current = []
    preOfferCandidates.current.clear()
    pendingOffer.current = null
    if (durationTimer.current) { clearInterval(durationTimer.current); durationTimer.current = null }
    setCallState('idle')
    setPeer(null)
  }, [stopLocalStream])

  const startDurationTimer = useCallback(() => {
    if (durationTimer.current) return
    durationTimer.current = setInterval(() => setDuration(d => d + 1), 1000)
  }, [])

  const getUserMedia = useCallback(async (type: MediaType): Promise<MediaStream> => {
    let audioId: string | undefined
    let videoId: string | undefined
    try {
      audioId = localStorage.getItem('media_audio_device') || undefined
      videoId = localStorage.getItem('media_video_device') || undefined
    } catch {}
    return navigator.mediaDevices.getUserMedia({
      audio: audioId ? { deviceId: { ideal: audioId } } : true,
      video: type === 'video'
        ? { width: 1280, height: 720, ...(videoId ? { deviceId: { ideal: videoId } } : { facingMode: 'user' as const }) }
        : false,
    })
  }, [])

  // ── Peer connection setup ─────────────────────────────────────────────────

  const createPeerConnection = useCallback((peerPubkey: string) => {
    const pc = new RTCPeerConnection({ iceServers: getIceServers() })

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return
      void sendSignal(peerPubkey, {
        type: 'ice-candidate',
        callId: callIdRef.current,
        candidate: candidate.toJSON(),
      })
    }

    pc.ontrack = ({ streams }) => {
      if (streams[0]) setRemoteStream(streams[0])
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setIsRtcConnected(true)
        setIceConnFailed(false)
        startDurationTimer()
      }
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        cleanup()
      }
    }

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        setIceConnFailed(true)
      }
    }

    pcRef.current = pc
    return pc
  }, [sendSignal, startDurationTimer, cleanup])

  const flushPendingCandidates = useCallback(async () => {
    const pc = pcRef.current
    if (!pc || !pc.remoteDescription) return
    for (const c of pendingCandidates.current) {
      await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
    }
    pendingCandidates.current = []
  }, [])

  // ── Public actions ────────────────────────────────────────────────────────

  const initiateCall = useCallback(async (peerPubkey: string, type: MediaType) => {
    if (callStateRef.current !== 'idle') return
    const callId = Date.now().toString(36)
    callIdRef.current = callId
    setIceConnFailed(false)
    setMediaType(type)
    setPeer({ pubkey: peerPubkey })
    setCallState('calling')

    try {
      const stream = await getUserMedia(type)
      localStreamRef.current = stream
      setLocalStream(stream)

      const pc = createPeerConnection(peerPubkey)
      stream.getTracks().forEach(t => pc.addTrack(t, stream))

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      await sendSignal(peerPubkey, {
        type: 'call-offer',
        callId,
        mediaType: type,
        sdp: offer.sdp,
      })
    } catch {
      cleanup()
    }
  }, [getUserMedia, createPeerConnection, sendSignal, cleanup])

  const acceptCall = useCallback(async () => {
    const offer = pendingOffer.current
    if (!offer || callStateRef.current !== 'incoming') return
    const { sdp, peerPubkey } = offer
    setCallState('connected')

    try {
      const type = mediaType
      const stream = await getUserMedia(type)
      localStreamRef.current = stream
      setLocalStream(stream)

      const pc = createPeerConnection(peerPubkey)
      stream.getTracks().forEach(t => pc.addTrack(t, stream))

      await pc.setRemoteDescription({ type: 'offer', sdp })
      await flushPendingCandidates()

      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)

      await sendSignal(peerPubkey, {
        type: 'call-answer',
        callId: callIdRef.current,
        sdp: answer.sdp,
      })
    } catch {
      cleanup()
    }
  }, [mediaType, getUserMedia, createPeerConnection, flushPendingCandidates, sendSignal, cleanup])

  const rejectCall = useCallback(() => {
    const offer = pendingOffer.current
    if (offer) {
      void sendSignal(offer.peerPubkey, {
        type: 'call-end',
        callId: callIdRef.current,
        reason: 'rejected',
      })
    }
    cleanup()
  }, [sendSignal, cleanup])

  const hangup = useCallback(() => {
    if (peer) {
      void sendSignal(peer.pubkey, {
        type: 'call-end',
        callId: callIdRef.current,
        reason: 'ended',
      })
    }
    cleanup()
  }, [peer, sendSignal, cleanup])

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current
    if (!stream) return
    stream.getAudioTracks().forEach(t => { t.enabled = !t.enabled })
    setIsMuted(m => !m)
  }, [])

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current
    if (!stream) return
    stream.getVideoTracks().forEach(t => { t.enabled = !t.enabled })
    setIsCameraOff(v => !v)
  }, [])

  const revertToCamera = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach(t => t.stop())
    screenStreamRef.current = null
    setIsScreenSharing(false)
    const cameraTrack = localStreamRef.current?.getVideoTracks()[0]
    const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video')
    if (sender && cameraTrack) void sender.replaceTrack(cameraTrack)
  }, [])

  const toggleScreenShare = useCallback(async () => {
    const pc = pcRef.current
    if (!pc || !isRtcConnected) return

    if (isScreenSharing) {
      revertToCamera()
      return
    }

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      screenStreamRef.current = screenStream
      const screenTrack = screenStream.getVideoTracks()[0]

      const sender = pc.getSenders().find(s => s.track?.kind === 'video')
      if (!sender) { screenStream.getTracks().forEach(t => t.stop()); return }

      await sender.replaceTrack(screenTrack)
      setIsScreenSharing(true)

      // Auto-revert when the OS "Stop sharing" button is clicked
      screenTrack.onended = revertToCamera
    } catch {
      // User cancelled the picker or permission denied — no-op
    }
  }, [isRtcConnected, isScreenSharing, revertToCamera])

  // ── Incoming signal handler ───────────────────────────────────────────────

  const handleSignal = useCallback(async (senderPubkey: string, signal: CallSignal) => {
    const sk = getPrivateKey()
    if (!sk) return

    if (signal.type === 'call-offer') {
      if (callStateRef.current !== 'idle') {
        await sendSignal(senderPubkey, { type: 'call-end', callId: signal.callId, reason: 'busy' })
        return
      }
      if (typeof signal.sdp !== 'string') return
      callIdRef.current = signal.callId
      setIceConnFailed(false)
      // Recover ICE candidates that arrived before this offer (relay ordering not guaranteed)
      const preOffer = preOfferCandidates.current.get(signal.callId) ?? []
      preOfferCandidates.current.delete(signal.callId)
      pendingCandidates.current.push(...preOffer)
      pendingOffer.current = { sdp: signal.sdp, peerPubkey: senderPubkey }
      setMediaType(signal.mediaType ?? 'audio')
      setPeer({ pubkey: senderPubkey })
      setCallState('incoming')
      return
    }

    // Ice candidates may arrive before the offer when relays reorder events;
    // buffer them by callId so they can be flushed when the offer is processed.
    if (signal.type === 'ice-candidate' && signal.candidate && !callIdRef.current) {
      const bucket = preOfferCandidates.current.get(signal.callId) ?? []
      bucket.push(signal.candidate)
      preOfferCandidates.current.set(signal.callId, bucket)
      return
    }

    if (signal.callId !== callIdRef.current) return

    if (signal.type === 'call-answer') {
      const pc = pcRef.current
      if (!pc || typeof signal.sdp !== 'string') return
      await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp })
      await flushPendingCandidates()
      setCallState('connected')
      return
    }

    if (signal.type === 'ice-candidate' && signal.candidate) {
      const pc = pcRef.current
      if (pc?.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {})
      } else {
        pendingCandidates.current.push(signal.candidate)
      }
      return
    }

    if (signal.type === 'call-end') {
      cleanup()
    }
  }, [getPrivateKey, sendSignal, flushPendingCandidates, cleanup])

  // ── Nostr subscription for call signals ──────────────────────────────────

  useEffect(() => {
    if (!publicKey) return
    const sk = getPrivateKey()
    if (!sk) return

    const sub = subscribeEvents(
      relays,
      { kinds: [CALL_SIGNAL_KIND], '#p': [publicKey] } as Parameters<typeof subscribeEvents>[1],
      async (event) => {
        const signal = await decryptCallSignal(sk, event.pubkey, event.content)
        if (signal) await handleSignal(event.pubkey, signal)
      },
    )
    return () => sub.close()
  }, [publicKey, relays, getPrivateKey, handleSignal])

  // Ringtone + browser banner while the incoming call modal is showing
  useEffect(() => {
    if (callState !== 'incoming' || !peer) return
    return fireCallNotification(peer.pubkey)
  }, [callState, peer?.pubkey])

  // Cleanup on unmount
  useEffect(() => () => { cleanup() }, [cleanup])

  const dismissIceFailure = useCallback(() => setIceConnFailed(false), [])

  return (
    <CallContext.Provider value={{
      callState, peer, mediaType,
      localStream, remoteStream,
      isMuted, isCameraOff, isScreenSharing, duration, isRtcConnected,
      iceConnFailed, dismissIceFailure,
      initiateCall, acceptCall, rejectCall, hangup,
      toggleMute, toggleCamera, toggleScreenShare,
    }}>
      {children}
    </CallContext.Provider>
  )
}
