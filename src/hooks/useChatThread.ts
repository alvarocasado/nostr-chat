import { useEffect, useRef, useState } from 'react'
import type { Event as NostrEvent } from 'nostr-tools'
import { useNostrStore, type Message } from '../store/nostrStore'
import { publishEvent } from '../lib/nostr'
import { getSigner } from '../lib/signer'
import { serializeEdit, serializeDelete } from '../lib/messageOps'
import { getPreviewText } from '../lib/fileUtils'

// Toggle my reaction on a message: optimistic local apply, then publish; revert on failure.
async function reactWith(
  publicKey: string,
  msg: Message,
  emoji: string,
  send: (target: string, emoji: string, op: 'add' | 'remove') => Promise<unknown>,
) {
  const { reactions, applyReaction } = useNostrStore.getState()
  const mine = reactions[msg.id]?.[emoji]?.includes(publicKey) ?? false
  const op: 'add' | 'remove' = mine ? 'remove' : 'add'
  applyReaction(msg.id, emoji, publicKey, op)
  try {
    await send(msg.id, emoji, op)
  } catch {
    applyReaction(msg.id, emoji, publicKey, op === 'add' ? 'remove' : 'add')
  }
}

// Edit my own message: optimistic overlay, then publish the edit; revert on failure.
async function editMessage(
  publicKey: string,
  msg: Message,
  newText: string,
  send: (content: string) => Promise<unknown>,
) {
  const { applyEdit, removeEdit, editedMessages } = useNostrStore.getState()
  const prev = editedMessages[msg.id]
  applyEdit(msg.id, publicKey, newText, Math.floor(Date.now() / 1000))
  try {
    await send(serializeEdit(msg.id, newText))
  } catch {
    removeEdit(msg.id)
    if (prev) applyEdit(msg.id, prev.by, prev.content, prev.at)
  }
}

// Delete my own message: optimistic tombstone, then publish the delete; revert on failure.
async function deleteMessage(
  publicKey: string,
  msg: Message,
  send: (content: string) => Promise<unknown>,
) {
  const { applyDelete, removeDelete } = useNostrStore.getState()
  applyDelete(msg.id, publicKey)
  try {
    await send(serializeDelete(msg.id))
  } catch {
    removeDelete(msg.id)
  }
}

export interface ChatThreadOpts {
  // Extra per-chat-type condition on top of the signer+pubkey guard (e.g. nip04 caps, group key)
  canAct?: () => boolean
  // Where to publish; recomputed per attempt (DMs re-resolve peer relays on retry)
  targetRelays: () => string[] | Promise<string[]>
  // Sends a raw content payload on this chat's kind (used for edits/deletes)
  sendContent: (content: string) => Promise<unknown>
  sendReaction: (target: string, emoji: string, op: 'add' | 'remove') => Promise<unknown>
}

// Shared state + actions for the three thread variants (channel / DM / group):
// reply & gallery state, unread divider, optimistic publish with retry, react/edit/delete.
export function useChatThread(chatId: string, opts: ChatThreadOpts) {
  const { publicKey, addMessage, updateMessageStatus, seenAt, updateSeenAt } = useNostrStore()
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [showGallery, setShowGallery] = useState(false)
  const pendingEventsRef = useRef<Map<string, NostrEvent>>(new Map())
  const dividerTimestampRef = useRef<number | undefined>(seenAt[chatId])

  useEffect(() => {
    return () => {
      const latest = useNostrStore.getState().messages[chatId]?.at(-1)?.createdAt
      if (latest !== undefined) updateSeenAt(chatId, latest)
    }
  }, [chatId]) // eslint-disable-line react-hooks/exhaustive-deps

  const guarded = () => !!getSigner() && !!publicKey && (opts.canAct?.() ?? true)

  // Add the optimistic local message, then publish; keep the event around for retry.
  const publish = async (event: NostrEvent, fields: Pick<Message, 'content' | 'kind'> & Partial<Message>) => {
    addMessage(chatId, {
      id: event.id,
      pubkey: publicKey || '',
      createdAt: event.created_at,
      tags: event.tags,
      status: 'sending',
      ...(replyTo && {
        replyTo: { id: replyTo.id, pubkey: replyTo.pubkey, previewText: getPreviewText(replyTo.content).slice(0, 100) },
      }),
      ...fields,
    })
    pendingEventsRef.current.set(event.id, event)

    try {
      await publishEvent(await opts.targetRelays(), event)
      updateMessageStatus(chatId, event.id, 'sent')
      pendingEventsRef.current.delete(event.id)
    } catch {
      updateMessageStatus(chatId, event.id, 'failed')
    }
  }

  const handleRetry = async (msgId: string) => {
    const event = pendingEventsRef.current.get(msgId)
    if (!event) return
    updateMessageStatus(chatId, msgId, 'sending')
    try {
      await publishEvent(await opts.targetRelays(), event)
      updateMessageStatus(chatId, msgId, 'sent')
      pendingEventsRef.current.delete(msgId)
    } catch {
      updateMessageStatus(chatId, msgId, 'failed')
    }
  }

  const handleReact = (msg: Message, emoji: string) => {
    if (!guarded() || !publicKey) return
    void reactWith(publicKey, msg, emoji, opts.sendReaction)
  }

  const handleEdit = (msg: Message, newText: string) => {
    if (!guarded() || !publicKey) return
    void editMessage(publicKey, msg, newText, opts.sendContent)
  }

  const handleDelete = (msg: Message) => {
    if (!guarded() || !publicKey) return
    void deleteMessage(publicKey, msg, opts.sendContent)
  }

  return {
    replyTo, setReplyTo,
    showGallery, setShowGallery,
    dividerTimestamp: dividerTimestampRef.current,
    guarded, publish, handleRetry, handleReact, handleEdit, handleDelete,
  }
}
