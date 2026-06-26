import { useCallback, useEffect, useRef, useState } from 'react'
import { subscribeEvents, publishEvent, buildTypingEvent, TYPING_INDICATOR_KIND } from '../lib/nostr'
import { useNostrStore } from '../store/nostrStore'
import { useReadRelays } from './useRelays'
import { getSigner } from '../lib/signer'

const THROTTLE_MS   = 3_000  // send at most one typing event per 3 s
const EXPIRY_MS     = 5_000  // remove typist label after 5 s of silence

/**
 * Provides live typing indicators for a DM or channel.
 *
 * Returns:
 *  - typists   : pubkeys of other users currently typing
 *  - notifyTyping : call this whenever the local user types (auto-throttled)
 */
export function useTypingIndicator(
  chatType: 'dm' | 'channel',
  chatId: string,          // recipientPubkey (DM) or channelId (channel)
  theirPubkey?: string,    // only used for DM subscription filter
) {
  const publicKey = useNostrStore(s => s.publicKey)
  const readR = useReadRelays()
  const [typists, setTypists] = useState<string[]>([])
  const timers    = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const lastSent  = useRef(0)

  // ── receive side ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!publicKey) return

    const filter =
      chatType === 'dm' && theirPubkey
        ? { kinds: [TYPING_INDICATOR_KIND], authors: [theirPubkey], '#p': [publicKey] }
        : { kinds: [TYPING_INDICATOR_KIND], '#e': [chatId] }

    const timersMap = timers.current
    const sub = subscribeEvents(readR, filter as Parameters<typeof subscribeEvents>[1], (event) => {
      if (event.pubkey === publicKey) return  // ignore own echoes

      const pk = event.pubkey
      const existing = timersMap.get(pk)
      if (existing) clearTimeout(existing)

      setTypists(prev => prev.includes(pk) ? prev : [...prev, pk])

      const t = setTimeout(() => {
        timersMap.delete(pk)
        setTypists(prev => prev.filter(p => p !== pk))
      }, EXPIRY_MS)
      timersMap.set(pk, t)
    })

    return () => {
      sub.close()
      timersMap.forEach(clearTimeout)
      timersMap.clear()
      setTypists([])
    }
  }, [chatType, chatId, theirPubkey, publicKey, readR])

  // ── send side (throttled) ────────────────────────────────────────────────
  const notifyTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastSent.current < THROTTLE_MS) return
    lastSent.current = now
    if (!getSigner() || !publicKey) return
    void (async () => {
      const event = await buildTypingEvent(chatType, chatId)
      void publishEvent(useNostrStore.getState().writeRelays(), event)
    })()
  }, [chatType, chatId, publicKey])

  return { typists, notifyTyping }
}
