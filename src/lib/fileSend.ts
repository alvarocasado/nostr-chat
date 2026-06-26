import { uploadBlob, setCachedObjectUrl } from './blossom'
import { generateFileKey, encryptBlob, exportKeyB64, ivToB64 } from './fileCrypto'
import type { AttachmentData } from './fileUtils'

async function dataUrlToBytes(dataUrl: string): Promise<ArrayBuffer> {
  // data URLs are not reliably fetchable in all environments (jsdom, service workers).
  // Decode them directly; delegate real URLs to fetch.
  if (dataUrl.startsWith('data:')) {
    const comma = dataUrl.indexOf(',')
    const meta = dataUrl.slice(5, comma)   // e.g. "text/plain;base64"
    const payload = dataUrl.slice(comma + 1)
    if (meta.endsWith(';base64')) {
      const bin = atob(payload)
      const buf = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
      return buf.buffer
    }
    // URL-encoded plain text
    const text = decodeURIComponent(payload)
    return new TextEncoder().encode(text).buffer
  }
  return (await fetch(dataUrl)).arrayBuffer()
}

/**
 * Upload an inline attachment to Blossom and return a remote reference.
 * Channels upload plaintext; DMs and groups encrypt with a per-file key whose
 * material is returned in `enc` for the caller to embed in the encrypted message.
 */
export async function uploadAttachment(
  attachment: AttachmentData,
  chatType: 'dm' | 'channel' | 'group',
  server: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<AttachmentData> {
  if (!attachment.data) throw new Error('Attachment has no data to upload')
  const bytes = await dataUrlToBytes(attachment.data)
  const base: AttachmentData = { name: attachment.name, type: attachment.type, size: attachment.size }

  if (chatType === 'channel') {
    const desc = await uploadBlob(server, bytes, attachment.type, onProgress)
    setCachedObjectUrl(desc.url, URL.createObjectURL(new Blob([bytes], { type: attachment.type })))
    return { ...base, url: desc.url, hash: desc.sha256 }
  }

  const { key, iv } = await generateFileKey()
  const cipher = await encryptBlob(bytes, key, iv)
  const desc = await uploadBlob(server, cipher, 'application/octet-stream', onProgress)
  setCachedObjectUrl(desc.url, URL.createObjectURL(new Blob([bytes], { type: attachment.type })))
  return {
    ...base,
    url: desc.url,
    hash: desc.sha256,
    enc: { algo: 'AES-GCM', key: await exportKeyB64(key), iv: ivToB64(iv) },
  }
}
