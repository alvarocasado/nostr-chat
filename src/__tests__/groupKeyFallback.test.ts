import { describe, it, expect } from 'vitest'
import {
  generateGroupKey, encryptWithGroupKey, decryptWithGroupKeys,
} from '../lib/groupCrypto'

describe('decryptWithGroupKeys', () => {
  it('decrypts with the current (first) key', async () => {
    const key = generateGroupKey()
    const ct = await encryptWithGroupKey('hello', key)
    expect(await decryptWithGroupKeys(ct, [key])).toBe('hello')
  })

  it('falls back to an older key when the current one fails', async () => {
    const oldKey = generateGroupKey()
    const newKey = generateGroupKey()
    const ct = await encryptWithGroupKey('old epoch msg', oldKey)
    expect(await decryptWithGroupKeys(ct, [newKey, oldKey])).toBe('old epoch msg')
  })

  it('throws when no key decrypts', async () => {
    const ct = await encryptWithGroupKey('secret', generateGroupKey())
    await expect(decryptWithGroupKeys(ct, [generateGroupKey()])).rejects.toThrow()
  })

  it('throws on an empty key list', async () => {
    const ct = await encryptWithGroupKey('secret', generateGroupKey())
    await expect(decryptWithGroupKeys(ct, [])).rejects.toThrow()
  })
})
