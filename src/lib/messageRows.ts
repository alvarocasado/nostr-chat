import type { Message } from '../store/nostrStore'

export function sameDay(aSec: number, bSec: number): boolean {
  return new Date(aSec * 1000).toDateString() === new Date(bSec * 1000).toDateString()
}

export interface RowDecoration {
  showDateSeparator: boolean
  showDivider: boolean
  showAvatar: boolean
}

/**
 * Per-row display flags for the message list. Pure: depends only on the message,
 * its predecessor, the unread-divider timestamp, and the local pubkey.
 */
export function decorateRow(
  msg: Message,
  prevMsg: Message | undefined,
  dividerTimestamp: number | undefined,
  myPubkey: string,
): RowDecoration {
  const showDateSeparator = !prevMsg || !sameDay(prevMsg.createdAt, msg.createdAt)
  const showDivider =
    dividerTimestamp !== undefined &&
    msg.createdAt > dividerTimestamp &&
    (!prevMsg || prevMsg.createdAt <= dividerTimestamp)
  const showAvatar =
    msg.pubkey !== myPubkey && (showDateSeparator || msg.pubkey !== prevMsg?.pubkey)
  return { showDateSeparator, showDivider, showAvatar }
}
