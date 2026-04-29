import Dexie, { type Table } from 'dexie'
import type { Message } from '../store/nostrStore'

export interface SettingRecord {
  key: string
  value: string
}

export interface MessageRecord {
  id: string
  chatId: string
  pubkey: string
  content: string
  createdAt: number
  tags: string[][]
  kind: number
  recipientPubkey?: string
  decrypted?: boolean
  replyTo?: { id: string; pubkey: string; previewText: string }
  status?: 'sending' | 'sent' | 'failed'
}

export function messageToRecord(chatId: string, m: Message): MessageRecord {
  return {
    id: m.id,
    chatId,
    pubkey: m.pubkey,
    content: m.content,
    createdAt: m.createdAt,
    tags: m.tags,
    kind: m.kind,
    recipientPubkey: m.recipientPubkey,
    decrypted: m.decrypted,
    replyTo: m.replyTo,
    status: m.status,
  }
}

export function recordToMessage(r: MessageRecord): Message {
  return {
    id: r.id,
    pubkey: r.pubkey,
    content: r.content,
    createdAt: r.createdAt,
    tags: r.tags,
    kind: r.kind,
    channelId: r.chatId,
    recipientPubkey: r.recipientPubkey,
    decrypted: r.decrypted,
    replyTo: r.replyTo,
    status: r.status,
  }
}

export class UserDatabase extends Dexie {
  settings!: Table<SettingRecord, string>
  messages!: Table<MessageRecord, string>

  constructor(pubkey: string) {
    super(`nostr-chat-${pubkey}`)
    this.version(1).stores({
      settings: 'key',
    })
    this.version(2).stores({
      settings: 'key',
      messages: 'id, [chatId+createdAt], createdAt',
    })
  }
}
