import { useCallback, useEffect, useRef, useState } from 'react'
import { useNostrStore } from '../store/nostrStore'
import { pageOlderFromDexie, olderFilterFor } from '../lib/history'
import { OLDER_PAGE } from '../lib/pagination'
import { fetchEvents } from '../lib/nostr'
import { processChannelEvent, processDMEvent, processGroupEvent } from '../lib/inbox'

export function useChatHistory(
  chatId: string,
  chatType: 'dm' | 'channel' | 'group',
  myPubkey: string,
) {
  const [loading, setLoading] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const loadingRef = useRef(false)
  const exhaustedRef = useRef(false)

  useEffect(() => {
    setLoading(false)
    setExhausted(false)
    loadingRef.current = false
    exhaustedRef.current = false
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
      const relays = useNostrStore.getState().relays
      const filters = olderFilterFor(chatType, chatId, myPubkey, oldest, OLDER_PAGE)
      const events = (await Promise.all(filters.map(f => fetchEvents(relays, f)))).flat()
      if (events.length === 0) {
        exhaustedRef.current = true
        setExhausted(true)
        return 0
      }
      const before = (useNostrStore.getState().messages[chatId] || []).length
      for (const ev of events) {
        if (chatType === 'channel') await processChannelEvent(ev, chatId, relays, { live: false })
        else if (chatType === 'group') {
          const key = useNostrStore.getState().groupKeys[chatId]
          if (key) await processGroupEvent(ev, chatId, key, relays, { live: false })
        } else await processDMEvent(ev, myPubkey, relays, { live: false })
      }
      const after = (useNostrStore.getState().messages[chatId] || []).length
      const added = after - before
      if (added === 0) {
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
