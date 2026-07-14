import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNostrStore, type Group } from '../store/nostrStore'

const h = vi.hoisted(() => ({ addGroupMember: vi.fn(), removeGroupMember: vi.fn() }))
vi.mock('../lib/groupManage', () => ({
  addGroupMember: h.addGroupMember,
  removeGroupMember: h.removeGroupMember,
}))

import { GroupMembersModal } from '../components/Chat/GroupMembersModal'

const ME = 'me'.padEnd(64, '0')
const BOB = 'b'.repeat(64)
const GROUP: Group = { id: 'g1', name: 'Team', creatorPubkey: ME, memberPubkeys: [ME, BOB], relayUrl: 'wss://r' }

beforeEach(() => {
  vi.clearAllMocks()
  h.removeGroupMember.mockResolvedValue(undefined)
  useNostrStore.setState({
    publicKey: ME,
    profiles: { [BOB]: { name: 'Bob', pubkey: BOB } },
    groups: [GROUP],
  })
})

describe('GroupMembersModal', () => {
  it('lists members with names and shows the trust note', () => {
    render(<GroupMembersModal group={GROUP} onClose={() => {}} />)
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText(/rotates the key/i)).toBeInTheDocument()
  })

  it('lets the creator remove a member after confirming', async () => {
    const user = userEvent.setup()
    render(<GroupMembersModal group={GROUP} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: /remove bob/i }))
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(h.removeGroupMember).toHaveBeenCalledWith(GROUP, BOB)
  })

  it('hides management controls from non-creators', () => {
    useNostrStore.setState({ publicKey: BOB })
    render(<GroupMembersModal group={GROUP} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/npub/i)).not.toBeInTheDocument()
  })

  it('lets the creator invite by hex pubkey', async () => {
    const user = userEvent.setup()
    h.addGroupMember.mockResolvedValue(undefined)
    render(<GroupMembersModal group={GROUP} onClose={() => {}} />)
    await user.type(screen.getByPlaceholderText(/npub/i), 'c'.repeat(64))
    await user.click(screen.getByRole('button', { name: /invite/i }))
    expect(h.addGroupMember).toHaveBeenCalledWith(GROUP, 'c'.repeat(64))
  })
})
