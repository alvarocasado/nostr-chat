import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Message } from '../store/nostrStore'

// Passthrough mock: render all items so itemContent runs in jsdom.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent }: { data: Message[]; itemContent: (i: number, m: Message) => React.ReactNode }) => (
    <div data-testid="virtuoso">{data.map((m, i) => <div key={m.id}>{itemContent(i, m)}</div>)}</div>
  ),
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
    render(<MessageList messages={[]} myPubkey={ME} profiles={{}} onReply={noop} onRetry={noop} />)
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument()
  })

  it('renders each message content through itemContent', () => {
    const messages = [msg({ id: 'a', content: 'first' }), msg({ id: 'b', content: 'second' })]
    render(<MessageList messages={messages} myPubkey={ME} profiles={{}} onReply={noop} onRetry={noop} />)
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()
  })
})
