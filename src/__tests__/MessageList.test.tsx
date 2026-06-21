import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import type { Message } from '../store/nostrStore'
import { START_INDEX } from '../lib/pagination'

const clearTargetMessage = vi.fn()
const storeMessages: Record<string, Message[]> = {}
vi.mock('../store/nostrStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/nostrStore')>()
  const hook = (selector?: (s: { clearTargetMessage: () => void }) => unknown) => {
    const state = { clearTargetMessage }
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
    const itemContent = props.itemContent as (i: number, m: Message) => React.ReactNode
    return <div data-testid="virtuoso">{data.map((m, i) => <div key={m.id}>{itemContent(i, m)}</div>)}</div>
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

  it('shows a not-found notice when the jump target never loads', async () => {
    exhausted = false
    loadOlder.mockResolvedValue(0) // paging yields nothing new
    const messages = [msg({ id: 'a', createdAt: 1 })]
    render(<MessageList chatId="chat" chatType="channel" messages={messages} myPubkey={ME} profiles={{}} onReply={noop} onRetry={noop} targetMessageId="missing" />)
    expect(await screen.findByText(/message not available/i)).toBeInTheDocument()
  })
})
