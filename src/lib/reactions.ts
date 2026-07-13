// Reactions travel as control messages through the normal per-chat transport
// (kind-42 for channels, encrypted kind-4 for DMs, group-key-encrypted for
// groups) rather than public NIP-25 kind-7 events. This keeps DM and group
// reactions end-to-end encrypted — a public kind-7 would leak that two people
// are talking and what they reacted to — and reuses the existing subscription
// and encryption paths instead of adding a new one.
// ponytail: app-internal reaction format, not interoperable NIP-25 kind-7;
// switch channels to real kind-7 if cross-client reaction interop is needed.

export interface ReactionPayload {
  type: 'reaction'
  target: string          // event id being reacted to
  emoji: string           // the reaction, e.g. "👍"
  op: 'add' | 'remove'
}

// A small curated set keeps the picker simple and the payloads bounded.
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '🔥', '😮', '😢'] as const

const MAX_EMOJI_LEN = 16  // longest multi-codepoint emoji + ZWJ sequences

export function serializeReaction(target: string, emoji: string, op: 'add' | 'remove'): string {
  return JSON.stringify({ type: 'reaction', target, emoji, op } satisfies ReactionPayload)
}

/** Parse a message content string into a reaction payload, or return null. */
export function parseReactionPayload(content: string): ReactionPayload | null {
  if (!content.startsWith('{')) return null
  try {
    const obj = JSON.parse(content)
    if (
      obj.type === 'reaction' &&
      typeof obj.target === 'string' && obj.target.length > 0 &&
      typeof obj.emoji === 'string' && obj.emoji.length > 0 && obj.emoji.length <= MAX_EMOJI_LEN &&
      (obj.op === 'add' || obj.op === 'remove')
    ) return obj as ReactionPayload
  } catch { /* not JSON */ }
  return null
}

export interface AggregatedReaction {
  emoji: string
  count: number
  mine: boolean
}

/**
 * Collapse a message's `emoji → reactor pubkeys` map into a display list,
 * ordered by the curated emoji order then by first appearance.
 */
export function aggregateReactions(
  byEmoji: Record<string, string[]> | undefined,
  myPubkey: string,
): AggregatedReaction[] {
  if (!byEmoji) return []
  const order = (e: string) => {
    const i = (REACTION_EMOJIS as readonly string[]).indexOf(e)
    return i === -1 ? REACTION_EMOJIS.length : i
  }
  return Object.entries(byEmoji)
    .filter(([, pks]) => pks.length > 0)
    .map(([emoji, pks]) => ({ emoji, count: pks.length, mine: pks.includes(myPubkey) }))
    .sort((a, b) => order(a.emoji) - order(b.emoji))
}
