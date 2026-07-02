import { describe, it, expect } from 'vitest'
import {
  serializeReaction,
  parseReactionPayload,
  aggregateReactions,
} from '../lib/reactions'

describe('reaction payloads', () => {
  it('round-trips an add', () => {
    const s = serializeReaction('evt1', '👍', 'add')
    expect(parseReactionPayload(s)).toEqual({ type: 'reaction', target: 'evt1', emoji: '👍', op: 'add' })
  })

  it('round-trips a remove', () => {
    expect(parseReactionPayload(serializeReaction('evt1', '❤️', 'remove'))?.op).toBe('remove')
  })

  it('rejects non-JSON', () => {
    expect(parseReactionPayload('hello world')).toBeNull()
  })

  it('rejects a normal JSON message', () => {
    expect(parseReactionPayload('{"type":"file_start","transferId":"x"}')).toBeNull()
  })

  it('rejects an oversized emoji field', () => {
    const bad = JSON.stringify({ type: 'reaction', target: 'e', emoji: 'x'.repeat(100), op: 'add' })
    expect(parseReactionPayload(bad)).toBeNull()
  })

  it('rejects a bad op', () => {
    const bad = JSON.stringify({ type: 'reaction', target: 'e', emoji: '👍', op: 'toggle' })
    expect(parseReactionPayload(bad)).toBeNull()
  })
})

describe('aggregateReactions', () => {
  it('returns empty for no reactions', () => {
    expect(aggregateReactions(undefined, 'me')).toEqual([])
    expect(aggregateReactions({}, 'me')).toEqual([])
  })

  it('counts reactors and flags mine', () => {
    const agg = aggregateReactions({ '👍': ['me', 'you'], '🔥': ['you'] }, 'me')
    expect(agg).toEqual([
      { emoji: '👍', count: 2, mine: true },
      { emoji: '🔥', count: 1, mine: false },
    ])
  })

  it('drops emojis with no reactors', () => {
    expect(aggregateReactions({ '👍': [] }, 'me')).toEqual([])
  })

  it('orders by the curated emoji order', () => {
    const agg = aggregateReactions({ '🔥': ['a'], '👍': ['b'] }, 'me')
    expect(agg.map(a => a.emoji)).toEqual(['👍', '🔥'])
  })
})
