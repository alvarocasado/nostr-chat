import { getUserDb } from './userDb'

export const PBKDF2_ITERATIONS = 600_000

const ENC_KEY_SETTING = 'encrypted-key'
const DEVICE_KEY_ID = 'device-wrap-key'

type DeviceRecord = { mode: 'device'; iv: string; ciphertext: string }
type PassphraseRecord = {
  mode: 'passphrase'; iv: string; salt: string; iterations: number; ciphertext: string
}
type EncryptedKey = DeviceRecord | PassphraseRecord

function b64encode(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
function b64decode(s: string): Uint8Array {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0))
}

async function readRecord(): Promise<EncryptedKey | null> {
  const db = getUserDb()
  if (!db) return null
  const rec = await db.settings.get(ENC_KEY_SETTING)
  return rec ? (JSON.parse(rec.value) as EncryptedKey) : null
}
async function writeRecord(value: EncryptedKey): Promise<void> {
  const db = getUserDb()
  if (!db) return
  await db.settings.put({ key: ENC_KEY_SETTING, value: JSON.stringify(value) })
}

async function getOrCreateDeviceKey(): Promise<CryptoKey | null> {
  const db = getUserDb()
  if (!db) return null
  const existing = await db.crypto.get(DEVICE_KEY_ID)
  if (existing) return existing.key
  // Device mode is obfuscation, not a vault: the key is non-extractable so its
  // raw bytes cannot be read from IndexedDB, but on-device code execution can
  // still invoke decryption. Passphrase mode is the real protection.
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await db.crypto.put({ id: DEVICE_KEY_ID, key })
  return key
}

async function wrap(key: CryptoKey, secret: Uint8Array): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, secret)
  return { iv: b64encode(iv), ciphertext: b64encode(new Uint8Array(ct)) }
}
async function unwrap(key: CryptoKey, iv: string, ciphertext: string): Promise<Uint8Array> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64decode(iv) }, key, b64decode(ciphertext))
  return new Uint8Array(plain)
}

export async function saveLocalKey(secret: Uint8Array, opts?: { passphrase?: string }): Promise<void> {
  if (opts?.passphrase) return savePassphrase(secret, opts.passphrase)
  const deviceKey = await getOrCreateDeviceKey()
  if (!deviceKey) return
  const { iv, ciphertext } = await wrap(deviceKey, secret)
  await writeRecord({ mode: 'device', iv, ciphertext })
}

export async function loadLocalKey(opts?: { passphrase?: string }): Promise<Uint8Array | null> {
  const rec = await readRecord()
  if (!rec) return null
  if (rec.mode === 'device') {
    const deviceKey = await getOrCreateDeviceKey()
    if (!deviceKey) return null
    try { return await unwrap(deviceKey, rec.iv, rec.ciphertext) } catch { return null }
  }
  return loadPassphrase(rec, opts?.passphrase)
}

export async function hasLocalKey(): Promise<boolean> {
  return (await readRecord()) !== null
}

export async function keyProtection(): Promise<'none' | 'device' | 'passphrase'> {
  const rec = await readRecord()
  return rec ? rec.mode : 'none'
}

export async function clearLocalKey(): Promise<void> {
  const db = getUserDb()
  if (!db) return
  await db.settings.delete(ENC_KEY_SETTING)
  await db.crypto.delete(DEVICE_KEY_ID)
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function savePassphrase(secret: Uint8Array, passphrase: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS)
  const { iv, ciphertext } = await wrap(key, secret)
  await writeRecord({ mode: 'passphrase', iv, salt: b64encode(salt), iterations: PBKDF2_ITERATIONS, ciphertext })
  // Passphrase mode supersedes device mode: drop any device wrap key.
  const db = getUserDb()
  if (db) await db.crypto.delete(DEVICE_KEY_ID)
}

async function loadPassphrase(rec: PassphraseRecord, passphrase?: string): Promise<Uint8Array | null> {
  if (!passphrase) return null
  try {
    const key = await deriveKey(passphrase, b64decode(rec.salt), rec.iterations)
    return await unwrap(key, rec.iv, rec.ciphertext)
  } catch {
    return null
  }
}

/** Switch protection: passphrase string sets/changes it, null reverts to device mode. */
export async function setPassphrase(secret: Uint8Array, passphrase: string | null): Promise<void> {
  if (passphrase) await savePassphrase(secret, passphrase)
  else await saveLocalKey(secret) // device mode
}
