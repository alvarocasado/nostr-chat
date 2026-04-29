import { UserDatabase } from './db'

let _db: UserDatabase | null = null

export function openUserDb(pubkey: string): UserDatabase {
  if (_db) _db.close()
  _db = new UserDatabase(pubkey)
  return _db
}

export function closeUserDb(): void {
  _db?.close()
  _db = null
}

export function getUserDb(): UserDatabase | null {
  return _db
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const db = _db
  if (!db) return fallback
  try {
    const record = await db.settings.get(key)
    if (!record) return fallback
    return JSON.parse(record.value) as T
  } catch {
    return fallback
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = _db
  if (!db) return
  await db.settings.put({ key, value: JSON.stringify(value) })
}

export async function deleteSetting(key: string): Promise<void> {
  const db = _db
  if (!db) return
  await db.settings.delete(key)
}

const MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export async function evictOldMessages(): Promise<void> {
  const db = _db
  if (!db) return
  const cutoff = Math.floor((Date.now() - MESSAGE_TTL_MS) / 1000) // createdAt is unix seconds
  await db.messages.where('createdAt').below(cutoff).delete()
}

export const ACTIVE_PUBKEY_KEY = 'nostr-active-pubkey'

export function getActivePubkey(): string | null {
  try { return localStorage.getItem(ACTIVE_PUBKEY_KEY) } catch { return null }
}

export function setActivePubkey(pubkey: string): void {
  try { localStorage.setItem(ACTIVE_PUBKEY_KEY, pubkey) } catch {}
}

export function clearActivePubkey(): void {
  try { localStorage.removeItem(ACTIVE_PUBKEY_KEY) } catch {}
}
