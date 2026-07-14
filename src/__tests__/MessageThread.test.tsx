import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const store = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
}))

vi.mock('../store/nostrStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/nostrStore')>()
  const hook = (selector?: (s: unknown) => unknown) => (selector ? selector(store.state) : store.state)
  hook.getState = () => store.state
  return { ...actual, useNostrStore: hook }
})
vi.mock('../hooks/useNostrSubscriptions', () => ({
  useChannelMessages: vi.fn(), useDMMessages: vi.fn(), useGroupMessages: vi.fn(),
  sendChannelReaction: vi.fn(), sendDMReaction: vi.fn(), sendGroupReaction: vi.fn(),
  sendChannelMessage: vi.fn(), sendDM: vi.fn(), sendGroupControl: vi.fn(),
}))
vi.mock('../hooks/useTypingIndicator', () => ({
  useTypingIndicator: () => ({ typists: [], notifyTyping: vi.fn() }),
}))
vi.mock('../hooks/useRelays', () => ({ useWriteRelays: () => ['wss://r'] }))
vi.mock('../hooks/useReadReceipts', () => ({ useReadReceipts: vi.fn() }))
vi.mock('../hooks/useRateLimit', () => ({
  useRateLimit: () => ({ isLimited: false, cooldownSec: 0, tryRecord: () => true }),
}))
vi.mock('../hooks/useAudioRecorder', () => ({
  MAX_RECORDING_SECONDS: 60,
  useAudioRecorder: () => ({
    state: 'idle', audioBlob: null, mimeType: '', elapsed: 0, error: null,
    start: vi.fn(), stop: vi.fn(), reset: vi.fn(),
  }),
}))
vi.mock('../contexts/CallContext', () => ({
  useCallContext: () => ({ callState: 'idle', initiateCall: vi.fn() }),
}))
vi.mock('../contexts/GroupCallContext', () => ({
  useGroupCallContext: () => ({
    startOrJoin: vi.fn(), liveCall: null, joinState: 'can-join', watchGroup: vi.fn(),
  }),
}))
vi.mock('../components/Call/GroupCallBanner', () => ({ GroupCallBanner: () => null }))
vi.mock('../components/Chat/MessageList', () => ({
  MessageList: () => <div data-testid="message-list" />,
}))

import { MessageThread } from '../components/Chat/MessageThread'

const ME = 'me'.padEnd(64, '0')
const THEM = 'them'.padEnd(64, '1')

function baseState(over: Record<string, unknown> = {}) {
  return {
    publicKey: ME,
    activeChatId: null, activeChatType: null,
    channels: [], groups: [], contacts: [],
    messages: {}, profiles: {}, drafts: {}, seenAt: {}, groupKeys: {},
    targetMessageId: null,
    signerCaps: { nip04: true },
    clearActiveChat: vi.fn(), addMessage: vi.fn(), updateMessageStatus: vi.fn(),
    updateSeenAt: vi.fn(), setDraft: vi.fn(), clearDraft: vi.fn(),
    acceptMessageRequest: vi.fn(), dismissMessageRequest: vi.fn(), blockPubkey: vi.fn(),
    setViewingProfilePubkey: vi.fn(),
    ...over,
  }
}

beforeEach(() => {
  store.state = baseState()
})

describe('MessageThread', () => {
  it('shows the empty state when no chat is active', () => {
    render(<MessageThread />)
    expect(screen.getByText(/select a chat/i)).toBeInTheDocument()
  })

  it('renders the channel thread with header, list and input', () => {
    store.state = baseState({
      activeChatId: 'chan1', activeChatType: 'channel',
      channels: [{ id: 'chan1', name: 'General', about: 'chit-chat' }],
    })
    render(<MessageThread />)
    expect(screen.getByText('General')).toBeInTheDocument()
    expect(screen.getByTestId('message-list')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/message channel/i)).toBeInTheDocument()
  })

  it('renders the DM thread with the message-request banner for pending contacts', () => {
    store.state = baseState({
      activeChatId: THEM, activeChatType: 'dm',
      contacts: [{ pubkey: THEM, pending: true }],
    })
    render(<MessageThread />)
    expect(screen.getByText(/isn't in your contacts/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /block/i })).toBeInTheDocument()
  })

  it('shows the group key-unavailable notice when the group key is missing', () => {
    store.state = baseState({
      activeChatId: 'g1', activeChatType: 'group',
      groups: [{ id: 'g1', name: 'Team', memberPubkeys: [ME] }],
    })
    render(<MessageThread />)
    expect(screen.getByText(/group key unavailable/i)).toBeInTheDocument()
  })

  it('renders the group thread with input when the key is present', () => {
    store.state = baseState({
      activeChatId: 'g1', activeChatType: 'group',
      groups: [{ id: 'g1', name: 'Team', memberPubkeys: [ME] }],
      groupKeys: { g1: 'a'.repeat(64) },
    })
    render(<MessageThread />)
    expect(screen.getByText('Team')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/message group/i)).toBeInTheDocument()
  })

  it('shows a removed banner and no input when the user was removed from the group', () => {
    store.state = baseState({
      activeChatId: 'g1', activeChatType: 'group',
      groups: [{ id: 'g1', name: 'Team', memberPubkeys: [ME], creatorPubkey: THEM, removed: true }],
      groupKeys: { g1: 'a'.repeat(64) },
    })
    render(<MessageThread />)
    expect(screen.getByText(/you were removed from this group/i)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/message group/i)).not.toBeInTheDocument()
    expect(screen.getByTestId('message-list')).toBeInTheDocument()
  })
})
