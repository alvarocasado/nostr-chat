import { buildDMEvent, buildChannelMessageEvent } from './nostr'
import { publishEvent } from './nostr'

// ~75 KB binary per chunk → ~100 KB base64, within the limits of the relays
// used by this app (most allow 256 KB+; stricter relays cap at 64 KB and will
// reject DM chunks regardless since NIP-04 inflation pushes them over anyway).
export const CHUNK_BASE64_SIZE = 100_000
// Below this base64 length, send inline; above it, chunk automatically.
export const INLINE_BASE64_THRESHOLD = 150 * 1024
// Hard cap on the total file the user can attach.
export const MAX_CHUNKED_FILE_BYTES = 50 * 1024 * 1024  // 50 MB

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
const orphanChunks = new Map<string, Record<number, string>>()

const TRANSFER_TIMEOUT_S = 15 * 60  // 15 minutes — large files can take several minutes to transfer

// Prune transfers older than TRANSFER_TIMEOUT_S on each new manifest arrival
function gcStaleTransfers() {
  const cutoff = Math.floor(Date.now() / 1000) - TRANSFER_TIMEOUT_S
  for (const [id, t] of transfers) {
    if (t.createdAt < cutoff) transfers.delete(id)
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function generateTransferId(): string {
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
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

const MAX_TOTAL_CHUNKS = 700   // 700 × 100 KB ≈ 70 MB ceiling (covers 50 MB with margin)
const MAX_FILE_NAME_LEN = 255
const MAX_MIME_LEN = 127
// Chunk data is base64; allow a 10 % safety margin over the nominal chunk size
const MAX_CHUNK_DATA_LEN = Math.ceil(CHUNK_BASE64_SIZE * 1.1)

// Only allow safe, well-known types — reject executables, scripts, archives
const ALLOWED_MIME_PREFIXES = ['image/', 'audio/', 'video/', 'text/']
const ALLOWED_MIME_EXACT = new Set(['application/pdf'])

function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIME_PREFIXES.some(p => mime.startsWith(p)) || ALLOWED_MIME_EXACT.has(mime)
}

/** Call when a file_start message is received. */
export function handleFileStart(
  transferId: string,
  payload: FileStartPayload,
  chatId: string,
  senderPubkey: string,
  createdAt: number,
): void {
  // Reject malformed, oversized, or disallowed-MIME manifests
  if (
    !payload.name || payload.name.length > MAX_FILE_NAME_LEN ||
    !payload.mime || payload.mime.length > MAX_MIME_LEN ||
    !isAllowedMime(payload.mime) ||
    payload.size <= 0 || payload.size > MAX_CHUNKED_FILE_BYTES ||
    payload.totalChunks <= 0 || payload.totalChunks > MAX_TOTAL_CHUNKS
  ) return

  gcStaleTransfers()
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
  // Reject oversized or non-base64 chunks
  if (typeof data !== 'string' || data.length === 0 || data.length > MAX_CHUNK_DATA_LEN) return null

  const transfer = transfers.get(transferId)
  if (!transfer) {
    const existing = orphanChunks.get(transferId) ?? {}
    // Prevent orphan accumulation exceeding the file size ceiling
    const orphanTotal = Object.values(existing).reduce((s, c) => s + c.length, 0)
    if (orphanTotal + data.length > CHUNK_BASE64_SIZE * MAX_TOTAL_CHUNKS) return null
    orphanChunks.set(transferId, { ...existing, [index]: data })
    return null
  }

  // Reject out-of-range indices
  if (index < 0 || index >= transfer.totalChunks) return null

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
