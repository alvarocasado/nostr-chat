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
  return btoa(String.fromCharCode(...combined))
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
