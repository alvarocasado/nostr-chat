import { describe, it, expect } from 'vitest'
import { filterRead, filterWrite } from '../lib/relayRouting'

const R = ['wss://a', 'wss://b', 'wss://c']

describe('filterRead / filterWrite', () => {
  it('returns all relays when no modes are set (default both)', () => {
    expect(filterRead(R, {})).toEqual(R)
    expect(filterWrite(R, {})).toEqual(R)
  })

  it('filters by marker', () => {
    const modes = {
      'wss://a': { read: true, write: false },
      'wss://b': { read: false, write: true },
      'wss://c': { read: true, write: true },
    }
    expect(filterRead(R, modes)).toEqual(['wss://a', 'wss://c'])
    expect(filterWrite(R, modes)).toEqual(['wss://b', 'wss://c'])
  })

  it('treats a relay missing from modes as read+write', () => {
    const modes = { 'wss://a': { read: false, write: false } }
    expect(filterRead(R, modes)).toEqual(['wss://b', 'wss://c'])
    expect(filterWrite(R, modes)).toEqual(['wss://b', 'wss://c'])
  })

  it('falls back to the full list when a side is empty', () => {
    const modes = {
      'wss://a': { read: false, write: true },
      'wss://b': { read: false, write: true },
      'wss://c': { read: false, write: true },
    }
    expect(filterRead(R, modes)).toEqual(R)   // no read relays -> fall back to all
    expect(filterWrite(R, modes)).toEqual(R)  // all write -> unchanged
  })
})
