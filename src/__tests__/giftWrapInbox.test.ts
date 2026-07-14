import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { LocalSigner, setSigner } from '../lib/signer'
import { buildGiftWraps } from '../lib/giftWrap'
import { useNostrStore } from '../store/nostrStore'
import { serializeGroupRekey } from '../lib/groupMembership'

vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return {
    ...actual,
    publishEvent: vi.fn().mockResolvedValue(undefined),
    buildGroupKeyBackupEvent: vi.fn().mockResolvedValue({ id: 'backup' }),
    fetchEvent: vi.fn().mockResolvedValue(null),
  }
})

import { processGiftWrap, resetInboxDedup } from '../lib/inbox'

const skAlice = generateSecretKey()
const skBob = generateSecretKey()
const ALICE = getPublicKey(skAlice)
const BOB = getPublicKey(skBob)
const RELAYS = ['wss://r']
const OLD_KEY = 'a'.repeat(64)
const NEW_KEY = 'b'.repeat(64)

async function wrapFromAlice(content: string) {
  setSigner(new LocalSigner(new Uint8Array(skAlice)))
  const wraps = await buildGiftWraps(BOB, content)
  setSigner(new LocalSigner(new Uint8Array(skBob))) // Bob is the receiving user
  return wraps
}

beforeEach(() => {
  resetInboxDedup()
  useNostrStore.setState({
    publicKey: BOB,
    messages: {}, contacts: [], profiles: {}, blockedPubkeys: [], dismissedRequests: {}, seenAt: {},
    groups: [], groupKeys: {}, groupKeyHistory: {}, groupKeyRotatedAt: {}, groupMembersUpdatedAt: {},
  })
})

describe('processGiftWrap', () => {
  it('inserts a chat message with the rumor id, rumor createdAt, kind 14, under the sender chat', async () => {
    const { rumorId, createdAt, wrapForRecipient } = await wrapFromAlice('hello bob')
    await processGiftWrap(wrapForRecipient, BOB, RELAYS, { live: false })
    const msgs = useNostrStore.getState().messages[ALICE] ?? []
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ id: rumorId, pubkey: ALICE, content: 'hello bob', createdAt, kind: 14, decrypted: true })
  })

  it('dedups the self copy against the recipient copy by rumor id', async () => {
    setSigner(new LocalSigner(new Uint8Array(skBob)))
    const wraps = await buildGiftWraps(ALICE, 'from bob') // Bob sends; self copy comes back to Bob
    await processGiftWrap(wraps.wrapForSelf, BOB, RELAYS, { live: false })
    await processGiftWrap(wraps.wrapForSelf, BOB, RELAYS, { live: false })
    const msgs = useNostrStore.getState().messages[ALICE] ?? []
    expect(msgs).toHaveLength(1)          // addMessage idempotent by id
    expect(msgs[0].pubkey).toBe(BOB)      // sent copy shows under the peer chat, authored by me
  })

  it('routes a wrapped group_rekey control exactly like a legacy kind-4 one', async () => {
    useNostrStore.setState({
      groups: [{ id: 'g1', name: 'Team', creatorPubkey: ALICE, memberPubkeys: [ALICE, BOB], relayUrl: RELAYS[0] }],
      groupKeys: { g1: OLD_KEY },
    })
    const { wrapForRecipient } = await wrapFromAlice(serializeGroupRekey('g1', NEW_KEY, 'Team', [ALICE, BOB]))
    await processGiftWrap(wrapForRecipient, BOB, RELAYS, { live: true })
    const s = useNostrStore.getState()
    expect(s.groupKeys.g1).toBe(NEW_KEY)
    expect(s.messages[ALICE] ?? []).toHaveLength(0) // control, not a chat message
  })

  it('ignores wraps that fail to unwrap (not addressed to us)', async () => {
    setSigner(new LocalSigner(new Uint8Array(skAlice)))
    const foreign = await buildGiftWraps(ALICE, 'alice to alice') // wrapped to Alice, Bob receives it
    setSigner(new LocalSigner(new Uint8Array(skBob)))
    await processGiftWrap(foreign.wrapForRecipient, BOB, RELAYS, { live: false })
    expect(Object.keys(useNostrStore.getState().messages)).toHaveLength(0)
  })
})
