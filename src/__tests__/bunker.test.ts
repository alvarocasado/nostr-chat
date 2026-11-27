import { it, expect, vi } from 'vitest'

const close = vi.fn(async () => {})
vi.mock('nostr-tools/nip46', () => ({
  parseBunkerInput: vi.fn(),
  BunkerSigner: { fromBunker: () => ({ getPublicKey: () => new Promise(() => {}), close }) },
}))

import { restoreBunker } from '../lib/bunker'

it('gives up restoring when the signer never answers, so app start is not stuck', async () => {
  const session = { clientSecretKey: new Uint8Array(32), bunker: { pubkey: 'a'.repeat(64), relays: [], secret: null } }
  await expect(restoreBunker(session, 20)).rejects.toThrow('Signer did not answer')
  expect(close).toHaveBeenCalled()
})
