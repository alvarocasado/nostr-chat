import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginScreen } from '../components/Auth/LoginScreen'
import { useNostrStore } from '../store/nostrStore'

beforeEach(() => {
  useNostrStore.setState({
    privateKeyHex: null, publicKey: null, nsec: null, npub: null, profile: null,
  })
})

describe('LoginScreen', () => {
  it('renders the welcome screen with both action buttons', () => {
    render(<LoginScreen />)
    expect(screen.getByText('Create New Account')).toBeInTheDocument()
    expect(screen.getByText('Login with Private Key')).toBeInTheDocument()
  })

  it('generates a new account and shows the key display screen', async () => {
    render(<LoginScreen />)
    await userEvent.click(screen.getByText('Create New Account'))
    // generateAndLogin is async; wait for the re-render after state updates
    expect(await screen.findByText('Your New Keys')).toBeInTheDocument()
    expect(screen.getByText(/Private Key/)).toBeInTheDocument()
    expect(screen.getByText(/Public Key/)).toBeInTheDocument()
    expect(useNostrStore.getState().publicKey).toBeTruthy()
  })

  it('navigates to the import screen', async () => {
    render(<LoginScreen />)
    await userEvent.click(screen.getByText('Login with Private Key'))
    expect(screen.getByPlaceholderText(/nsec1/)).toBeInTheDocument()
    expect(screen.getByText('Import & Login')).toBeInTheDocument()
  })

  it('shows an error for an invalid key on import', async () => {
    render(<LoginScreen />)
    await userEvent.click(screen.getByText('Login with Private Key'))
    const input = screen.getByPlaceholderText(/nsec1/)
    await userEvent.type(input, 'nsec1invalid')
    await userEvent.click(screen.getByText('Import & Login'))
    expect(screen.getByText(/Invalid/)).toBeInTheDocument()
  })

  it('logs in successfully with a valid nsec', async () => {
    const { nsec } = await useNostrStore.getState().generateAndLogin()
    useNostrStore.setState({ privateKeyHex: null, publicKey: null, nsec: null, npub: null })

    render(<LoginScreen />)
    await userEvent.click(screen.getByText('Login with Private Key'))
    const input = screen.getByPlaceholderText(/nsec1/)
    // Use fireEvent for long strings (userEvent can be slow)
    fireEvent.change(input, { target: { value: nsec } })
    await userEvent.click(screen.getByText('Import & Login'))
    expect(useNostrStore.getState().publicKey).toBeTruthy()
  })

  it('back button returns to the welcome screen', async () => {
    render(<LoginScreen />)
    await userEvent.click(screen.getByText('Login with Private Key'))
    await userEvent.click(screen.getByText('← Back'))
    expect(screen.getByText('Create New Account')).toBeInTheDocument()
  })
})
