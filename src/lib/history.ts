import { getUserDb } from './userDb'
import { recordToMessage } from './db'
import type { Message } from '../store/nostrStore'

/**
 * Older messages from local Dexie with createdAt strictly less than `before`,
 * newest-first limited to `limit`, returned in ascending order for prepending.
 */
export async function pageOlderFromDexie(
  chatId: string,
  before: number,
  limit: number,
): Promise<Message[]> {
  const db = getUserDb()
  if (!db) return []
  const records = await db.messages
    .where('[chatId+createdAt]')
    .between([chatId, -Infinity], [chatId, before], true, false)
    .reverse()
    .limit(limit)
    .toArray()
  return records.map(recordToMessage).reverse()
}
