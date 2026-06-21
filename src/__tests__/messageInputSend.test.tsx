import { it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AttachmentData } from '../lib/fileUtils'
import { parseMessageContent } from '../lib/fileUtils'

const uploadAttachment = vi.fn()
vi.mock('../lib/fileSend', () => ({ uploadAttachment: (...a: unknown[]) => uploadAttachment(...a) }))
vi.mock('../lib/blossom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/blossom')>()
  return { ...actual, getMediaServer: vi.fn().mockResolvedValue('https://srv') }
})

import { MessageInput } from '../components/Chat/MessageThread'

beforeEach(() => {
  uploadAttachment.mockReset()
  uploadAttachment.mockResolvedValue({ name: 'big.bin', type: 'application/pdf', size: 999, url: 'https://srv/H', hash: 'H' } as AttachmentData)
})

// A large inline attachment (> 150 KB) forces the upload path.
const bigData = 'data:application/pdf;base64,' + 'A'.repeat(200_000)

it('uploads a large attachment and sends a remote reference', async () => {
  const onSend = vi.fn().mockResolvedValue(undefined)
  render(
    <MessageInput
      chatId="chan1" chatType="channel"
      onSend={onSend} onTyping={() => {}}
      placeholder="msg" replyTo={null} onCancelReply={() => {}}
      preloadedAttachment={{ name: 'big.bin', type: 'application/pdf', size: 999, data: bigData }}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: /send/i }))
  await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
  const sent = parseMessageContent(onSend.mock.calls[0][0] as string)
  expect(sent.attachment?.url).toBe('https://srv/H')
})
