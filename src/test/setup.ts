import '@testing-library/jest-dom'
import { vi } from 'vitest'
// @testing-library/react v16 auto-registers cleanup via afterEach when globals:true

// Node.js 25+ ships a native localStorage stub that shadows JSDOM's implementation
// and doesn't work without --localstorage-file. Replace both window and globalThis
// with a working in-memory implementation.
const _localStorageData = new Map<string, string>()
const _localStorageMock: Storage = {
  getItem: (key: string) => _localStorageData.get(key) ?? null,
  setItem: (key: string, value: string) => { _localStorageData.set(key, String(value)) },
  removeItem: (key: string) => { _localStorageData.delete(key) },
  clear: () => { _localStorageData.clear() },
  key: (index: number) => Array.from(_localStorageData.keys())[index] ?? null,
  get length() { return _localStorageData.size },
}
Object.defineProperty(globalThis, 'localStorage', { value: _localStorageMock, configurable: true, writable: true })
Object.defineProperty(window, 'localStorage', { value: _localStorageMock, configurable: true, writable: true })

// Mock navigator.clipboard
Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
})

// Mock navigator.mediaDevices (camera)
Object.defineProperty(navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    }),
  },
})

// Mock navigator.share
Object.assign(navigator, {
  share: vi.fn().mockResolvedValue(undefined),
})

// Make jsdom behave as a desktop viewport so CSS-based show/hide (md:flex, md:hidden)
// renders only the desktop Sidebar layout in tests.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
})

// Silence nostr-tools WebSocket noise in tests
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return {
    ...actual,
    subscribeEvents: vi.fn(() => ({ close: vi.fn() })),
    publishEvent: vi.fn().mockResolvedValue(undefined),
    fetchEvent: vi.fn().mockResolvedValue(null),
    fetchEvents: vi.fn().mockResolvedValue([]),
    getPool: vi.fn(),
  }
})
