import { it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PrivacyTab } from '../components/Settings/PrivacyTab'
import { useNostrStore } from '../store/nostrStore'

beforeEach(() => {
  useNostrStore.setState({
    readReceiptsEnabled: false,
    blockedPubkeys: [],
    profiles: {},
  })
})

it('renders the read receipts toggle off by default', () => {
  render(<PrivacyTab />)
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
})

it('toggles readReceiptsEnabled in the store', () => {
  render(<PrivacyTab />)
  fireEvent.click(screen.getByRole('switch'))
  expect(useNostrStore.getState().readReceiptsEnabled).toBe(true)
})
