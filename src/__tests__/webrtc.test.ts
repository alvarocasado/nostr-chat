import { describe, it, expect } from 'vitest'
import { generateKeys } from '../lib/nostr'
import {
  buildCallSignalEvent,
  decryptCallSignal,
  ICE_SERVERS,
  CALL_SIGNAL_KIND,
  type CallSignal,
} from '../lib/webrtc'

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeKeypair() {
  const { sk, pk } = generateKeys()
  return { sk, pk }
}

const OFFER_SIGNAL: CallSignal = {
  type: 'call-offer',
  callId: 'test-call-1',
  mediaType: 'audio',
  sdp: 'v=0\r\no=- 123 456 IN IP4 0.0.0.0\r\ns=-\r\n',
}

const ANSWER_SIGNAL: CallSignal = {
  type: 'call-answer',
  callId: 'test-call-1',
  sdp: 'v=0\r\no=- 789 123 IN IP4 0.0.0.0\r\ns=-\r\n',
}

const ICE_SIGNAL: CallSignal = {
  type: 'ice-candidate',
  callId: 'test-call-1',
  candidate: { candidate: 'candidate:1 1 UDP 2122252543 10.0.0.1 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 },
}

const END_SIGNAL: CallSignal = {
  type: 'call-end',
  callId: 'test-call-1',
  reason: 'ended',
}

// ─── buildCallSignalEvent ────────────────────────────────────────────────────

describe('buildCallSignalEvent', () => {
  it('produces an event with kind 24100', async () => {
    const sender = makeKeypair()
    const recipient = makeKeypair()
    const event = await buildCallSignalEvent(sender.sk, recipient.pk, OFFER_SIGNAL)
    expect(event.kind).toBe(CALL_SIGNAL_KIND)
    expect(event.kind).toBe(24100)
  })

  it('tags the recipient pubkey with a p-tag', async () => {
    const sender = makeKeypair()
    const recipient = makeKeypair()
    const event = await buildCallSignalEvent(sender.sk, recipient.pk, OFFER_SIGNAL)
    const pTag = event.tags.find(t => t[0] === 'p')
    expect(pTag).toBeDefined()
    expect(pTag![1]).toBe(recipient.pk)
  })

  it('does not leak plaintext signal in event content', async () => {
    const sender = makeKeypair()
    const recipient = makeKeypair()
    const event = await buildCallSignalEvent(sender.sk, recipient.pk, OFFER_SIGNAL)
    expect(event.content).not.toContain('call-offer')
    expect(event.content).not.toContain(OFFER_SIGNAL.sdp)
  })

  it('sets a recent created_at timestamp', async () => {
    const sender = makeKeypair()
    const recipient = makeKeypair()
    const before = Math.floor(Date.now() / 1000)
    const event = await buildCallSignalEvent(sender.sk, recipient.pk, OFFER_SIGNAL)
    const after = Math.floor(Date.now() / 1000)
    expect(event.created_at).toBeGreaterThanOrEqual(before)
    expect(event.created_at).toBeLessThanOrEqual(after)
  })

  it('produces a valid event signature', async () => {
    const sender = makeKeypair()
    const recipient = makeKeypair()
    const event = await buildCallSignalEvent(sender.sk, recipient.pk, OFFER_SIGNAL)
    expect(event.sig).toMatch(/^[0-9a-f]{128}$/)
    expect(event.pubkey).toBe(sender.pk)
  })
})

// ─── decryptCallSignal ───────────────────────────────────────────────────────

describe('decryptCallSignal', () => {
  it('round-trips a call-offer signal', async () => {
    const sender = makeKeypair()
    const recipient = makeKeypair()
    const event = await buildCallSignalEvent(sender.sk, recipient.pk, OFFER_SIGNAL)
    const result = await decryptCallSignal(recipient.sk, sender.pk, event.content)
    expect(result).toEqual(OFFER_SIGNAL)
  })

  it('round-trips a call-answer signal', async () => {
    const sender = makeKeypair()
    const recipient = makeKeypair()
    const event = await buildCallSignalEvent(sender.sk, recipient.pk, ANSWER_SIGNAL)
    const result = await decryptCallSignal(recipient.sk, sender.pk, event.content)
    expect(result).toEqual(ANSWER_SIGNAL)
  })

  it('round-trips an ice-candidate signal', async () => {
    const sender = makeKeypair()
    const recipient = makeKeypair()
    const event = await buildCallSignalEvent(sender.sk, recipient.pk, ICE_SIGNAL)
    const result = await decryptCallSignal(recipient.sk, sender.pk, event.content)
    expect(result).toEqual(ICE_SIGNAL)
  })

  it('round-trips a call-end signal with reason', async () => {
    const sender = makeKeypair()
    const recipient = makeKeypair()
    const event = await buildCallSignalEvent(sender.sk, recipient.pk, END_SIGNAL)
    const result = await decryptCallSignal(recipient.sk, sender.pk, event.content)
    expect(result).toEqual(END_SIGNAL)
  })

  it('returns null when decrypted with the wrong key', async () => {
    const sender = makeKeypair()
    const recipient = makeKeypair()
    const wrong = makeKeypair()
    const event = await buildCallSignalEvent(sender.sk, recipient.pk, OFFER_SIGNAL)
    const result = await decryptCallSignal(wrong.sk, sender.pk, event.content)
    expect(result).toBeNull()
  })

  it('returns null for empty string content', async () => {
    const { sk, pk } = makeKeypair()
    const result = await decryptCallSignal(sk, pk, '')
    expect(result).toBeNull()
  })

  it('returns null for plaintext non-JSON content', async () => {
    const { sk, pk } = makeKeypair()
    const result = await decryptCallSignal(sk, pk, 'not encrypted at all')
    expect(result).toBeNull()
  })

  it('returns null if decrypted payload is missing type', async () => {
    const sender = makeKeypair()
    const recipient = makeKeypair()
    // Encrypt a payload without 'type'
    const { nip04 } = await import('nostr-tools')
    const malformed = await nip04.encrypt(sender.sk, recipient.pk, JSON.stringify({ callId: 'x' }))
    const result = await decryptCallSignal(recipient.sk, sender.pk, malformed)
    expect(result).toBeNull()
  })

  it('returns null if decrypted payload is missing callId', async () => {
    const sender = makeKeypair()
    const recipient = makeKeypair()
    const { nip04 } = await import('nostr-tools')
    const malformed = await nip04.encrypt(sender.sk, recipient.pk, JSON.stringify({ type: 'call-offer' }))
    const result = await decryptCallSignal(recipient.sk, sender.pk, malformed)
    expect(result).toBeNull()
  })
})

// ─── ICE_SERVERS ─────────────────────────────────────────────────────────────

describe('ICE_SERVERS', () => {
  it('contains at least one entry', () => {
    expect(ICE_SERVERS.length).toBeGreaterThan(0)
  })

  it('every entry has a urls property', () => {
    for (const server of ICE_SERVERS) {
      expect(server.urls).toBeDefined()
    }
  })

  it('all entries use the stun: scheme', () => {
    for (const server of ICE_SERVERS) {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
      for (const url of urls) {
        expect(url).toMatch(/^stun:/)
      }
    }
  })
})
