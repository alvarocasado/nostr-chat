import { useEffect, useRef } from 'react'
import { subscribeEvents, publishEvent } from '../lib/nostr'
import {
  READ_RECEIPT_KIND,
  buildReadReceiptEvent,
  parseReadReceiptEvent,
  shouldSendReceipt,
} from '../lib/readReceipts'
import { useNostrStore } from '../store/nostrStore'
import { useReadRelays } from './useRelays'
import { getSigner } from '../lib/signer'

const THROTTLE_MS = 10_000  // at most one receipt per 10 s per peer

/**
 * Read receipts for an open DM thread (opt-in, reciprocal; DMs only).
 *
 * Send side: publishes an encrypted ephemeral "read up to X" watermark when
 * the thread is mounted, the tab is visible, and the newest received message
 * is newer than the last watermark sent.
 *
 * Receive side: subscribes to the peer's watermarks and stores the max per
 * peer via setPeerReadUntil. Skipped entirely when the setting is off.
 *
 * `active=false` suppresses sending (e.g. pending message requests).
 */
export function useReadReceipts(peerPubkey: string, active = true) {
  const publicKey = useNostrStore(s => s.publicKey)
  const enabled = useNostrStore(s => s.readReceiptsEnabled)
  const setPeerReadUntil = useNostrStore(s => s.setPeerReadUntil)
  const newestReceivedAt = useNostrStore(s => {
    const msgs = s.messages[peerPubkey]
    if (!msgs) return undefined
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].pubkey === peerPubkey) return msgs[i].createdAt
    }
    return undefined
  })
  const readR = useReadRelays()
  const lastSentWatermark = useRef(0)
  const lastSentAt = useRef(0)

  // Receive side: peer watermarks -> store. Reciprocity: ignored when off.
  useEffect(() => {
    if (!publicKey || !enabled) return
    const sub = subscribeEvents(
      readR,
      { kinds: [READ_RECEIPT_KIND], authors: [peerPubkey], '#p': [publicKey] },
      (event) => {
        void parseReadReceiptEvent(event).then(readUntil => {
          if (readUntil !== null) setPeerReadUntil(peerPubkey, readUntil)
        })
      },
    )
    return () => sub.close()
  }, [publicKey, peerPubkey, enabled, readR, setPeerReadUntil])

  // Send side: watermark when visible and new peer messages arrived.
  useEffect(() => {
    if (!active || !publicKey || !getSigner()) return

    let timer: ReturnType<typeof setTimeout> | undefined
    const maybeSend = () => {
      const visible = document.visibilityState === 'visible'
      if (!shouldSendReceipt({ enabled, visible, newestReceivedAt, lastSent: lastSentWatermark.current })) return
      const wait = THROTTLE_MS - (Date.now() - lastSentAt.current)
      if (wait > 0) {
        clearTimeout(timer)
        timer = setTimeout(maybeSend, wait)
        return
      }
      const watermark = newestReceivedAt as number
      lastSentWatermark.current = watermark
      lastSentAt.current = Date.now()
      void (async () => {
        const event = await buildReadReceiptEvent(peerPubkey, watermark)
        void publishEvent(useNostrStore.getState().writeRelays(), event)
      })()
    }

    maybeSend()
    document.addEventListener('visibilitychange', maybeSend)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', maybeSend)
    }
  }, [active, publicKey, enabled, peerPubkey, newestReceivedAt])
}
