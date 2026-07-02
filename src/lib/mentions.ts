import { nip19 } from 'nostr-tools'

// NIP-27: mentions are `nostr:npub1…` / `nostr:nprofile1…` references embedded in
// content, mirrored by `p` tags on the event. Detection used to be a naive
// `content.includes(pubkey)` substring check, which both missed real mentions
// (npub-encoded, not hex) and produced false positives. These helpers decode
// the actual references.

// Matches npub/nprofile tokens with an optional `nostr:` URI prefix.
// Fresh instances per use — a shared /g regex carries lastIndex between calls.
const bech32 = '[023456789acdefghjklmnpqrstuvwxyz]'
const mentionPattern = `(?:nostr:)?((?:npub1|nprofile1)${bech32}+)`
const MENTION_RE = new RegExp(mentionPattern, 'g')

/** Decode every npub/nprofile reference in `content` to hex pubkeys (deduped). */
export function extractMentionedPubkeys(content: string): string[] {
  const out = new Set<string>()
  for (const m of content.matchAll(MENTION_RE)) {
    try {
      const decoded = nip19.decode(m[1])
      if (decoded.type === 'npub') out.add(decoded.data)
      else if (decoded.type === 'nprofile') out.add(decoded.data.pubkey)
    } catch { /* invalid bech32 — ignore */ }
  }
  return [...out]
}

/** True when `myPubkey` is referenced, via a `p` tag or an npub/nprofile in content. */
export function isMentioned(myPubkey: string, content: string, tags: string[][]): boolean {
  if (!myPubkey) return false
  if (tags.some(t => t[0] === 'p' && t[1] === myPubkey)) return true
  return extractMentionedPubkeys(content).includes(myPubkey)
}

/** `p` tags for every pubkey mentioned in `content` — attach to outgoing public events. */
export function mentionTags(content: string): string[][] {
  return extractMentionedPubkeys(content).map(pk => ['p', pk])
}

/**
 * Rewrite bare/`nostr:`-prefixed mention tokens into markdown links with a
 * `nostr:` href, so the markdown renderer can turn them into mention chips.
 */
export function linkifyMentions(content: string): string {
  return content.replace(new RegExp(mentionPattern, 'g'), (_m, token: string) => `[${token}](nostr:${token})`)
}
