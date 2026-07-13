export function generateGroupKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export async function encryptWithGroupKey(plaintext: string, keyHex: string): Promise<string> {
  const key = await importGroupKey(keyHex)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  const combined = new Uint8Array(12 + ciphertext.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(ciphertext), 12)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < combined.length; i += chunkSize) {
    binary += String.fromCharCode(...combined.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export async function decryptWithGroupKey(ciphertext: string, keyHex: string): Promise<string> {
  const key = await importGroupKey(keyHex)
  const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0))
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: combined.slice(0, 12) }, key, combined.slice(12))
  return new TextDecoder().decode(plain)
}

async function importGroupKey(keyHex: string): Promise<CryptoKey> {
  const bytes = new Uint8Array(keyHex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

// Epoch fallback: rotation retires keys but old messages stay encrypted with
// them. Try newest→oldest; first success wins.
export async function decryptWithGroupKeys(ciphertext: string, keysNewestFirst: string[]): Promise<string> {
  for (const keyHex of keysNewestFirst) {
    try {
      return await decryptWithGroupKey(ciphertext, keyHex)
    } catch { /* wrong epoch — try older */ }
  }
  throw new Error('no group key decrypts this message')
}
