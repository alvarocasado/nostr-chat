import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Event } from 'nostr-tools'
import { useNostrStore } from '../store/nostrStore'
import { serializeFileStart, serializeFileChunk } from '../lib/fileTransfer'

vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return { ...actual, fetchEvent: vi.fn().mockResolvedValue(null) }
})

import { processChannelEvent, resetInboxDedup } from '../lib/inbox'

const ME = 'f'.repeat(64)
const ALICE = 'a'.repeat(64)
const MALLORY = 'd'.repeat(64)
const CHANNEL = 'c'.repeat(64)
let n = 0
function ev(from: string, content: string): Event {
  return { id: String(++n).padEnd(64, '0'), pubkey: from, created_at: Math.floor(Date.now() / 1000), kind: 42, tags: [], content, sig: '' } as Event
}
const start = (id: string) => serializeFileStart({ transferId: id, name: 'photo.png', mime: 'image/png', size: 4, totalChunks: 1 })
const chunk = (id: string, data: string) => serializeFileChunk({ transferId: id, index: 0, total: 1, data })

beforeEach(() => {
  resetInboxDedup()
  useNostrStore.setState({ publicKey: ME, messages: {}, contacts: [], profiles: {}, channels: [], seenAt: {} })
})

describe('chunked file transfers', () => {
  it('rebuilds a file from its sender\'s chunks', async () => {
    await processChannelEvent(ev(ALICE, start('t1')), CHANNEL, ['wss://r'], { live: true })
    await processChannelEvent(ev(ALICE, chunk('t1', 'QUxJQ0U=')), CHANNEL, ['wss://r'], { live: true })
    const msgs = useNostrStore.getState().messages[CHANNEL]
    expect(msgs).toHaveLength(1)
    expect(msgs[0].pubkey).toBe(ALICE)
    expect(msgs[0].id).toBe('transfer-t1')
    expect(msgs[0].content).toContain('QUxJQ0U=')
  })

  it('ignores chunks another user posts under the same transfer id', async () => {
    await processChannelEvent(ev(ALICE, start('t2')), CHANNEL, ['wss://r'], { live: true })
    await processChannelEvent(ev(MALLORY, chunk('t2', 'TUFMTE9SWQ==')), CHANNEL, ['wss://r'], { live: true })
    expect(useNostrStore.getState().messages[CHANNEL] ?? []).toHaveLength(0)

    await processChannelEvent(ev(ALICE, chunk('t2', 'QUxJQ0U=')), CHANNEL, ['wss://r'], { live: true })
    const msgs = useNostrStore.getState().messages[CHANNEL]
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toContain('QUxJQ0U=')
    expect(msgs[0].content).not.toContain('TUFMTE9SWQ==')
  })
})
