import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from 'react'
import { subscribeEvents, publishEvent } from '../lib/nostr'
import { useNostrStore } from '../store/nostrStore'
import { useReadRelays } from '../hooks/useRelays'
import { getSigner } from '../lib/signer'
import { sendGroupCallStart } from '../hooks/useNostrSubscriptions'
import {
  getCallUserMedia, buildCallSignalEvent, decryptCallSignal,
  fetchCallIceServers, CALL_SIGNAL_KIND, isStaleCallSignal,
  type CallSignal, type MediaType,
} from '../lib/webrtc'
import {
  GROUP_CALL_PRESENCE_KIND, PRESENCE_INTERVAL_MS,
  buildPresenceEvent, parsePresenceEvent, deriveRoster, deriveJoinState, myOfferWins, activeCallPeers,
  type Heartbeat, type LiveCall, type JoinState,
} from '../lib/groupCall'

export type GroupCallState = 'idle' | 'joining' | 'in-call'

// Roster staleness is re-evaluated on this cadence even without new events.
const ROSTER_TICK_MS = 10_000

export interface GroupCallContextValue {
  groupCallState: GroupCallState
  activeGroupId: string | null
  callId: string | null
  mediaType: MediaType
  liveCall: LiveCall | null
  joinState: JoinState
  localStream: MediaStream | null
  remoteStreams: ReadonlyMap<string, MediaStream>
  peerStates: ReadonlyMap<string, 'connecting' | 'connected' | 'failed'>
  isMuted: boolean
  isCameraOff: boolean
  duration: number
  watchGroup: (groupId: string | null) => void
  startOrJoin: (groupId: string, requested: MediaType) => void
  leave: () => void
  toggleMute: () => void
  toggleCamera: () => void
}

const GroupCallContext = createContext<GroupCallContextValue | null>(null)

// eslint-disable-next-line react-refresh/only-export-components -- co-locating the consumer hook with its provider, matching CallContext
export function useGroupCallContext() {
  const ctx = useContext(GroupCallContext)
  if (!ctx) throw new Error('useGroupCallContext must be within GroupCallProvider')
  return ctx
}

export function GroupCallProvider({ children }: { children: ReactNode }) {
  const publicKey = useNostrStore(s => s.publicKey)
  const readR = useReadRelays()

  const [groupCallState, setGroupCallState] = useState<GroupCallState>('idle')
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [watchedGroupId, setWatchedGroupId] = useState<string | null>(null)
  const [liveCall, setLiveCall] = useState<LiveCall | null>(null)
  const [mediaType, setMediaType] = useState<MediaType>('audio')
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map())
  const [peerStates, setPeerStates] = useState<Map<string, 'connecting' | 'connected' | 'failed'>>(new Map())
  const [isMuted, setIsMuted] = useState(false)
  const [isCameraOff, setIsCameraOff] = useState(false)
  const [duration, setDuration] = useState(0)

  // groupId -> pubkey -> latest heartbeat
  const heartbeatsRef   = useRef<Map<string, Map<string, Heartbeat>>>(new Map())
  const callIdRef       = useRef('')
  const activeGroupRef  = useRef<string | null>(null)
  const localStreamRef  = useRef<MediaStream | null>(null)
  const heartbeatTimer  = useRef<ReturnType<typeof setInterval> | null>(null)
  const durationTimer   = useRef<ReturnType<typeof setInterval> | null>(null)
  const stateRef        = useRef<GroupCallState>('idle')
  useEffect(() => { stateRef.current = groupCallState }, [groupCallState])

  const recomputeWatched = useCallback(() => {
    const gid = watchedGroupId
    if (!gid) { setLiveCall(null); return }
    setLiveCall(deriveRoster(heartbeatsRef.current.get(gid) ?? new Map(), Date.now()))
  }, [watchedGroupId])

  // ── Mesh: peer connections, ICE buffering, pending offers ──────────────────
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())
  const pendingOffersRef = useRef<Set<string>>(new Set())
  const iceServersRef = useRef<RTCIceServer[]>([])

  const sendSignal = useCallback(async (peerPubkey: string, signal: CallSignal) => {
    if (!getSigner()) return
    const event = await buildCallSignalEvent(peerPubkey, signal)
    await publishEvent(useNostrStore.getState().writeRelays(), event)
  }, [])

  // Fully removes a peer: closes its connection and clears every trace of it
  // from mesh state (used on call-end and roster-sweep expiry).
  const removePeer = useCallback((peerPubkey: string) => {
    peersRef.current.get(peerPubkey)?.close()
    peersRef.current.delete(peerPubkey)
    pendingCandidatesRef.current.delete(peerPubkey)
    pendingOffersRef.current.delete(peerPubkey)
    setRemoteStreams(prev => {
      if (!prev.has(peerPubkey)) return prev
      const next = new Map(prev)
      next.delete(peerPubkey)
      return next
    })
    setPeerStates(prev => {
      if (!prev.has(peerPubkey)) return prev
      const next = new Map(prev)
      next.delete(peerPubkey)
      return next
    })
  }, [])

  const flushPendingCandidates = useCallback(async (peerPubkey: string, pc: RTCPeerConnection) => {
    const queued = pendingCandidatesRef.current.get(peerPubkey)
    if (!queued || queued.length === 0) return
    pendingCandidatesRef.current.delete(peerPubkey)
    for (const c of queued) {
      await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
    }
  }, [])

  const createPeer = useCallback((peerPubkey: string) => {
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current })

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return
      void sendSignal(peerPubkey, {
        type: 'ice-candidate',
        callId: callIdRef.current,
        groupId: activeGroupRef.current ?? undefined,
        candidate: candidate.toJSON(),
      })
    }

    pc.ontrack = ({ streams }) => {
      if (!streams[0]) return
      const stream = streams[0]
      setRemoteStreams(prev => {
        const next = new Map(prev)
        next.set(peerPubkey, stream)
        return next
      })
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setPeerStates(prev => {
          const next = new Map(prev)
          next.set(peerPubkey, 'connected')
          return next
        })
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        // Per-peer isolation: only this connection is torn down; the rest of
        // the mesh (and the call itself) keeps running.
        setPeerStates(prev => {
          const next = new Map(prev)
          next.set(peerPubkey, 'failed')
          return next
        })
        pc.close()
        peersRef.current.delete(peerPubkey)
      }
    }

    peersRef.current.set(peerPubkey, pc)
    return pc
  }, [sendSignal])

  const connectToPeers = useCallback(async (pubkeys: string[]) => {
    iceServersRef.current = await fetchCallIceServers()
    for (const peerPubkey of pubkeys) {
      const pc = createPeer(peerPubkey)
      const stream = localStreamRef.current
      stream?.getTracks().forEach(t => pc.addTrack(t, stream))
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        pendingOffersRef.current.add(peerPubkey)
        setPeerStates(prev => {
          const next = new Map(prev)
          next.set(peerPubkey, 'connecting')
          return next
        })
        await sendSignal(peerPubkey, {
          type: 'call-offer',
          callId: callIdRef.current,
          groupId: activeGroupRef.current ?? undefined,
          mediaType: mediaTypeRef.current,
          sdp: offer.sdp,
          iceServers: iceServersRef.current,
        })
      } catch {
        // Leave this one peer out of the mesh; the rest of the join continues.
      }
    }
  }, [createPeer, sendSignal])

  const teardownMesh = useCallback(() => {
    for (const peerPubkey of peersRef.current.keys()) {
      void sendSignal(peerPubkey, {
        type: 'call-end',
        callId: callIdRef.current,
        groupId: activeGroupRef.current ?? undefined,
        reason: 'ended',
      })
    }
    for (const pc of peersRef.current.values()) pc.close()
    peersRef.current.clear()
    pendingCandidatesRef.current.clear()
    pendingOffersRef.current.clear()
  }, [sendSignal])

  // Heartbeat expiry fallback: close+remove any peer connection whose pubkey
  // has fallen out of the active group's live roster.
  const sweepMeshRoster = useCallback(() => {
    const gid = activeGroupRef.current
    if (!gid || stateRef.current !== 'in-call') return
    // Uses activeCallPeers (membership in the active callId), not deriveRoster
    // (which picks the smallest live callId) — see activeCallPeers' doc comment
    // for why the latter would wrongly evict peers still on the current call.
    const validPeers = new Set(
      activeCallPeers(heartbeatsRef.current.get(gid) ?? new Map(), callIdRef.current, Date.now()),
    )
    for (const peerPubkey of [...peersRef.current.keys()]) {
      if (!validPeers.has(peerPubkey)) removePeer(peerPubkey)
    }
  }, [removePeer])

  // Handles incoming group-call signals for the active call only (groupId +
  // callId must match); signals for other groups/calls are ignored.
  const handleGroupSignal = useCallback(async (senderPubkey: string, signal: CallSignal) => {
    if (signal.groupId !== activeGroupRef.current || signal.callId !== callIdRef.current) return

    if (signal.type === 'call-offer') {
      if (typeof signal.sdp !== 'string') return
      const me = useNostrStore.getState().publicKey ?? ''
      if (pendingOffersRef.current.has(senderPubkey) && myOfferWins(me, senderPubkey)) {
        // Glare: our offer wins the tie-break, they will answer ours instead.
        return
      }

      // Late joiner, or glare resolved in their favor: discard any pending
      // connection to them and answer their offer instead.
      peersRef.current.get(senderPubkey)?.close()
      peersRef.current.delete(senderPubkey)
      pendingOffersRef.current.delete(senderPubkey)

      const pc = createPeer(senderPubkey)
      const stream = localStreamRef.current
      stream?.getTracks().forEach(t => pc.addTrack(t, stream))

      await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp })
      await flushPendingCandidates(senderPubkey, pc)

      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)

      setPeerStates(prev => {
        const next = new Map(prev)
        next.set(senderPubkey, 'connecting')
        return next
      })

      await sendSignal(senderPubkey, {
        type: 'call-answer',
        callId: callIdRef.current,
        groupId: activeGroupRef.current ?? undefined,
        sdp: answer.sdp,
      })
      return
    }

    if (signal.type === 'call-answer') {
      const pc = peersRef.current.get(senderPubkey)
      if (!pc || typeof signal.sdp !== 'string') return
      await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp })
      await flushPendingCandidates(senderPubkey, pc)
      pendingOffersRef.current.delete(senderPubkey)
      return
    }

    if (signal.type === 'ice-candidate' && signal.candidate) {
      const pc = peersRef.current.get(senderPubkey)
      if (pc?.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {})
      } else {
        const bucket = pendingCandidatesRef.current.get(senderPubkey) ?? []
        bucket.push(signal.candidate)
        pendingCandidatesRef.current.set(senderPubkey, bucket)
      }
      return
    }

    if (signal.type === 'call-end') {
      removePeer(senderPubkey)
    }
  }, [createPeer, flushPendingCandidates, sendSignal, removePeer])

  // ── Group signal subscription: only while in an active group call ─────────
  useEffect(() => {
    if (groupCallState !== 'in-call' || !publicKey || !getSigner()) return
    const sub = subscribeEvents(
      readR,
      { kinds: [CALL_SIGNAL_KIND], '#p': [publicKey] } as Parameters<typeof subscribeEvents>[1],
      (event) => {
        if (isStaleCallSignal(event.created_at)) return
        void decryptCallSignal(event.pubkey, event.content).then(signal => {
          if (signal) void handleGroupSignal(event.pubkey, signal).catch(() => {})
        })
      },
    )
    return () => sub.close()
  }, [groupCallState, publicKey, readR, handleGroupSignal])

  // ── Presence subscriptions: watched group + active call group ─────────────
  const subscribedIds = [...new Set([watchedGroupId, activeGroupId].filter((x): x is string => !!x))]
  const subKey = subscribedIds.join(',')
  useEffect(() => {
    if (!publicKey || subscribedIds.length === 0) return
    const subs = subscribedIds.map(gid => {
      const key = useNostrStore.getState().groupKeys[gid]
      if (!key) return null
      return subscribeEvents(
        readR,
        { kinds: [GROUP_CALL_PRESENCE_KIND], '#h': [gid] },
        (event) => {
          void parsePresenceEvent(event, key).then(p => {
            if (!p) return
            const perGroup = heartbeatsRef.current.get(gid) ?? new Map<string, Heartbeat>()
            perGroup.set(event.pubkey, { callId: p.callId, mediaType: p.mediaType, receivedAt: Date.now() })
            heartbeatsRef.current.set(gid, perGroup)
            recomputeWatched()
          })
        },
      )
    })
    const tick = setInterval(() => { recomputeWatched(); sweepMeshRoster() }, ROSTER_TICK_MS)
    return () => {
      subs.forEach(s => s?.close())
      clearInterval(tick)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- subKey stands in for subscribedIds
  }, [publicKey, readR, subKey, recomputeWatched, sweepMeshRoster])

  // ── Own heartbeat while in a call ─────────────────────────────────────────
  const mediaTypeRef = useRef<MediaType>('audio')
  useEffect(() => { mediaTypeRef.current = mediaType }, [mediaType])

  const publishHeartbeat = useCallback(() => {
    const gid = activeGroupRef.current
    const key = gid ? useNostrStore.getState().groupKeys[gid] : undefined
    if (!gid || !key || !callIdRef.current || !getSigner()) return
    void (async () => {
      const me = useNostrStore.getState().publicKey
      const type = mediaTypeRef.current
      const callId = callIdRef.current
      const event = await buildPresenceEvent(gid, key, callId, type)
      void publishEvent(useNostrStore.getState().writeRelays(), event).catch(() => {})
      // Record our own heartbeat locally so our roster includes us immediately
      if (me) {
        const perGroup = heartbeatsRef.current.get(gid) ?? new Map<string, Heartbeat>()
        perGroup.set(me, { callId, mediaType: type, receivedAt: Date.now() })
        heartbeatsRef.current.set(gid, perGroup)
        recomputeWatched()
      }
    })()
  }, [recomputeWatched])

  // ── Cleanup ────────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    teardownMesh()
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    localStreamRef.current = null
    setLocalStream(null)
    setRemoteStreams(new Map())
    setPeerStates(new Map())
    setIsMuted(false)
    setIsCameraOff(false)
    setDuration(0)
    if (heartbeatTimer.current) { clearInterval(heartbeatTimer.current); heartbeatTimer.current = null }
    if (durationTimer.current) { clearInterval(durationTimer.current); durationTimer.current = null }
    // Drop our own heartbeat so the local roster reflects the leave at once
    const gid = activeGroupRef.current
    const me = useNostrStore.getState().publicKey
    if (gid && me) heartbeatsRef.current.get(gid)?.delete(me)
    callIdRef.current = ''
    activeGroupRef.current = null
    setActiveGroupId(null)
    setGroupCallState('idle')
    if (useNostrStore.getState().activeCallType === 'group') {
      useNostrStore.getState().setActiveCallType('none')
    }
    recomputeWatched()
  }, [teardownMesh, recomputeWatched])

  // ── Public actions ─────────────────────────────────────────────────────────
  const watchGroup = useCallback((groupId: string | null) => {
    setWatchedGroupId(groupId)
  }, [])

  const startOrJoin = useCallback(async (groupId: string, requested: MediaType) => {
    if (stateRef.current !== 'idle') return
    const store = useNostrStore.getState()
    if (store.activeCallType === 'dm') return
    if (!getSigner() || !store.publicKey || !store.groupKeys[groupId]) return

    const roster = deriveRoster(heartbeatsRef.current.get(groupId) ?? new Map(), Date.now())
    const state = deriveJoinState({
      participants: roster?.participants ?? [],
      myPubkey: store.publicKey,
      inCallLocally: false,
      busyWithDmCall: false,
    })
    if (state !== 'can-join') return

    const isStart = roster === null
    const callId = roster?.callId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const type = roster?.mediaType ?? requested

    // Flip to 'joining' synchronously, before the getUserMedia await, so a
    // second click during the permission prompt is blocked by the guard at
    // the top of this function instead of racing past it.
    stateRef.current = 'joining'
    setGroupCallState('joining')
    activeGroupRef.current = groupId
    setActiveGroupId(groupId)

    try {
      const stream = await getCallUserMedia(type)
      localStreamRef.current = stream
      setLocalStream(stream)
    } catch {
      // getUserMedia failed: abort before any heartbeat, and undo the
      // 'joining' flip so a retry is possible.
      stateRef.current = 'idle'
      setGroupCallState('idle')
      activeGroupRef.current = null
      setActiveGroupId(null)
      return
    }

    callIdRef.current = callId
    setMediaType(type)
    mediaTypeRef.current = type
    stateRef.current = 'in-call'
    setGroupCallState('in-call')
    store.setActiveCallType('group')

    publishHeartbeat()
    heartbeatTimer.current = setInterval(publishHeartbeat, PRESENCE_INTERVAL_MS)
    if (!durationTimer.current) durationTimer.current = setInterval(() => setDuration(d => d + 1), 1000)

    if (isStart) {
      void sendGroupCallStart(callId, groupId, store.groupKeys[groupId], store.writeRelays()).catch(() => {})
    }
    connectToPeers((roster?.participants ?? []).filter(p => p !== store.publicKey))
  }, [publishHeartbeat, connectToPeers])

  const leave = useCallback(() => {
    cleanup()
  }, [cleanup])

  const toggleMute = useCallback(() => {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !t.enabled })
    setIsMuted(m => !m)
  }, [])

  const toggleCamera = useCallback(() => {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !t.enabled })
    setIsCameraOff(v => !v)
  }, [])

  // Cleanup on unmount only. `cleanup` is recreated whenever its deps change
  // (e.g. watchGroup switching groups triggers recomputeWatched to change),
  // and a naive `useEffect(() => () => cleanup(), [cleanup])` would re-run
  // the *previous* closure's cleanup on every such change — tearing down a
  // live call or corrupting the banner. Keep the latest cleanup in a ref and
  // only ever run it on true unmount.
  const cleanupRef = useRef(cleanup)
  useEffect(() => { cleanupRef.current = cleanup }, [cleanup])
  useEffect(() => () => { cleanupRef.current() }, [])

  const activeCallType = useNostrStore(s => s.activeCallType)
  const myPubkey = publicKey ?? ''
  const joinState = deriveJoinState({
    participants: liveCall?.participants ?? [],
    myPubkey,
    inCallLocally: groupCallState !== 'idle' && activeGroupId === watchedGroupId,
    busyWithDmCall: activeCallType === 'dm',
  })

  return (
    <GroupCallContext.Provider value={{
      groupCallState, activeGroupId, callId: callIdRef.current || null, mediaType,
      liveCall, joinState,
      localStream, remoteStreams, peerStates,
      isMuted, isCameraOff, duration,
      watchGroup, startOrJoin, leave, toggleMute, toggleCamera,
    }}>
      {children}
    </GroupCallContext.Provider>
  )
}
