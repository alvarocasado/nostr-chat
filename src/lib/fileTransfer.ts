import { buildDMEvent, buildChannelMessageEvent } from './nostr'
import { publishEvent } from './nostr'

// ~40 KB binary per chunk → ~53 KB base64, comfortably under the 64 KB relay limit.
export const CHUNK_BASE64_SIZE = 53_000
// Below this base64 length, send inline; above it, chunk automatically.
export const INLINE_BASE64_THRESHOLD = 150 * 1024
// Hard cap on the total file the user can attach.
export const MAX_CHUNKED_FILE_BYTES = 10 * 1024 * 1024  // 10 MB

// ─── Payload types ──────────────────────────────────────────────────────────

export interface FileStartPayload {
  type: 'file_start'
  transferId: string
  name: string
  mime: string
  size: number        // original binary bytes
  totalChunks: number
}

export interface FileChunkPayload {
  type: 'file_chunk'
  transferId: string
  index: number
  total: number
  data: string        // base64 slice (no data-URL prefix)
}

export type FileTransferPayload = FileStartPayload | FileChunkPayload

export interface IncomingTransfer {
  name: string
  mime: string
  size: number
  totalChunks: number
  chunks: Record<number, string>
  chatId: string
  senderPubkey: string
  createdAt: number
}

// ─── Module-level in-memory state (ephemeral, not persisted) ────────────────

const transfers = new Map<string, IncomingTransfer>()
// Chunks that arrived before their manifest
const orphanChunks = new Map<string, Record<number, string>>()

// ─── Helpers ────────────────────────────────────────────────────────────────

export function generateTransferId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

/** Parse a message content string into a transfer payload, or return null. */
export function parseTransferPayload(content: string): FileTransferPayload | null {
  if (!content.startsWith('{')) return null
  try {
    const obj = JSON.parse(content)
    if (
      obj.type === 'file_start' &&
      typeof obj.transferId === 'string' &&
      typeof obj.name === 'string' &&
      typeof obj.mime === 'string' &&
      typeof obj.totalChunks === 'number'
    ) return obj as FileStartPayload
    if (
      obj.type === 'file_chunk' &&
      typeof obj.transferId === 'string' &&
      typeof obj.index === 'number' &&
      typeof obj.data === 'string'
    ) return obj as FileChunkPayload
  } catch { /* not JSON */ }
  return null
}

/**
 * Split a data URL into the MIME prefix and an array of base64 chunks.
 * e.g. "data:image/jpeg;base64,AAAA..." → { prefix: "data:image/jpeg;base64,", chunks: ["AAAA..."] }
 */
export function splitDataUrl(dataUrl: string): { prefix: string; chunks: string[] } {
  const comma = dataUrl.indexOf(',')
  const prefix = dataUrl.slice(0, comma + 1)
  const base64 = dataUrl.slice(comma + 1)
  const chunks: string[] = []
  for (let i = 0; i < base64.length; i += CHUNK_BASE64_SIZE) {
    chunks.push(base64.slice(i, i + CHUNK_BASE64_SIZE))
  }
  return { prefix, chunks }
}

export function reconstructDataUrl(mime: string, chunks: Record<number, string>, totalChunks: number): string {
  const ordered = Array.from({ length: totalChunks }, (_, i) => chunks[i] ?? '')
  return `data:${mime};base64,${ordered.join('')}`
}

export function serializeFileStart(p: Omit<FileStartPayload, 'type'>): string {
  return JSON.stringify({ type: 'file_start', ...p })
}

export function serializeFileChunk(p: Omit<FileChunkPayload, 'type'>): string {
  return JSON.stringify({ type: 'file_chunk', ...p })
}

// ─── Receive-side state machine ──────────────────────────────────────────────

/** Call when a file_start message is received. */
export function handleFileStart(
  transferId: string,
  payload: FileStartPayload,
  chatId: string,
  senderPubkey: string,
  createdAt: number,
): void {
  const orphans = orphanChunks.get(transferId) ?? {}
  orphanChunks.delete(transferId)
  transfers.set(transferId, {
    name: payload.name,
    mime: payload.mime,
    size: payload.size,
    totalChunks: payload.totalChunks,
    chunks: orphans,
    chatId,
    senderPubkey,
    createdAt,
  })
}

/**
 * Call when a file_chunk message is received.
 * Returns the completed IncomingTransfer when the last chunk arrives, else null.
 */
export function handleFileChunk(
  transferId: string,
  index: number,
  data: string,
): IncomingTransfer | null {
  const transfer = transfers.get(transferId)
  if (!transfer) {
    const existing = orphanChunks.get(transferId) ?? {}
    orphanChunks.set(transferId, { ...existing, [index]: data })
    return null
  }

  transfer.chunks[index] = data
  const received = Object.keys(transfer.chunks).length

  if (received >= transfer.totalChunks) {
    const allPresent = Array.from({ length: transfer.totalChunks }, (_, i) => transfer.chunks[i])
    if (!allPresent.some(c => !c)) {
      transfers.delete(transferId)
      return { ...transfer }
    }
  }
  return null
}

// ─── Send-side ───────────────────────────────────────────────────────────────

/**
 * Send a large file as a sequence of chunked Nostr events.
 * Works for both DMs (encrypted) and channels (plaintext).
 */
export async function sendChunkedFile(
  sk: Uint8Array,
  _myPubkey: string,
  dataUrl: string,
  name: string,
  mime: string,
  size: number,
  chatType: 'dm' | 'channel',
  chatId: string,  // recipientPubkey for DM, channelId for channel
  relays: string[],
  onProgress: (sent: number, total: number) => void,
): Promise<void> {
  const transferId = generateTransferId()
  const { prefix: _prefix, chunks } = splitDataUrl(dataUrl)
  const total = chunks.length

  // 1. Send manifest
  const startPayload = serializeFileStart({ transferId, name, mime, size, totalChunks: total })
  const startEvent = chatType === 'dm'
    ? await buildDMEvent(sk, chatId, startPayload)
    : buildChannelMessageEvent(sk, startPayload, chatId, relays[0])
  await publishEvent(relays, startEvent)

  // 2. Send chunks sequentially (relays reject floods)
  for (let i = 0; i < total; i++) {
    const chunkPayload = serializeFileChunk({ transferId, index: i, total, data: chunks[i] })
    const chunkEvent = chatType === 'dm'
      ? await buildDMEvent(sk, chatId, chunkPayload)
      : buildChannelMessageEvent(sk, chunkPayload, chatId, relays[0])
    await publishEvent(relays, chunkEvent)
    onProgress(i + 1, total)
  }
}
