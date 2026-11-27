import { finalizeEvent, getPublicKey, nip04, nip44, type Event, type EventTemplate } from 'nostr-tools'
import type { BunkerSigner } from 'nostr-tools/nip46'
import { getNip07, type Nip07Provider } from './nip07'

export interface SignerCaps {
  nip04: boolean
  nip44: boolean
}

export interface Signer {
  type: 'local' | 'nip07' | 'nip46'
  pubkey: string
  signEvent(t: EventTemplate): Promise<Event>
  nip04Encrypt(peer: string, plaintext: string): Promise<string>
  nip04Decrypt(peer: string, ciphertext: string): Promise<string>
  nip44Encrypt(peer: string, plaintext: string): Promise<string>
  nip44Decrypt(peer: string, ciphertext: string): Promise<string>
  caps: SignerCaps
}

export class LocalSigner implements Signer {
  readonly type = 'local' as const
  readonly pubkey: string
  readonly caps: SignerCaps = { nip04: true, nip44: true }
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

  async nip44Encrypt(peer: string, plaintext: string): Promise<string> {
    return nip44.encrypt(plaintext, nip44.getConversationKey(this.sk, peer))
  }

  async nip44Decrypt(peer: string, ciphertext: string): Promise<string> {
    return nip44.decrypt(ciphertext, nip44.getConversationKey(this.sk, peer))
  }

  /** Best-effort zeroing of the in-memory secret on logout. */
  destroy(): void {
    this.sk.fill(0)
  }
}

export class Nip07Signer implements Signer {
  readonly type = 'nip07' as const
  readonly pubkey: string
  readonly caps: SignerCaps
  private provider: Nip07Provider

  private constructor(provider: Nip07Provider, pubkey: string) {
    this.provider = provider
    this.pubkey = pubkey
    this.caps = { nip04: !!provider.nip04, nip44: !!provider.nip44 }
  }

  static async create(): Promise<Nip07Signer> {
    const provider = getNip07()
    if (!provider) throw new Error('No NIP-07 provider')
    const pubkey = await provider.getPublicKey()
    return new Nip07Signer(provider, pubkey)
  }

  async signEvent(t: EventTemplate): Promise<Event> {
    return this.provider.signEvent(t)
  }

  async nip04Encrypt(peer: string, plaintext: string): Promise<string> {
    if (!this.provider.nip04) throw new Error('Signer does not support nip04')
    return this.provider.nip04.encrypt(peer, plaintext)
  }

  async nip04Decrypt(peer: string, ciphertext: string): Promise<string> {
    if (!this.provider.nip04) throw new Error('Signer does not support nip04')
    return this.provider.nip04.decrypt(peer, ciphertext)
  }

  async nip44Encrypt(peer: string, plaintext: string): Promise<string> {
    if (!this.provider.nip44) throw new Error('Signer does not support nip44')
    return this.provider.nip44.encrypt(peer, plaintext)
  }

  async nip44Decrypt(peer: string, ciphertext: string): Promise<string> {
    if (!this.provider.nip44) throw new Error('Signer does not support nip44')
    return this.provider.nip44.decrypt(peer, ciphertext)
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Signer did not answer')), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

// A request the signer app never answers (closed, offline) must fail rather
// than leave a send or decrypt pending forever. Generous: the user may have to
// approve the request in the signer app first.
export const NIP46_REQUEST_TIMEOUT_MS = 60_000

/** NIP-46 remote signer ("bunker"): every sign/encrypt call is a request to
 *  the user's signer app over relays, so the key never touches this device. */
export class Nip46Signer implements Signer {
  readonly type = 'nip46' as const
  readonly pubkey: string
  readonly caps: SignerCaps = { nip04: true, nip44: true }
  readonly bunker: BunkerSigner

  private readonly timeoutMs: number

  constructor(bunker: BunkerSigner, pubkey: string, timeoutMs = NIP46_REQUEST_TIMEOUT_MS) {
    this.bunker = bunker
    this.pubkey = pubkey
    this.timeoutMs = timeoutMs
  }

  signEvent(t: EventTemplate): Promise<Event> { return withTimeout(this.bunker.signEvent(t), this.timeoutMs) }
  nip04Encrypt(peer: string, plaintext: string): Promise<string> { return withTimeout(this.bunker.nip04Encrypt(peer, plaintext), this.timeoutMs) }
  nip04Decrypt(peer: string, ciphertext: string): Promise<string> { return withTimeout(this.bunker.nip04Decrypt(peer, ciphertext), this.timeoutMs) }
  nip44Encrypt(peer: string, plaintext: string): Promise<string> { return withTimeout(this.bunker.nip44Encrypt(peer, plaintext), this.timeoutMs) }
  nip44Decrypt(peer: string, ciphertext: string): Promise<string> { return withTimeout(this.bunker.nip44Decrypt(peer, ciphertext), this.timeoutMs) }
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
  if (_signer instanceof Nip46Signer) void _signer.bunker.close().catch(() => {})
  _signer = null
}

export function requireSigner(): Signer {
  if (!_signer) throw new Error('No signer available')
  return _signer
}
