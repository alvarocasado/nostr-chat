import { describe, it, expect } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { LocalSigner } from '../lib/signer'

describe('LocalSigner nip44', () => {
  it('round-trips between two local signers', async () => {
    const skA = generateSecretKey()
    const skB = generateSecretKey()
    const a = new LocalSigner(skA)
    const b = new LocalSigner(skB)
    const ct = await a.nip44Encrypt(getPublicKey(skB), 'hello nip44')
    expect(await b.nip44Decrypt(a.pubkey, ct)).toBe('hello nip44')
  })

  it('round-trips to self (used by self-addressed gift wraps)', async () => {
    const sk = generateSecretKey()
    const s = new LocalSigner(sk)
    const ct = await s.nip44Encrypt(s.pubkey, 'note to self')
    expect(await s.nip44Decrypt(s.pubkey, ct)).toBe('note to self')
  })

  it('reports nip44 capability', () => {
    expect(new LocalSigner(generateSecretKey()).caps).toEqual({ nip04: true, nip44: true })
  })
})
