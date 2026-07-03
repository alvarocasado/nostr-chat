import { it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const ctx = {
  groupCallState: 'idle' as 'idle' | 'in-call',
  liveCall: null as null | { callId: string; mediaType: 'audio' | 'video'; participants: string[] },
  joinState: 'can-join' as 'can-join' | 'full' | 'busy' | 'other-device' | 'in-call',
  startOrJoin: vi.fn(),
}
vi.mock('../contexts/GroupCallContext', () => ({ useGroupCallContext: () => ctx }))

import { GroupCallBanner } from '../components/Call/GroupCallBanner'

const GROUP_ID = 'g'.repeat(64)

beforeEach(() => {
  vi.clearAllMocks()
  ctx.groupCallState = 'idle'
  ctx.liveCall = { callId: 'c1', mediaType: 'audio', participants: ['a', 'b'] }
  ctx.joinState = 'can-join'
})

it('renders nothing when no live call or already joined', () => {
  ctx.liveCall = null
  expect(render(<GroupCallBanner groupId={GROUP_ID} />).container.firstChild).toBeNull()
  ctx.liveCall = { callId: 'c1', mediaType: 'audio', participants: ['a'] }
  ctx.joinState = 'in-call'
  expect(render(<GroupCallBanner groupId={GROUP_ID} />).container.firstChild).toBeNull()
})

it('shows the count and joins with the call mediaType', () => {
  render(<GroupCallBanner groupId={GROUP_ID} />)
  expect(screen.getByText('Call in progress · 2/6')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /join/i }))
  expect(ctx.startOrJoin).toHaveBeenCalledWith(GROUP_ID, 'audio')
})

it.each([
  ['full', 'Call full'],
  ['busy', 'In another call'],
  ['other-device', 'In call on another device'],
] as const)('disables join when %s', (state, label) => {
  ctx.joinState = state
  render(<GroupCallBanner groupId={GROUP_ID} />)
  const btn = screen.getByRole('button', { name: new RegExp(label, 'i') })
  expect(btn).toBeDisabled()
})
