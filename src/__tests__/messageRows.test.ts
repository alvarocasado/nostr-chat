import { describe, it, expect } from 'vitest'
import { decorateRow, sameDay, unreadAnchorId } from '../lib/messageRows'
import type { Message } from '../store/nostrStore'

const ME = 'me'.padEnd(64, '0')
const THEM = 'them'.padEnd(64, '1')

function msg(over: Partial<Message>): Message {
  return { id: 'x', pubkey: THEM, content: 'hi', createdAt: 1000, tags: [], kind: 42, ...over }
}

// 2024-01-01 12:00:00Z and same-day later; next day
const DAY1_NOON = Math.floor(Date.parse('2024-01-01T12:00:00Z') / 1000)
const DAY1_LATER = Math.floor(Date.parse('2024-01-01T18:00:00Z') / 1000)
const DAY2 = Math.floor(Date.parse('2024-01-02T09:00:00Z') / 1000)

describe('sameDay', () => {
  it('is true within a day and false across days', () => {
    expect(sameDay(DAY1_NOON, DAY1_LATER)).toBe(true)
    expect(sameDay(DAY1_NOON, DAY2)).toBe(false)
  })
})

describe('decorateRow', () => {
  it('shows a date separator for the first message and on day change', () => {
    expect(decorateRow(msg({ createdAt: DAY1_NOON }), undefined, ME).showDateSeparator).toBe(true)
    expect(decorateRow(msg({ createdAt: DAY2 }), msg({ createdAt: DAY1_LATER }), ME).showDateSeparator).toBe(true)
    expect(decorateRow(msg({ createdAt: DAY1_LATER }), msg({ createdAt: DAY1_NOON }), ME).showDateSeparator).toBe(false)
  })

  it('hides the avatar for own messages and consecutive same-sender, shows it after a date change', () => {
    expect(decorateRow(msg({ pubkey: ME }), undefined, ME).showAvatar).toBe(false)
    expect(decorateRow(msg({ pubkey: THEM, createdAt: DAY1_LATER }), msg({ pubkey: THEM, createdAt: DAY1_NOON }), ME).showAvatar).toBe(false)
    expect(decorateRow(msg({ pubkey: THEM, createdAt: DAY2 }), msg({ pubkey: THEM, createdAt: DAY1_LATER }), ME).showAvatar).toBe(true)
  })
})

describe('unreadAnchorId', () => {
  it('anchors on the first received message past the timestamp, skipping my own', () => {
    const messages = [
      msg({ id: 'a', pubkey: ME, createdAt: 1000 }),
      msg({ id: 'b', pubkey: ME, createdAt: 2000 }),
      msg({ id: 'c', pubkey: THEM, createdAt: 3000 }),
    ]
    expect(unreadAnchorId(messages, 500, ME)).toBe('c')
  })

  it('is undefined when the only new messages are my own', () => {
    const messages = [msg({ id: 'a', pubkey: ME, createdAt: 2000 })]
    expect(unreadAnchorId(messages, 500, ME)).toBeUndefined()
  })

  it('is undefined without a divider timestamp', () => {
    const messages = [msg({ id: 'a', pubkey: THEM, createdAt: 2000 })]
    expect(unreadAnchorId(messages, undefined, ME)).toBeUndefined()
  })
})
