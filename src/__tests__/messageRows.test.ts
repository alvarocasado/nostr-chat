import { describe, it, expect } from 'vitest'
import { decorateRow, sameDay } from '../lib/messageRows'
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
    expect(decorateRow(msg({ createdAt: DAY1_NOON }), undefined, undefined, ME).showDateSeparator).toBe(true)
    expect(decorateRow(msg({ createdAt: DAY2 }), msg({ createdAt: DAY1_LATER }), undefined, ME).showDateSeparator).toBe(true)
    expect(decorateRow(msg({ createdAt: DAY1_LATER }), msg({ createdAt: DAY1_NOON }), undefined, ME).showDateSeparator).toBe(false)
  })

  it('shows the divider only on the first message strictly newer than dividerTimestamp', () => {
    const prev = msg({ createdAt: 1000 })
    const cur = msg({ createdAt: 2000 })
    expect(decorateRow(cur, prev, 1500, ME).showDivider).toBe(true)
    // previous already past the divider -> not the boundary
    expect(decorateRow(msg({ createdAt: 3000 }), msg({ createdAt: 2000 }), 1500, ME).showDivider).toBe(false)
    // no divider timestamp
    expect(decorateRow(cur, prev, undefined, ME).showDivider).toBe(false)
  })

  it('hides the avatar for own messages and consecutive same-sender, shows it after a date change', () => {
    expect(decorateRow(msg({ pubkey: ME }), undefined, undefined, ME).showAvatar).toBe(false)
    expect(decorateRow(msg({ pubkey: THEM, createdAt: DAY1_LATER }), msg({ pubkey: THEM, createdAt: DAY1_NOON }), undefined, ME).showAvatar).toBe(false)
    expect(decorateRow(msg({ pubkey: THEM, createdAt: DAY2 }), msg({ pubkey: THEM, createdAt: DAY1_LATER }), undefined, ME).showAvatar).toBe(true)
  })
})
