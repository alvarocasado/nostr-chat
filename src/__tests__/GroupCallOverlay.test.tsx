import { it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const ctx = {
  groupCallState: 'in-call', activeGroupId: 'g1', callId: 'c1', mediaType: 'audio' as const,
  liveCall: null, joinState: 'in-call' as const,
  localStream: null, remoteStreams: new Map<string, MediaStream>(),
  peerStates: new Map<string, 'connecting' | 'connected' | 'failed'>(),
  isMuted: false, isCameraOff: false, duration: 65,
  watchGroup: vi.fn(), startOrJoin: vi.fn(), leave: vi.fn(), toggleMute: vi.fn(), toggleCamera: vi.fn(),
}
vi.mock('../contexts/GroupCallContext', () => ({ useGroupCallContext: () => ctx }))

import { GroupCallOverlay } from '../components/Call/GroupCallOverlay'
import { useNostrStore } from '../store/nostrStore'

const P1 = 'a'.repeat(64)
const P2 = 'b'.repeat(64)

beforeEach(() => {
  ctx.groupCallState = 'in-call'
  ctx.peerStates = new Map()
  ctx.remoteStreams = new Map()
  useNostrStore.setState({ publicKey: 'm'.repeat(64), profiles: {}, contacts: [] })
})

it('renders nothing when idle', () => {
  ctx.groupCallState = 'idle' as typeof ctx.groupCallState
  const { container } = render(<GroupCallOverlay />)
  expect(container.firstChild).toBeNull()
})

it('renders one tile per participant including self, and the count', () => {
  ctx.peerStates = new Map([[P1, 'connected'], [P2, 'connecting']])
  render(<GroupCallOverlay />)
  expect(screen.getAllByTestId('call-tile')).toHaveLength(3)
  expect(screen.getByText('3 in call')).toBeInTheDocument()
  expect(screen.getByText(/connecting/i)).toBeInTheDocument()
})

it('uses a single column for 2 tiles and two columns for 3 or more', () => {
  ctx.peerStates = new Map([[P1, 'connected']])
  const { rerender } = render(<GroupCallOverlay />)
  expect(screen.getByTestId('tile-grid').className).toContain('grid-cols-1')
  ctx.peerStates = new Map([[P1, 'connected'], [P2, 'connected']])
  rerender(<GroupCallOverlay />)
  expect(screen.getByTestId('tile-grid').className).toContain('grid-cols-2')
})

it('wires the controls', () => {
  render(<GroupCallOverlay />)
  fireEvent.click(screen.getByTitle('Mute'))
  expect(ctx.toggleMute).toHaveBeenCalled()
  fireEvent.click(screen.getByTitle('Hang up'))
  expect(ctx.leave).toHaveBeenCalled()
})

it('marks a failed peer tile', () => {
  ctx.peerStates = new Map([[P1, 'failed']])
  render(<GroupCallOverlay />)
  expect(screen.getByText(/connection failed/i)).toBeInTheDocument()
})
