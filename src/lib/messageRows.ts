import type { Message } from '../store/nostrStore'

export function sameDay(aSec: number, bSec: number): boolean {
  return new Date(aSec * 1000).toDateString() === new Date(bSec * 1000).toDateString()
}

export interface RowDecoration {
  showDateSeparator: boolean
  showAvatar: boolean
}

/**
 * Per-row display flags for the message list. Pure: depends only on the message,
 * its predecessor, and the local pubkey. The unread divider is positioned by
 * unreadAnchorId (see below) since it needs whole-list context, not just prevMsg.
 */
export function decorateRow(
  msg: Message,
  prevMsg: Message | undefined,
  myPubkey: string,
): RowDecoration {
  const showDateSeparator = !prevMsg || !sameDay(prevMsg.createdAt, msg.createdAt)
  const showAvatar =
    msg.pubkey !== myPubkey && (showDateSeparator || msg.pubkey !== prevMsg?.pubkey)
  return { showDateSeparator, showAvatar }
}

/**
 * Id of the message the "New messages" divider sits above: the first message
 * newer than the last-seen timestamp that was received (not sent by me). Your
 * own messages are always newer than the seen-timestamp, so anchoring on them
 * would show the divider when you send. Undefined = no divider.
 */
export function unreadAnchorId(
  messages: Message[],
  dividerTimestamp: number | undefined,
  myPubkey: string,
): string | undefined {
  if (dividerTimestamp === undefined) return undefined
  return messages.find(m => m.createdAt > dividerTimestamp && m.pubkey !== myPubkey)?.id
}
