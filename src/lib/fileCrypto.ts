// AES-GCM-256 file encryption with a per-file random key and 12-byte IV.

export function bytesToB64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s)
}

export function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function generateFileKey(): Promise<{ key: CryptoKey; iv: Uint8Array }> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  return { key, iv }
}

export function encryptBlob(bytes: ArrayBuffer, key: CryptoKey, iv: Uint8Array): Promise<ArrayBuffer> {
  // ponytail: wrap in a TypedArray view — Node 20's jsdom WebCrypto rejects a bare ArrayBuffer.
  return crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new Uint8Array(bytes))
}

export async function exportKeyB64(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key)
  return bytesToB64(new Uint8Array(raw))
}

export function ivToB64(iv: Uint8Array): string {
  return bytesToB64(iv)
}

export async function decryptBlob(cipher: ArrayBuffer, keyB64: string, ivB64: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', b64ToBytes(keyB64), { name: 'AES-GCM' }, false, ['decrypt'])
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(ivB64) }, key, cipher)
}
