import { describe, it, expect, beforeEach } from 'vitest'
import { generateSecretKey } from 'nostr-tools'
import { openUserDb, closeUserDb } from '../lib/userDb'
import { saveLocalKey, loadLocalKey, hasLocalKey, keyProtection, clearLocalKey } from '../lib/keyStore'

const PK = 'a'.repeat(64)

function eq(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

describe('keyStore device mode', () => {
  beforeEach(() => { openUserDb(PK) })

  it('round-trips a secret under the device key', async () => {
    const sk = generateSecretKey()
    await saveLocalKey(sk)
    expect(await hasLocalKey()).toBe(true)
    expect(await keyProtection()).toBe('device')
    const loaded = await loadLocalKey()
    expect(loaded && eq(loaded, sk)).toBe(true)
  })

  it('reports none when empty and clears', async () => {
    await clearLocalKey()
    expect(await hasLocalKey()).toBe(false)
    expect(await keyProtection()).toBe('none')
    expect(await loadLocalKey()).toBeNull()
    closeUserDb()
  })
})
