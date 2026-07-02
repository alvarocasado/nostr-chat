import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import type { Message } from '../store/nostrStore'
import { START_INDEX } from '../lib/pagination'

const clearTargetMessage = vi.fn()
const storeMessages: Record<string, Message[]> = {}
vi.mock('../store/nostrStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/nostrStore')>()
  const hook = (selector?: (s: Record<string, unknown>) => unknown) => {
    const state: Record<string, unknown> = {
      clearTargetMessage,
      deletedMessages: {},
      editedMessages: {},
      reactions: {},
      publicKey: null,
    }
    return selector ? selector(state) : state
  }
  hook.getState = () => ({ messages: storeMessages })
  return { ...actual, useNostrStore: hook }
})

// Props-capturing mock: records the last props so startReached/firstItemIndex are testable.
let lastVirtuosoProps: Record<string, unknown> = {}
vi.mock('react-virtuoso', () => ({
  Virtuoso: (props: Record<string, unknown>) => {
    lastVirtuosoProps = props
    const data = props.data as Message[]
    const firstItemIndex = (props.firstItemIndex as number) ?? 0
    const itemContent = props.itemContent as (i: number, m: Message) => React.ReactNode
    // Real Virtuoso passes the absolute index (firstItemIndex + position), not the array index.
    return <div data-testid="virtuoso">{data.map((m, i) => <div key={m.id}>{itemContent(firstItemIndex + i, m)}</div>)}</div>
  },
}))

let exhausted = false
const loadOlder = vi.fn()
vi.mock('../hooks/useChatHistory', () => ({
  useChatHistory: () => ({ loadOlder, loading: false, exhausted }),
}))

import { MessageList } from '../components/Chat/MessageList'

const ME = 'me'.padEnd(64, '0')
const THEM = 'them'.padEnd(64, '1')

function msg(over: Partial<Message>): Message {
  return { id: Math.random().toString(36), pubkey: THEM, content: 'hello', createdAt: 1000, tags: [], kind: 42, ...over }
}

const noop = () => {}

beforeEach(() => {
  vi.clearAllMocks()
  exhausted = false
  loadOlder.mockResolvedValue(2)
})

describe('MessageList', () => {
  it('shows the empty state when there are no messages', () => {
    render(<MessageList chatId="chat" chatType="channel" messages={[]} myPubkey={ME} profiles={{}} onReply={noop} onRetry={noop} />)
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument()
  })

  it('renders each message content through itemContent', () => {
    const messages = [msg({ id: 'a', content: 'first' }), msg({ id: 'b', content: 'second' })]
    render(<MessageList chatId="chat" chatType="channel" messages={messages} myPubkey={ME} profiles={{}} onReply={noop} onRetry={noop} />)
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()
  })

  it('calls loadOlder when startReached fires and decrements firstItemIndex', async () => {
    const messages = [msg({ id: 'a', createdAt: 1 }), msg({ id: 'b', createdAt: 2 })]
    render(<MessageList chatId="chat" chatType="channel" messages={messages} myPubkey={ME} profiles={{}} onReply={noop} onRetry={noop} />)
    const startReached = lastVirtuosoProps.startReached as (i: number) => void
    await act(async () => { await startReached(0) })
    expect(loadOlder).toHaveBeenCalledTimes(1)
    // firstItemIndex starts at START_INDEX and drops by the 2 prepended items
    expect(lastVirtuosoProps.firstItemIndex).toBe(START_INDEX - 2)
  })

  it('never passes a negative initialTopMostItemIndex when a chat opens empty then populates', () => {
    // Regression: an empty first render must not cache initialTopMostItemIndex = -1,
    // which corrupts react-virtuoso's index math (blank list) once messages arrive.
    const { rerender } = render(<MessageList chatId="c" chatType="dm" messages={[]} myPubkey={ME} profiles={{}} onReply={noop} onRetry={noop} />)
    const messages = [msg({ id: 'a', createdAt: 1 }), msg({ id: 'b', createdAt: 2 })]
    rerender(<MessageList chatId="c" chatType="dm" messages={messages} myPubkey={ME} profiles={{}} onReply={noop} onRetry={noop} />)
    expect(lastVirtuosoProps.initialTopMostItemIndex as number).toBeGreaterThanOrEqual(0)
  })

  it('does not repeat date separators or the new-messages divider on every row', () => {
    // Regression: Virtuoso's absolute index was used to read messages[index-1], so prev was
    // always undefined, putting a "Today" separator and "New messages" divider on every message.
    const today = Math.floor(Date.now() / 1000)
    const messages = [
      msg({ id: 'a', createdAt: today - 30 }),
      msg({ id: 'b', createdAt: today - 20 }),
      msg({ id: 'c', createdAt: today - 10 }),
    ]
    render(<MessageList chatId="chat" chatType="channel" messages={messages} myPubkey={ME} profiles={{}} onReply={noop} onRetry={noop} dividerTimestamp={today - 25} />)
    expect(screen.getAllByText('New messages')).toHaveLength(1)
    expect(screen.getAllByText('Today')).toHaveLength(1)
  })

  it('does not show the divider when the only new messages are my own', () => {
    const today = Math.floor(Date.now() / 1000)
    const messages = [
      msg({ id: 'a', pubkey: THEM, createdAt: today - 30 }),
      msg({ id: 'b', pubkey: ME, createdAt: today - 10 }),
      msg({ id: 'c', pubkey: ME, createdAt: today - 5 }),
    ]
    render(<MessageList chatId="chat" chatType="dm" messages={messages} myPubkey={ME} profiles={{}} onReply={noop} onRetry={noop} dividerTimestamp={today - 25} />)
    expect(screen.queryByText('New messages')).not.toBeInTheDocument()
  })

  it('anchors the divider on the first received message past the timestamp, skipping my own', () => {
    const today = Math.floor(Date.now() / 1000)
    const messages = [
      msg({ id: 'a', pubkey: ME, createdAt: today - 20 }),
      msg({ id: 'b', pubkey: THEM, createdAt: today - 10 }),
      msg({ id: 'c', pubkey: ME, createdAt: today - 5 }),
      msg({ id: 'd', pubkey: THEM, createdAt: today - 2 }),
    ]
    render(<MessageList chatId="chat" chatType="dm" messages={messages} myPubkey={ME} profiles={{}} onReply={noop} onRetry={noop} dividerTimestamp={today - 25} />)
    expect(screen.getAllByText('New messages')).toHaveLength(1)
  })

  it('shows a not-found notice when the jump target never loads', async () => {
    exhausted = false
    loadOlder.mockResolvedValue(0) // paging yields nothing new
    const messages = [msg({ id: 'a', createdAt: 1 })]
    render(<MessageList chatId="chat" chatType="channel" messages={messages} myPubkey={ME} profiles={{}} onReply={noop} onRetry={noop} targetMessageId="missing" />)
    expect(await screen.findByText(/message not available/i)).toBeInTheDocument()
  })
})
