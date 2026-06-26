import { describe, it, expect, vi, afterEach } from 'vitest'
import { Nip07Signer } from '../lib/signer'

afterEach(() => { delete (window as { nostr?: unknown }).nostr })

describe('Nip07Signer', () => {
  it('delegates to window.nostr and reports nip04 capability', async () => {
    const signEvent = vi.fn(async (t) => ({ ...t, id: 'x', pubkey: 'pk', sig: 's' }))
    ;(window as { nostr?: unknown }).nostr = {
      getPublicKey: async () => 'pk',
      signEvent,
      nip04: { encrypt: async () => 'ct', decrypt: async () => 'pt' },
    }
    const s = await Nip07Signer.create()
    expect(s.pubkey).toBe('pk')
    expect(s.caps.nip04).toBe(true)
    expect(await s.nip04Encrypt('peer', 'hi')).toBe('ct')
    await s.signEvent({ kind: 1, created_at: 0, tags: [], content: 'hi' })
    expect(signEvent).toHaveBeenCalled()
  })

  it('reports nip04 false when the extension lacks it', async () => {
    ;(window as { nostr?: unknown }).nostr = { getPublicKey: async () => 'pk', signEvent: async (t) => t }
    const s = await Nip07Signer.create()
    expect(s.caps.nip04).toBe(false)
    await expect(s.nip04Encrypt('peer', 'hi')).rejects.toThrow()
  })
})
