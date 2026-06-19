import { finalizeEvent, getPublicKey, nip04, type Event, type EventTemplate } from 'nostr-tools'

export interface SignerCaps {
  nip04: boolean
}

export interface Signer {
  type: 'local' | 'nip07'
  pubkey: string
  signEvent(t: EventTemplate): Promise<Event>
  nip04Encrypt(peer: string, plaintext: string): Promise<string>
  nip04Decrypt(peer: string, ciphertext: string): Promise<string>
  caps: SignerCaps
}

export class LocalSigner implements Signer {
  readonly type = 'local' as const
  readonly pubkey: string
  readonly caps: SignerCaps = { nip04: true }
  private sk: Uint8Array

  constructor(sk: Uint8Array) {
    this.sk = sk
    this.pubkey = getPublicKey(sk)
  }

  async signEvent(t: EventTemplate): Promise<Event> {
    return finalizeEvent(t, this.sk)
  }

  async nip04Encrypt(peer: string, plaintext: string): Promise<string> {
    return nip04.encrypt(this.sk, peer, plaintext)
  }

  async nip04Decrypt(peer: string, ciphertext: string): Promise<string> {
    return nip04.decrypt(this.sk, peer, ciphertext)
  }

  /** Best-effort zeroing of the in-memory secret on logout. */
  destroy(): void {
    this.sk.fill(0)
  }
}

let _signer: Signer | null = null

export function getSigner(): Signer | null {
  return _signer
}

export function setSigner(s: Signer): void {
  _signer = s
}

export function clearSigner(): void {
  if (_signer instanceof LocalSigner) _signer.destroy()
  _signer = null
}

export function requireSigner(): Signer {
  if (!_signer) throw new Error('No signer available')
  return _signer
}
