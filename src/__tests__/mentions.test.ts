import { describe, it, expect } from 'vitest'
import { nip19 } from 'nostr-tools'
import { generateKeys, encodePubkey } from '../lib/nostr'
import { extractMentionedPubkeys, isMentioned, mentionTags, linkifyMentions } from '../lib/mentions'

describe('mentions', () => {
  const { pk } = generateKeys()
  const npub = encodePubkey(pk)
  const nprofile = nip19.nprofileEncode({ pubkey: pk, relays: ['wss://relay.damus.io'] })

  it('extracts a bare npub reference', () => {
    expect(extractMentionedPubkeys(`hi ${npub} there`)).toEqual([pk])
  })

  it('extracts a nostr: prefixed reference', () => {
    expect(extractMentionedPubkeys(`hi nostr:${npub}!`)).toEqual([pk])
  })

  it('extracts an nprofile reference', () => {
    expect(extractMentionedPubkeys(`cc nostr:${nprofile}`)).toEqual([pk])
  })

  it('dedupes repeated references', () => {
    expect(extractMentionedPubkeys(`${npub} and again ${npub}`)).toEqual([pk])
  })

  it('ignores invalid bech32', () => {
    expect(extractMentionedPubkeys('npub1notarealkey')).toEqual([])
  })

  it('does not false-positive on a hex substring (the old bug)', () => {
    // Old detection was content.includes(pubkey); a message merely quoting the
    // hex should not count unless it is an actual npub/nprofile or p tag.
    expect(isMentioned(pk, `the key is ${pk}`, [])).toBe(false)
  })

  it('detects a mention via p tag', () => {
    expect(isMentioned(pk, 'hey you', [['p', pk]])).toBe(true)
  })

  it('detects a mention via npub in content', () => {
    expect(isMentioned(pk, `ping ${npub}`, [])).toBe(true)
  })

  it('is false when someone else is mentioned', () => {
    const other = generateKeys()
    expect(isMentioned(pk, `ping ${encodePubkey(other.pk)}`, [])).toBe(false)
  })

  it('builds p tags for mentioned pubkeys', () => {
    expect(mentionTags(`hi ${npub}`)).toEqual([['p', pk]])
  })

  it('linkifies mentions into nostr: markdown links', () => {
    expect(linkifyMentions(`hi ${npub}`)).toBe(`hi [${npub}](nostr:${npub})`)
    expect(linkifyMentions(`hi nostr:${npub}`)).toBe(`hi [${npub}](nostr:${npub})`)
  })

  it('leaves plain text untouched', () => {
    expect(linkifyMentions('just a normal message')).toBe('just a normal message')
  })
})
