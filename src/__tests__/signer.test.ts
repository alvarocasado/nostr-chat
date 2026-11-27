import { describe, it, expect, beforeEach, vi } from 'vitest'
import { generateSecretKey, getPublicKey, nip04 } from 'nostr-tools'
import { LocalSigner, getSigner, setSigner, clearSigner, requireSigner } from '../lib/signer'

describe('LocalSigner', () => {
  beforeEach(() => clearSigner())

  it('derives pubkey and signs events', async () => {
    const sk = generateSecretKey()
    const signer = new LocalSigner(sk)
    expect(signer.pubkey).toBe(getPublicKey(sk))
    expect(signer.type).toBe('local')
    expect(signer.caps.nip04).toBe(true)
    const event = await signer.signEvent({ kind: 1, created_at: 0, tags: [], content: 'hi' })
    expect(event.pubkey).toBe(signer.pubkey)
    expect(event.sig).toMatch(/^[0-9a-f]{128}$/)
  })

  it('round-trips nip04 with the recipient key', async () => {
    const a = new LocalSigner(generateSecretKey())
    const bSk = generateSecretKey()
    const ct = await a.nip04Encrypt(getPublicKey(bSk), 'secret')
    const pt = await nip04.decrypt(bSk, a.pubkey, ct)
    expect(pt).toBe('secret')
  })

  it('singleton set/get/require/clear', () => {
    expect(getSigner()).toBeNull()
    expect(() => requireSigner()).toThrow()
    const s = new LocalSigner(generateSecretKey())
    setSigner(s)
    expect(getSigner()).toBe(s)
    expect(requireSigner()).toBe(s)
    clearSigner()
    expect(getSigner()).toBeNull()
  })
})

describe('Nip46Signer', () => {
  it('delegates signing and encryption to the bunker', async () => {
    const { Nip46Signer } = await import('../lib/signer')
    const bunker = {
      signEvent: vi.fn(async (t: unknown) => ({ ...(t as object), sig: 'x' })),
      nip04Encrypt: vi.fn(async () => 'n04'),
      nip04Decrypt: vi.fn(async () => 'p04'),
      nip44Encrypt: vi.fn(async () => 'n44'),
      nip44Decrypt: vi.fn(async () => 'p44'),
      close: vi.fn(async () => {}),
    }
    const s = new Nip46Signer(bunker as never, 'c'.repeat(64))
    expect(s.type).toBe('nip46')
    expect(s.caps).toEqual({ nip04: true, nip44: true })
    await s.signEvent({ kind: 1, created_at: 0, tags: [], content: '' })
    expect(bunker.signEvent).toHaveBeenCalled()
    expect(await s.nip44Encrypt('d'.repeat(64), 'hi')).toBe('n44')
    expect(await s.nip04Decrypt('d'.repeat(64), 'x')).toBe('p04')
  })
})
