import { useCallback, useEffect, useRef, useState } from 'react'
import { useNostrStore } from '../store/nostrStore'
import { pageOlderFromDexie } from '../lib/history'
import { OLDER_PAGE } from '../lib/pagination'

export function useChatHistory(
  chatId: string,
  _chatType: 'dm' | 'channel' | 'group',
  _myPubkey: string,
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
      if (dexiePage.length === 0) {
        exhaustedRef.current = true
        setExhausted(true)
        return 0
      }
      const before = (useNostrStore.getState().messages[chatId] || []).length
      useNostrStore.getState().prependMessages(chatId, dexiePage)
      const after = (useNostrStore.getState().messages[chatId] || []).length
      return after - before
    } catch {
      return 0 // never exhaust on error
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [chatId])

  return { loadOlder, loading, exhausted }
}
