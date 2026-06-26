import { getUserDb } from './userDb'
import { saveLocalKey, hasLocalKey } from './keyStore'

const STORAGE_KEY = 'nostr-chat-storage'

/** One-time: move a plaintext privateKeyHex out of the Zustand blob into the encrypted key store. */
export async function migratePlaintextKeyIfNeeded(_pubkey: string): Promise<void> {
  const db = getUserDb()
  if (!db) return
  if (await hasLocalKey()) return
  const rec = await db.settings.get(STORAGE_KEY)
  if (!rec) return
  let parsed: { state?: { privateKeyHex?: string } }
  try { parsed = JSON.parse(rec.value) } catch { return }
  const hex = parsed.state?.privateKeyHex
  if (!hex) return
  if (!/^[0-9a-f]{64}$/i.test(hex)) return
  const bytes = Uint8Array.from(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  await saveLocalKey(bytes)
  delete parsed.state!.privateKeyHex
  if (parsed.state && 'nsec' in parsed.state) delete (parsed.state as Record<string, unknown>).nsec
  await db.settings.put({ key: STORAGE_KEY, value: JSON.stringify(parsed) })
}
