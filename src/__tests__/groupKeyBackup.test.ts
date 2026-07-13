import { describe, it, expect } from 'vitest'
import { parseKeyBackup } from '../lib/nostrSync'

const K1 = '1'.repeat(64)
const K2 = '2'.repeat(64)

describe('parseKeyBackup', () => {
  it('accepts the legacy bare-hex format as a single-key list', () => {
    expect(parseKeyBackup(K1)).toEqual([K1])
    expect(parseKeyBackup(`  ${K1}  `)).toEqual([K1])
  })

  it('accepts the JSON multi-key format', () => {
    expect(parseKeyBackup(JSON.stringify({ keys: [K1, K2] }))).toEqual([K1, K2])
  })

  it('rejects garbage, empty lists, and non-hex entries', () => {
    expect(parseKeyBackup('not a key')).toBeNull()
    expect(parseKeyBackup(JSON.stringify({ keys: [] }))).toBeNull()
    expect(parseKeyBackup(JSON.stringify({ keys: [K1, 'bad'] }))).toBeNull()
    expect(parseKeyBackup(JSON.stringify({ nope: true }))).toBeNull()
  })
})
