import { describe, it, expect } from 'vitest'
import { generateGroupKey, encryptWithGroupKey, decryptWithGroupKey } from '../lib/groupCrypto'

describe('generateGroupKey', () => {
  it('returns a 64-char lowercase hex string', () => {
    expect(generateGroupKey()).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates unique keys each call', () => {
    expect(generateGroupKey()).not.toBe(generateGroupKey())
  })
})

describe('encryptWithGroupKey / decryptWithGroupKey', () => {
  it('roundtrips plaintext', async () => {
    const key = generateGroupKey()
    const cipher = await encryptWithGroupKey('Hello, group!', key)
    expect(cipher).not.toBe('Hello, group!')
    expect(await decryptWithGroupKey(cipher, key)).toBe('Hello, group!')
  })

  it('produces different ciphertext for same input due to random IV', async () => {
    const key = generateGroupKey()
    const c1 = await encryptWithGroupKey('same', key)
    const c2 = await encryptWithGroupKey('same', key)
    expect(c1).not.toBe(c2)
  })

  it('throws when decrypting with the wrong key', async () => {
    const k1 = generateGroupKey()
    const k2 = generateGroupKey()
    const cipher = await encryptWithGroupKey('secret', k1)
    await expect(decryptWithGroupKey(cipher, k2)).rejects.toThrow()
  })
})
