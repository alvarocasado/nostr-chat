import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from 'react'
import { subscribeEvents, publishEvent } from '../lib/nostr'
import { useNostrStore } from '../store/nostrStore'
import { useReadRelays } from '../hooks/useRelays'
import { getSigner } from '../lib/signer'
import { sendGroupCallStart } from '../hooks/useNostrSubscriptions'
import { getCallUserMedia, type MediaType } from '../lib/webrtc'
import {
  GROUP_CALL_PRESENCE_KIND, PRESENCE_INTERVAL_MS,
  buildPresenceEvent, parsePresenceEvent, deriveRoster, deriveJoinState,
  type Heartbeat, type LiveCall, type JoinState,
} from '../lib/groupCall'

export type GroupCallState = 'idle' | 'in-call'

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

  // ── Mesh hook points (wired in the next task) ─────────────────────────────
  const connectToPeers = useCallback((_pubkeys: string[]) => {
    // mesh wired in the next task
  }, [])
  const teardownMesh = useCallback(() => {
    // mesh wired in the next task
  }, [])

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
        { kinds: [GROUP_CALL_PRESENCE_KIND], '#e': [gid] },
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
    const tick = setInterval(recomputeWatched, ROSTER_TICK_MS)
    return () => {
      subs.forEach(s => s?.close())
      clearInterval(tick)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- subKey stands in for subscribedIds
  }, [publicKey, readR, subKey, recomputeWatched])

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

    try {
      const stream = await getCallUserMedia(type)
      localStreamRef.current = stream
      setLocalStream(stream)
    } catch {
      return // getUserMedia failed: abort before any heartbeat
    }

    callIdRef.current = callId
    activeGroupRef.current = groupId
    setActiveGroupId(groupId)
    setMediaType(type)
    mediaTypeRef.current = type
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

  // Cleanup on unmount
  useEffect(() => () => { cleanup() }, [cleanup])

  const activeCallType = useNostrStore(s => s.activeCallType)
  const myPubkey = publicKey ?? ''
  const joinState = deriveJoinState({
    participants: liveCall?.participants ?? [],
    myPubkey,
    inCallLocally: groupCallState === 'in-call' && activeGroupId === watchedGroupId,
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
