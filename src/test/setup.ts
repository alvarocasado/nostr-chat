import '@testing-library/jest-dom'
import { vi } from 'vitest'
// @testing-library/react v16 auto-registers cleanup via afterEach when globals:true

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

// Silence nostr-tools WebSocket noise in tests
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return {
    ...actual,
    subscribeEvents: vi.fn(() => ({ close: vi.fn() })),
    publishEvent: vi.fn().mockResolvedValue(undefined),
    fetchEvent: vi.fn().mockResolvedValue(null),
    getPool: vi.fn(),
  }
})
