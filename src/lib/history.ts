import type { Filter } from 'nostr-tools'
import { getUserDb } from './userDb'
import { recordToMessage } from './db'
import { GROUP_MESSAGE_KIND, LEGACY_GROUP_MESSAGE_KIND } from './nostr'
import type { Message } from '../store/nostrStore'

export function indexOfMessage(messages: Message[], id: string): number {
  return messages.findIndex(m => m.id === id)
}

export type ChatType = 'dm' | 'channel' | 'group'

/**
 * Build relay backfill filters for fetching older messages by chat type.
 * - Channels: single #e filter (kind 42)
 * - Groups: single filter with both group message kinds
 * - DMs: two directional filters (sent + received)
 */
export function olderFilterFor(
  chatType: ChatType,
  chatId: string,
  myPubkey: string,
  until: number,
  limit: number,
): Filter[] {
  if (chatType === 'channel') {
    return [{ kinds: [42], '#e': [chatId], until, limit }]
  }
  if (chatType === 'group') {
    return [{ kinds: [GROUP_MESSAGE_KIND, LEGACY_GROUP_MESSAGE_KIND], '#e': [chatId], until, limit }]
  }
  return [
    { kinds: [4], authors: [myPubkey], '#p': [chatId], until, limit },
    { kinds: [4], authors: [chatId], '#p': [myPubkey], until, limit },
  ]
}

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
