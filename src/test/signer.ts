import { generateSecretKey } from 'nostr-tools'
import { LocalSigner, setSigner } from '../lib/signer'

/** Install a LocalSigner as the active singleton for tests. */
export function installTestSigner(sk: Uint8Array = generateSecretKey()) {
  const signer = new LocalSigner(sk)
  setSigner(signer)
  return { sk, signer }
}
