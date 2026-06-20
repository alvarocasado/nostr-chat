import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import type { Message } from '../store/nostrStore'
import { START_INDEX } from '../lib/pagination'

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

const loadOlder = vi.fn().mockResolvedValue(2)
vi.mock('../hooks/useChatHistory', () => ({
  useChatHistory: () => ({ loadOlder, loading: false, exhausted: false }),
}))

import { MessageList } from '../components/Chat/MessageList'

const ME = 'me'.padEnd(64, '0')
const THEM = 'them'.padEnd(64, '1')

function msg(over: Partial<Message>): Message {
  return { id: Math.random().toString(36), pubkey: THEM, content: 'hello', createdAt: 1000, tags: [], kind: 42, ...over }
}

const noop = () => {}

beforeEach(() => { vi.clearAllMocks() })

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
})
