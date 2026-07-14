import { useCallback, useEffect, useRef, useState } from 'react'
import { useNostrStore } from '../store/nostrStore'
import { pageOlderFromDexie, olderFilterFor } from '../lib/history'
import { OLDER_PAGE } from '../lib/pagination'
import { fetchEvents } from '../lib/nostr'
import { processChannelEvent, processDMEvent, processGiftWrap, processGroupEvent } from '../lib/inbox'
import { getPeerRelays, combineRelays } from '../lib/peerRelays'

export function useChatHistory(
  chatId: string,
  chatType: 'dm' | 'channel' | 'group',
  myPubkey: string,
) {
  const [loading, setLoading] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const loadingRef = useRef(false)
  const exhaustedRef = useRef(false)
  const wrapUntilRef = useRef<number | null>(null)

  useEffect(() => {
    setLoading(false)
    setExhausted(false)
    loadingRef.current = false
    exhaustedRef.current = false
    wrapUntilRef.current = null
  }, [chatId])

  const loadOlder = useCallback(async (): Promise<number> => {
    if (loadingRef.current || exhaustedRef.current) return 0
    loadingRef.current = true
    setLoading(true)
    try {
      const msgs = useNostrStore.getState().messages[chatId] || []
      const oldest = msgs[0]?.createdAt
      if (oldest === undefined) return 0

      const dexiePage = await pageOlderFromDexie(chatId, oldest, OLDER_PAGE)

      if (dexiePage.length > 0) {
        const before = (useNostrStore.getState().messages[chatId] || []).length
        useNostrStore.getState().prependMessages(chatId, dexiePage)
        const after = (useNostrStore.getState().messages[chatId] || []).length
        return after - before
      }

      // No local history older than the window: backfill from relays.
      const relays = useNostrStore.getState().readRelays()
      const filters = olderFilterFor(chatType, chatId, myPubkey, oldest, OLDER_PAGE, wrapUntilRef.current ?? undefined)
      let events
      let wrapEvents: { id: string; kind: number; created_at: number }[] = []
      if (chatType === 'dm') {
        // olderFilterFor('dm', ...) returns [sent (authors:[me]), received (authors:[peer]), wraps (kind 1059)]
        const [sentFilter, receivedFilter, wrapFilter] = filters
        const peer = await getPeerRelays(chatId, relays)
        const receivedRelays = combineRelays(relays, peer.write)
        const [sentEvents, receivedEvents, wrapResults] = await Promise.all([
          fetchEvents(relays, sentFilter),
          fetchEvents(receivedRelays, receivedFilter),
          fetchEvents(receivedRelays, wrapFilter),
        ])
        wrapEvents = wrapResults
        events = [...sentEvents, ...receivedEvents, ...wrapEvents]
      } else {
        events = (await Promise.all(filters.map(f => fetchEvents(relays, f)))).flat()
      }
      if (wrapEvents.length > 0) {
        // Monotonic progress through wrap space, independent of the rumor-time
        // cursor, so a dup-dominated page doesn't refetch the same window.
        wrapUntilRef.current = Math.min(...wrapEvents.map(ev => ev.created_at)) - 1
      }
      if (events.length === 0) {
        exhaustedRef.current = true
        setExhausted(true)
        return 0
      }
      const before = (useNostrStore.getState().messages[chatId] || []).length
      for (const ev of events) {
        if (chatType === 'channel') await processChannelEvent(ev, chatId, relays, { live: false })
        else if (chatType === 'group') {
          const keys = useNostrStore.getState().allGroupKeys(chatId)
          if (keys.length > 0) await processGroupEvent(ev, chatId, keys, relays, { live: false })
        } else if (ev.kind === 1059) await processGiftWrap(ev, myPubkey, relays, { live: false })
        else await processDMEvent(ev, myPubkey, relays, { live: false })
      }
      const after = (useNostrStore.getState().messages[chatId] || []).length
      const added = after - before
      if (added === 0 && wrapEvents.length < OLDER_PAGE) {
        exhaustedRef.current = true
        setExhausted(true)
      }
      return added
    } catch {
      return 0 // never exhaust on error
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [chatId, chatType, myPubkey])

  return { loadOlder, loading, exhausted }
}
