import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installTestSigner } from '../test/signer'
import { clearSigner, getSigner } from '../lib/signer'
import {
  READ_RECEIPT_KIND,
  buildReadReceiptEvent,
  parseReadReceiptEvent,
  clampReadUntil,
  shouldSendReceipt,
} from '../lib/readReceipts'

beforeEach(() => { installTestSigner() })
afterEach(() => clearSigner())

describe('buildReadReceiptEvent', () => {
  it('uses ephemeral kind 24102 with a p tag and encrypted content', async () => {
    const me = getSigner()!.pubkey
    const event = await buildReadReceiptEvent(me, 1234)
    expect(event.kind).toBe(READ_RECEIPT_KIND)
    expect(event.kind).toBeGreaterThanOrEqual(20000)
    expect(event.kind).toBeLessThan(30000)
    expect(event.tags).toEqual([['p', me]])
    expect(event.content).not.toContain('read_until') // encrypted, not plaintext
  })
})

describe('parseReadReceiptEvent', () => {
  it('round-trips a watermark (self-encrypted)', async () => {
    const me = getSigner()!.pubkey
    const now = Math.floor(Date.now() / 1000)
    const event = await buildReadReceiptEvent(me, now - 10)
    expect(await parseReadReceiptEvent(event)).toBe(now - 10)
  })

  it('returns null for undecryptable content', async () => {
    const me = getSigner()!.pubkey
    const event = await buildReadReceiptEvent(me, 100)
    expect(await parseReadReceiptEvent({ ...event, content: 'garbage' })).toBeNull()
  })

  it('returns null for a wrong kind', async () => {
    const me = getSigner()!.pubkey
    const event = await buildReadReceiptEvent(me, 100)
    expect(await parseReadReceiptEvent({ ...event, kind: 4 })).toBeNull()
  })

  it('clamps far-future watermarks to now + 5 min', async () => {
    const me = getSigner()!.pubkey
    const now = Math.floor(Date.now() / 1000)
    const event = await buildReadReceiptEvent(me, now + 100_000)
    const parsed = await parseReadReceiptEvent(event)
    expect(parsed).not.toBeNull()
    expect(parsed!).toBeLessThanOrEqual(now + 301)
  })
})

describe('clampReadUntil', () => {
  it('rejects non-numeric and non-positive values', () => {
    expect(clampReadUntil('x')).toBeNull()
    expect(clampReadUntil(NaN)).toBeNull()
    expect(clampReadUntil(-5)).toBeNull()
    expect(clampReadUntil(0)).toBeNull()
    expect(clampReadUntil(undefined)).toBeNull()
  })

  it('passes sane values through and clamps future ones', () => {
    expect(clampReadUntil(500, 1000)).toBe(500)
    expect(clampReadUntil(99999, 1000)).toBe(1300)
  })
})

describe('shouldSendReceipt', () => {
  const base = { enabled: true, visible: true, newestReceivedAt: 100, lastSent: 50 }

  it('sends when enabled, visible, and the watermark advanced', () => {
    expect(shouldSendReceipt(base)).toBe(true)
  })

  it.each([
    ['setting off', { ...base, enabled: false }],
    ['tab hidden', { ...base, visible: false }],
    ['no received messages', { ...base, newestReceivedAt: undefined }],
    ['watermark not advanced', { ...base, newestReceivedAt: 50 }],
  ])('does not send when %s', (_label, args) => {
    expect(shouldSendReceipt(args)).toBe(false)
  })
})
