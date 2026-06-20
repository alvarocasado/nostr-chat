import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Message } from '../store/nostrStore'

const useBlossomAttachment = vi.fn()
vi.mock('../hooks/useBlossomAttachment', () => ({
  useBlossomAttachment: (...a: unknown[]) => useBlossomAttachment(...a),
}))

import { MessageItem } from '../components/Chat/MessageItem'

const remoteImg = {
  text: '', attachment: { name: 'p.png', type: 'image/png', size: 3, url: 'https://srv/H', hash: 'H' },
}
function msg(): Message {
  return { id: 'm1', pubkey: 'them'.padEnd(64, '1'), content: JSON.stringify(remoteImg), createdAt: 1000, tags: [], kind: 42 }
}
const noop = () => {}

it('shows a loading state while a remote attachment resolves', () => {
  useBlossomAttachment.mockReturnValue({ status: 'loading', objectUrl: null, retry: noop })
  render(<MessageItem message={msg()} isOwn={false} showAvatar={false} onReply={noop} />)
  expect(screen.getByText(/loading/i)).toBeInTheDocument()
})

it('shows an error state with a retry button on failure', () => {
  const retry = vi.fn()
  useBlossomAttachment.mockReturnValue({ status: 'error', objectUrl: null, retry })
  render(<MessageItem message={msg()} isOwn={false} showAvatar={false} onReply={noop} />)
  expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument()
})

it('renders the image once resolved to an object URL', () => {
  useBlossomAttachment.mockReturnValue({ status: 'ready', objectUrl: 'blob:obj', retry: noop })
  render(<MessageItem message={msg()} isOwn={false} showAvatar={false} onReply={noop} />)
  expect(screen.getByRole('img', { name: 'p.png' })).toHaveAttribute('src', 'blob:obj')
})
