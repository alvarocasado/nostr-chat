import { it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Message } from '../store/nostrStore'
import { useNostrStore } from '../store/nostrStore'

const useBlossomAttachment = vi.fn()
vi.mock('../hooks/useBlossomAttachment', () => ({
  useBlossomAttachment: (...a: unknown[]) => useBlossomAttachment(...a),
}))

import { MessageItem } from '../components/Chat/MessageItem'

const STRANGER = 'e'.repeat(64)
const FRIEND = 'b'.repeat(64)
const noop = () => {}
const msg = (pubkey: string, content: string): Message => ({ id: 'm-' + pubkey.slice(0, 4), pubkey, content, createdAt: 1000, tags: [], kind: 4 })
const remoteFile = JSON.stringify({ text: '', attachment: { name: 'p.png', type: 'image/png', size: 3, url: 'https://files.example/H', hash: 'H' } })

beforeEach(() => {
  useBlossomAttachment.mockReset()
  useBlossomAttachment.mockReturnValue({ status: 'ready', objectUrl: 'blob:obj', retry: noop })
  useNostrStore.setState({ linkPreviews: 'contacts', contacts: [{ pubkey: FRIEND }, { pubkey: STRANGER, pending: true }] } as never)
})

it('shows a stranger\'s markdown image as a link instead of loading it', () => {
  const { container } = render(<MessageItem message={msg(STRANGER, 'look ![cat](https://tracker.example/p.png)')} isOwn={false} showAvatar={false} onReply={noop} />)
  expect(container.querySelector('img')).toBeNull()
  expect(screen.getByRole('link', { name: 'cat' })).toHaveAttribute('href', 'https://tracker.example/p.png')
})

it('loads a contact\'s markdown image', () => {
  const { container } = render(<MessageItem message={msg(FRIEND, '![cat](https://img.example/p.png)')} isOwn={false} showAvatar={false} onReply={noop} />)
  expect(container.querySelector('img')).toHaveAttribute('src', 'https://img.example/p.png')
})

it('waits for a tap before fetching a stranger\'s off-relay file', () => {
  render(<MessageItem message={msg(STRANGER, remoteFile)} isOwn={false} showAvatar={false} onReply={noop} />)
  expect(useBlossomAttachment).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText(/tap to load from files\.example/i))
  expect(useBlossomAttachment).toHaveBeenCalled()
  expect(screen.getByRole('img', { name: 'p.png' })).toHaveAttribute('src', 'blob:obj')
})

it('fetches a stranger\'s file right away when previews are set to all', () => {
  useNostrStore.setState({ linkPreviews: 'all' } as never)
  render(<MessageItem message={msg(STRANGER, remoteFile)} isOwn={false} showAvatar={false} onReply={noop} />)
  expect(useBlossomAttachment).toHaveBeenCalled()
})
