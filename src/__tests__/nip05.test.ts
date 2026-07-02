import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isNip05Address, resolveNip05, verifyNip05 } from '../lib/nip05'

const PK = 'a'.repeat(64)

describe('isNip05Address', () => {
  it('accepts name@domain', () => {
    expect(isNip05Address('alice@example.com')).toBe(true)
  })
  it('rejects a bare npub', () => {
    expect(isNip05Address('npub1abc')).toBe(false)
  })
  it('rejects hex', () => {
    expect(isNip05Address(PK)).toBe(false)
  })
})

describe('resolveNip05 / verifyNip05', () => {
  beforeEach(() => {
    // Each test uses a unique address so the module-level cache does not bleed.
    vi.restoreAllMocks()
  })
  afterEach(() => vi.restoreAllMocks())

  it('resolves a matching name to its pubkey', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ names: { alice: PK } }),
    }))
    expect(await resolveNip05('alice@a.example.com')).toBe(PK)
  })

  it('verifies a matching identifier', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ names: { bob: PK } }),
    }))
    expect(await verifyNip05(PK, 'bob@b.example.com')).toBe(true)
  })

  it('fails verification on pubkey mismatch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ names: { carol: 'b'.repeat(64) } }),
    }))
    expect(await verifyNip05(PK, 'carol@c.example.com')).toBe(false)
  })

  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await resolveNip05('dave@d.example.com')).toBeNull()
  })

  it('returns null for a malformed address without fetching', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await resolveNip05('not-an-address')).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})
