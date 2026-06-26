import { describe, it, expect } from 'vitest'
import { generateFileKey, encryptBlob, decryptBlob, exportKeyB64, ivToB64 } from '../lib/fileCrypto'

const enc = new TextEncoder()
const dec = new TextDecoder()

describe('fileCrypto', () => {
  it('round-trips: encrypt then decrypt returns the original bytes', async () => {
    const plain = enc.encode('hello blossom').buffer
    const { key, iv } = await generateFileKey()
    const cipher = await encryptBlob(plain, key, iv)
    expect(new Uint8Array(cipher)).not.toEqual(new Uint8Array(plain)) // actually encrypted
    const out = await decryptBlob(cipher, await exportKeyB64(key), ivToB64(iv))
    expect(dec.decode(out)).toBe('hello blossom')
  })

  it('fails to decrypt with the wrong key', async () => {
    const plain = enc.encode('secret').buffer
    const a = await generateFileKey()
    const b = await generateFileKey()
    const cipher = await encryptBlob(plain, a.key, a.iv)
    await expect(decryptBlob(cipher, await exportKeyB64(b.key), ivToB64(a.iv))).rejects.toBeDefined()
  })

  it('fails to decrypt tampered ciphertext (GCM auth)', async () => {
    const plain = enc.encode('integrity').buffer
    const { key, iv } = await generateFileKey()
    const cipher = await encryptBlob(plain, key, iv)
    const tampered = new Uint8Array(cipher)
    tampered[0] ^= 0xff
    await expect(decryptBlob(tampered.buffer, await exportKeyB64(key), ivToB64(iv))).rejects.toBeDefined()
  })
})
