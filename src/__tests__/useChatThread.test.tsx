import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Event as NostrEvent } from 'nostr-tools'
import type { Message } from '../store/nostrStore'

const h = vi.hoisted(() => ({
  addMessage: vi.fn(),
  updateMessageStatus: vi.fn(),
  updateSeenAt: vi.fn(),
  applyReaction: vi.fn(),
  publishEvent: vi.fn(),
}))

const ME = 'me'.padEnd(64, '0')

vi.mock('../store/nostrStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/nostrStore')>()
  const state = {
    publicKey: 'me'.padEnd(64, '0'),
    seenAt: {},
    addMessage: h.addMessage,
    updateMessageStatus: h.updateMessageStatus,
    updateSeenAt: h.updateSeenAt,
  }
  const hook = (selector?: (s: unknown) => unknown) => (selector ? selector(state) : state)
  hook.getState = () => ({ messages: {}, reactions: {}, applyReaction: h.applyReaction })
  return { ...actual, useNostrStore: hook }
})
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return { ...actual, publishEvent: (...a: unknown[]) => h.publishEvent(...a) }
})
vi.mock('../lib/signer', () => ({ getSigner: () => ({}) }))

import { useChatThread, type ChatThreadOpts } from '../hooks/useChatThread'

const evt = { id: 'e1', created_at: 111, tags: [], kind: 42 } as unknown as NostrEvent
const someMsg: Message = { id: 'orig', pubkey: ME, content: 'original text', createdAt: 100, tags: [], kind: 42 }

function opts(over: Partial<ChatThreadOpts> = {}): ChatThreadOpts {
  return {
    targetRelays: () => ['wss://r'],
    sendContent: vi.fn().mockResolvedValue(undefined),
    sendReaction: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.publishEvent.mockResolvedValue(undefined)
})

describe('useChatThread', () => {
  it('publish adds an optimistic sending message then marks it sent', async () => {
    const { result } = renderHook(() => useChatThread('chat', opts()))
    await act(() => result.current.publish(evt, { content: 'hi', kind: 42 }))
    expect(h.addMessage).toHaveBeenCalledWith('chat', expect.objectContaining({
      id: 'e1', pubkey: ME, content: 'hi', createdAt: 111, status: 'sending',
    }))
    expect(h.publishEvent).toHaveBeenCalledWith(['wss://r'], evt)
    expect(h.updateMessageStatus).toHaveBeenCalledWith('chat', 'e1', 'sent')
  })

  it('marks the message failed on publish error and retry re-publishes the kept event', async () => {
    h.publishEvent.mockRejectedValueOnce(new Error('relay down'))
    const { result } = renderHook(() => useChatThread('chat', opts()))
    await act(() => result.current.publish(evt, { content: 'hi', kind: 42 }))
    expect(h.updateMessageStatus).toHaveBeenCalledWith('chat', 'e1', 'failed')

    await act(() => result.current.handleRetry('e1'))
    expect(h.publishEvent).toHaveBeenCalledTimes(2)
    expect(h.publishEvent).toHaveBeenLastCalledWith(['wss://r'], evt)
    expect(h.updateMessageStatus).toHaveBeenLastCalledWith('chat', 'e1', 'sent')
  })

  it('retry does nothing for an unknown or already-sent message', async () => {
    const { result } = renderHook(() => useChatThread('chat', opts()))
    await act(() => result.current.publish(evt, { content: 'hi', kind: 42 }))
    h.publishEvent.mockClear()
    await act(() => result.current.handleRetry('e1')) // sent → pending entry deleted
    await act(() => result.current.handleRetry('nope'))
    expect(h.publishEvent).not.toHaveBeenCalled()
  })

  it('includes replyTo preview fields when a reply is set', async () => {
    const { result } = renderHook(() => useChatThread('chat', opts()))
    act(() => result.current.setReplyTo(someMsg))
    await act(() => result.current.publish(evt, { content: 'hi', kind: 42 }))
    expect(h.addMessage).toHaveBeenCalledWith('chat', expect.objectContaining({
      replyTo: { id: 'orig', pubkey: ME, previewText: 'original text' },
    }))
  })

  it('handleReact applies the reaction optimistically and publishes it', () => {
    const sendReaction = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useChatThread('chat', opts({ sendReaction })))
    act(() => result.current.handleReact(someMsg, '👍'))
    expect(h.applyReaction).toHaveBeenCalledWith('orig', '👍', ME, 'add')
    expect(sendReaction).toHaveBeenCalledWith('orig', '👍', 'add')
  })

  it('blocks react/edit/delete when canAct is false', () => {
    const sendReaction = vi.fn()
    const sendContent = vi.fn()
    const { result } = renderHook(() =>
      useChatThread('chat', opts({ canAct: () => false, sendReaction, sendContent })))
    act(() => {
      result.current.handleReact(someMsg, '👍')
      result.current.handleEdit(someMsg, 'new')
      result.current.handleDelete(someMsg)
    })
    expect(result.current.guarded()).toBe(false)
    expect(sendReaction).not.toHaveBeenCalled()
    expect(sendContent).not.toHaveBeenCalled()
    expect(h.applyReaction).not.toHaveBeenCalled()
  })
})
