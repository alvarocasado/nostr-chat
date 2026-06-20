import { describe, it, expect, beforeEach } from 'vitest'
import { generateSecretKey } from 'nostr-tools'
import { openUserDb, closeUserDb } from '../lib/userDb'
import { saveLocalKey, loadLocalKey, hasLocalKey, keyProtection, clearLocalKey, setPassphrase } from '../lib/keyStore'
import { migratePlaintextKeyIfNeeded } from '../lib/migrate'

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

describe('keyStore passphrase mode', () => {
  beforeEach(() => { openUserDb(PK) })

  it('round-trips under a passphrase and rejects the wrong one', async () => {
    const sk = generateSecretKey()
    await saveLocalKey(sk, { passphrase: 'hunter2' })
    expect(await keyProtection()).toBe('passphrase')
    const ok = await loadLocalKey({ passphrase: 'hunter2' })
    expect(ok && eq(ok, sk)).toBe(true)
    expect(await loadLocalKey({ passphrase: 'wrong' })).toBeNull()
  })

  it('setPassphrase(null) reverts to device mode', async () => {
    const sk = generateSecretKey()
    await saveLocalKey(sk, { passphrase: 'hunter2' })
    await setPassphrase(sk, null)
    expect(await keyProtection()).toBe('device')
    const ok = await loadLocalKey()
    expect(ok && eq(ok, sk)).toBe(true)
  })
})

describe('migratePlaintextKeyIfNeeded', () => {
  beforeEach(async () => {
    openUserDb(PK)
    await clearLocalKey()
    // Remove any leftover Zustand blob from previous test runs
    const { getUserDb } = await import('../lib/userDb')
    const db = getUserDb()!
    await db.settings.delete('nostr-chat-storage')
  })

  it('migrates a plaintext privateKeyHex into the key store', async () => {
    const { getUserDb } = await import('../lib/userDb')
    const db = getUserDb()!
    const hex = 'b'.repeat(64)
    await db.settings.put({ key: 'nostr-chat-storage', value: JSON.stringify({ state: { privateKeyHex: hex, publicKey: PK } }) })
    await migratePlaintextKeyIfNeeded(PK)
    expect(await hasLocalKey()).toBe(true)
    const blob = JSON.parse((await db.settings.get('nostr-chat-storage'))!.value)
    expect(blob.state.privateKeyHex).toBeUndefined()
    const expected = Uint8Array.from(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
    const loaded = await loadLocalKey()
    expect(loaded && eq(loaded, expected)).toBe(true)
  })

  it('is a no-op when the key is already in the key store', async () => {
    const sk = generateSecretKey()
    await saveLocalKey(sk)
    const { getUserDb } = await import('../lib/userDb')
    const db = getUserDb()!
    const hex = 'c'.repeat(64)
    await db.settings.put({ key: 'nostr-chat-storage', value: JSON.stringify({ state: { privateKeyHex: hex, publicKey: PK } }) })
    await migratePlaintextKeyIfNeeded(PK)
    // The key in store should remain the original sk, not the one from the blob
    const loaded = await loadLocalKey()
    expect(loaded && eq(loaded, sk)).toBe(true)
  })

  it('is a no-op when there is no stored blob', async () => {
    await migratePlaintextKeyIfNeeded(PK)
    expect(await hasLocalKey()).toBe(false)
  })
})
