import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from '../components/Chat/Sidebar'
import { useNostrStore } from '../store/nostrStore'

// These tests are intentionally failing — they drive the implementation in Tasks 3–5.

// lucide-react renders SVGs — just verify buttons exist by aria-label / role
vi.mock('../hooks/useRelayHealth', () => ({
  useRelayHealth: () => ({}),
  aggregateRelayHealth: () => ({ connected: 1, resolved: 1, total: 1 }),
}))

async function openPanel(label: string) {
  // The sidebar renders the same nav button in both NavRail (desktop) and BottomNav (mobile).
  // Click the first match — both trigger the same toggleSection handler.
  const user = userEvent.setup()
  const btns = screen.getAllByRole('button', { name: label })
  await user.click(btns[0])
}

beforeEach(() => {
  useNostrStore.setState({
    publicKey: 'testpubkey',
    profile: null,
    channels: [],
    joinedChannelIds: [],
    contacts: [
      { pubkey: 'aaa', lastMessage: 'hi', lastMessageAt: 1000, unread: 0 },
      { pubkey: 'bbb', lastMessage: 'hey', lastMessageAt: 900, unread: 0 },
    ],
    activeChatId: null,
    activeChatType: null,
    messages: {},
    profiles: {
      aaa: { name: 'Alice', picture: undefined, about: undefined, nip05: undefined, pubkey: 'aaa' },
      bbb: { name: 'Bob',   picture: undefined, about: undefined, nip05: undefined, pubkey: 'bbb' },
    },
    relays: [],
    mutedChats: {},
    activeSettingsTab: null,
    setShowAddContact: vi.fn(),
    setShowAddChannel: vi.fn(),
    setActiveChat: vi.fn(),
    setActiveSettingsTab: vi.fn(),
    logout: vi.fn(),
    joinChannel: vi.fn(),
    muteChatUntil: vi.fn(),
    unmuteChat: vi.fn(),
    setViewingProfilePubkey: vi.fn(),
    jumpToMessage: vi.fn(),
    clearTargetMessage: vi.fn(),
    targetMessageId: null,
  })
})

describe('Sidebar — Messages panel scoped search', () => {
  it('shows a search input when the Messages panel is open', async () => {
    render(<Sidebar />)
    await openPanel('Messages')
    expect(screen.getByPlaceholderText('Search conversations…')).toBeInTheDocument()
  })

  it('filters contacts by name as the user types', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)
    await openPanel('Messages')
    await user.type(screen.getByPlaceholderText('Search conversations…'), 'Ali')
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()
  })

  it('shows empty state when no contacts match', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)
    await openPanel('Messages')
    await user.type(screen.getByPlaceholderText('Search conversations…'), 'xyz')
    expect(screen.getByText(/No conversations matching/)).toBeInTheDocument()
  })

  it('clears the filter when the X button is clicked', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)
    await openPanel('Messages')
    const input = screen.getByPlaceholderText('Search conversations…')
    await user.type(input, 'Ali')
    await user.click(screen.getByRole('button', { name: /clear/i }))
    expect(input).toHaveValue('')
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('calls setShowAddContact when the new-message icon is clicked', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)
    await openPanel('Messages')
    await user.click(screen.getByRole('button', { name: 'New Message' }))
    expect(useNostrStore.getState().setShowAddContact).toHaveBeenCalled()
  })
})

describe('Sidebar — Channels panel scoped search', () => {
  beforeEach(() => {
    useNostrStore.setState({
      channels: [
        { id: 'ch1', name: 'General', lastMessage: '', lastMessageAt: 1000, unread: 0, mentions: 0, creatorPubkey: '', relayUrl: '' },
        { id: 'ch2', name: 'Random',  lastMessage: '', lastMessageAt: 900,  unread: 0, mentions: 0, creatorPubkey: '', relayUrl: '' },
      ],
      joinedChannelIds: ['ch1', 'ch2'],
    })
  })

  it('shows a search input when the Channels panel is open', async () => {
    render(<Sidebar />)
    await openPanel('Channels')
    expect(screen.getByPlaceholderText('Search channels…')).toBeInTheDocument()
  })

  it('filters channels by name as the user types', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)
    await openPanel('Channels')
    await user.type(screen.getByPlaceholderText('Search channels…'), 'Gen')
    expect(screen.getByText('General')).toBeInTheDocument()
    expect(screen.queryByText('Random')).not.toBeInTheDocument()
  })

  it('shows empty state when no channels match', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)
    await openPanel('Channels')
    await user.type(screen.getByPlaceholderText('Search channels…'), 'xyz')
    expect(screen.getByText(/No channels matching/)).toBeInTheDocument()
  })

  it('calls setShowAddChannel when the add-channel icon is clicked', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)
    await openPanel('Channels')
    await user.click(screen.getByRole('button', { name: 'Add / Discover Channels' }))
    expect(useNostrStore.getState().setShowAddChannel).toHaveBeenCalled()
  })

  it('shows message results when query matches channel message content', async () => {
    useNostrStore.setState({
      messages: {
        ch1: [{ id: 'cmsg1', pubkey: 'testpubkey', content: 'hello world', createdAt: 1000, status: 'sent', tags: [], kind: 42 }],
      },
    })
    const user = userEvent.setup()
    render(<Sidebar />)
    await openPanel('Channels')
    await user.type(screen.getByPlaceholderText('Search channels…'), 'hello')
    expect(screen.getByText(/Messages ·/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /hello world/i })).toBeInTheDocument()
  })
})

describe('SearchResultItem — jumpToMessage', () => {
  beforeEach(() => {
    useNostrStore.setState({
      jumpToMessage: vi.fn(),
      clearTargetMessage: vi.fn(),
      messages: {
        aaa: [{ id: 'msg1', pubkey: 'aaa', content: 'hello world', createdAt: 1000, status: 'sent', tags: [], kind: 4 }],
      },
    })
  })

  it('calls jumpToMessage when a message result row is clicked', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)
    await openPanel('Messages')
    await user.type(screen.getByPlaceholderText('Search conversations…'), 'hello')
    const resultBtn = screen.getByRole('button', { name: /hello world/i })
    await user.click(resultBtn)
    expect(useNostrStore.getState().jumpToMessage).toHaveBeenCalledWith('aaa', 'dm', 'msg1')
  })
})
