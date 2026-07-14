import type { Event, EventTemplate } from 'nostr-tools'

export interface Nip07Provider {
  getPublicKey(): Promise<string>
  signEvent(event: EventTemplate): Promise<Event>
  nip04?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>
    decrypt(pubkey: string, ciphertext: string): Promise<string>
  }
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>
    decrypt(pubkey: string, ciphertext: string): Promise<string>
  }
}

declare global {
  interface Window { nostr?: Nip07Provider }
}

export function hasNip07(): boolean {
  return typeof window !== 'undefined' && !!window.nostr
}

export function getNip07(): Nip07Provider | null {
  return hasNip07() ? window.nostr! : null
}
