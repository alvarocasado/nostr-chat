// Single choke point for all private sends (chat DMs, DM reactions/edits/
// deletes, call logs, group invite/rekey/remove). Gift wrap iff our signer
// can nip44 AND the peer advertises kind 10050; otherwise legacy kind 4
// targeted exactly as before.
import type { Event } from 'nostr-tools'
import { buildDMEvent, publishEvent } from './nostr'
import { buildGiftWraps, RUMOR_KIND } from './giftWrap'
import { fetchDmCaps } from './dmCaps'
import { getPeerRelays, combineRelays } from './peerRelays'
import { requireSigner } from './signer'
import { useNostrStore } from '../store/nostrStore'

export interface Publishable {
  event: Event
  relays: string[]
}

export interface PrivateSend {
  msgId: string
  createdAt: number
  kind: number
  publishables: Publishable[]
}

export async function buildPrivateSend(peerPubkey: string, content: string): Promise<PrivateSend> {
  const signer = requireSigner()
  const state = useNostrStore.getState()
  const myWrite = state.writeRelays()

  if (signer.caps.nip44) {
    const caps = await fetchDmCaps(peerPubkey, state.readRelays())
    if (caps.nip17) {
      const { rumorId, createdAt, wrapForRecipient, wrapForSelf } = await buildGiftWraps(peerPubkey, content)
      const recipientRelays = caps.relays.length > 0
        ? combineRelays(myWrite, caps.relays)
        : combineRelays(myWrite, (await getPeerRelays(peerPubkey, state.readRelays())).read)
      return {
        msgId: rumorId,
        createdAt,
        kind: RUMOR_KIND,
        publishables: [
          { event: wrapForRecipient, relays: recipientRelays },
          { event: wrapForSelf, relays: myWrite },
        ],
      }
    }
  }

  const event = await buildDMEvent(peerPubkey, content)
  const peerRead = (await getPeerRelays(peerPubkey, state.readRelays())).read
  return {
    msgId: event.id,
    createdAt: event.created_at,
    kind: 4,
    publishables: [{ event, relays: combineRelays(myWrite, peerRead) }],
  }
}

export async function publishPrivateSend(ps: PrivateSend): Promise<void> {
  await Promise.all(ps.publishables.map(p => publishEvent(p.relays, p.event)))
}

export async function sendPrivate(content: string, recipientPubkey: string): Promise<PrivateSend> {
  const ps = await buildPrivateSend(recipientPubkey, content)
  await publishPrivateSend(ps)
  return ps
}
