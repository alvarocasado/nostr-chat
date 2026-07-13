import { it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageItem } from '../components/Chat/MessageItem'
import { useNostrStore } from '../store/nostrStore'
import type { Message } from '../store/nostrStore'

const PEER = 'peer'.padEnd(64, '2')
const ME = 'me'.padEnd(64, '1')
const noop = () => {}

function ownDM(createdAt: number): Message {
  return { id: 'm1', pubkey: ME, content: 'hi', createdAt, tags: [], kind: 4, recipientPubkey: PEER, status: 'sent' }
}

beforeEach(() => {
  useNostrStore.setState({
    readReceiptsEnabled: true,
    readUntilByPeer: {},
    reactions: {},
    deletedMessages: {},
    editedMessages: {},
  })
})

it('shows a read tick when the peer watermark covers the message', () => {
  useNostrStore.setState({ readUntilByPeer: { [PEER]: 1000 } })
  render(<MessageItem message={ownDM(900)} isOwn={true} showAvatar={false} onReply={noop} />)
  expect(screen.getByLabelText('Read')).toBeInTheDocument()
})

it('shows a plain sent tick when the watermark is older than the message', () => {
  useNostrStore.setState({ readUntilByPeer: { [PEER]: 1000 } })
  render(<MessageItem message={ownDM(1100)} isOwn={true} showAvatar={false} onReply={noop} />)
  expect(screen.queryByLabelText('Read')).toBeNull()
})

it('shows no read tick when receipts are disabled (reciprocity)', () => {
  useNostrStore.setState({ readReceiptsEnabled: false, readUntilByPeer: { [PEER]: 1000 } })
  render(<MessageItem message={ownDM(900)} isOwn={true} showAvatar={false} onReply={noop} />)
  expect(screen.queryByLabelText('Read')).toBeNull()
})
