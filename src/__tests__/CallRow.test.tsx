import { it, expect, vi, beforeEach, describe } from 'vitest'
import { render, screen } from '@testing-library/react'

const initiateCall = vi.fn()
vi.mock('../contexts/CallContext', () => ({
  useCallContext: () => ({ initiateCall }),
}))

import { CallRow } from '../components/Chat/CallRow'
import { useNostrStore } from '../store/nostrStore'
import type { Message } from '../store/nostrStore'
import type { CallLogPayload } from '../lib/callLog'

const PEER = 'a'.repeat(64)

function msg(over: Partial<Message> = {}): Message {
  return {
    id: 'm1', pubkey: PEER, content: '{}', createdAt: 1700000000,
    tags: [], kind: 4, recipientPubkey: PEER, ...over,
  }
}

function log(over: Partial<CallLogPayload> = {}): CallLogPayload {
  return { type: 'call-log', callId: 'c1', mediaType: 'audio', outcome: 'missed', ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  useNostrStore.setState({ activeCallType: 'none' })
})

describe('1:1 call rows', () => {
  it('renders the missed label for the callee', () => {
    render(<CallRow message={msg()} isOwn={false} callLog={log()} senderName="Alice" />)
    expect(screen.getByText('Missed voice call')).toBeInTheDocument()
  })

  it('renders the completed label with duration', () => {
    render(<CallRow message={msg()} isOwn={true}
      callLog={log({ outcome: 'completed', duration: 61, mediaType: 'video' })} senderName="Alice" />)
    expect(screen.getByText('Video call · 1:01')).toBeInTheDocument()
  })

  it('clicking calls the peer back with the same media type', () => {
    render(<CallRow message={msg()} isOwn={false} callLog={log({ mediaType: 'video' })} senderName="Alice" />)
    screen.getByRole('button').click()
    expect(initiateCall).toHaveBeenCalledWith(PEER, 'video')
  })

  it('is disabled while any call is active', () => {
    useNostrStore.setState({ activeCallType: 'group' })
    render(<CallRow message={msg()} isOwn={false} callLog={log()} senderName="Alice" />)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})

describe('group call-start rows', () => {
  it('renders a static started-a-call row with the sender name', () => {
    render(<CallRow message={msg()} isOwn={false} callLog={null} senderName="Alice" />)
    expect(screen.getByText(/Alice started a call/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says You for own call-start rows', () => {
    render(<CallRow message={msg()} isOwn={true} callLog={null} senderName="Alice" />)
    expect(screen.getByText(/You started a call/)).toBeInTheDocument()
  })
})
