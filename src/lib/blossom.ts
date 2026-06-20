import { requireSigner } from './signer'
import { getSetting } from './userDb'

export const DEFAULT_MEDIA_SERVER = 'https://blossom.band'
export const MEDIA_SERVER_KEY = 'media_server'
const AUTH_WINDOW_S = 300

export async function getMediaServer(): Promise<string> {
  return getSetting<string>(MEDIA_SERVER_KEY, DEFAULT_MEDIA_SERVER)
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

/** Sign a kind-24242 Blossom auth event and return it base64-encoded for the header. */
export async function buildBlossomAuth(sha256: string, verb = 'upload'): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const event = await requireSigner().signEvent({
    kind: 24242,
    created_at: now,
    tags: [
      ['t', verb],
      ['x', sha256],
      ['expiration', String(now + AUTH_WINDOW_S)],
    ],
    content: `${verb} ${sha256}`,
  })
  return btoa(JSON.stringify(event))
}

export interface BlobDescriptor { url: string; sha256: string; size: number; type: string }

export async function uploadBlob(
  server: string,
  bytes: ArrayBuffer,
  mime: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<BlobDescriptor> {
  const sha256 = await sha256Hex(bytes)
  const auth = await buildBlossomAuth(sha256, 'upload')
  const base = server.replace(/\/$/, '')
  return new Promise<BlobDescriptor>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `${base}/upload`)
    xhr.setRequestHeader('Authorization', `Nostr ${auth}`)
    if (mime) xhr.setRequestHeader('Content-Type', mime)
    xhr.upload.onprogress = (e: ProgressEvent) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText) as BlobDescriptor) }
        catch { reject(new Error('Invalid server response')) }
      } else {
        reject(new Error(`Upload failed (${xhr.status})`))
      }
    }
    xhr.onerror = () => reject(new Error('Upload network error'))
    xhr.send(new Blob([bytes], { type: mime }))
  })
}

export async function downloadBlob(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  return res.arrayBuffer()
}

// Module-level object-URL cache: the sender seeds it from local bytes so its own
// message renders instantly, and repeat views skip a re-download. Session-lived
// (intentionally not revoked — shared across remounts, mirrors the old inline
// data-URL behavior).
const objectUrlCache = new Map<string, string>()
export function getCachedObjectUrl(url: string): string | undefined { return objectUrlCache.get(url) }
export function setCachedObjectUrl(url: string, objectUrl: string): void { objectUrlCache.set(url, objectUrl) }
