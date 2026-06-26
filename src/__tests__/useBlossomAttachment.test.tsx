import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { AttachmentData } from '../lib/fileUtils'

const downloadBlob = vi.fn()
const sha256Hex = vi.fn()
const decryptBlob = vi.fn()
vi.mock('../lib/blossom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/blossom')>()
  return {
    ...actual,
    downloadBlob: (...a: unknown[]) => downloadBlob(...a),
    sha256Hex: (...a: unknown[]) => sha256Hex(...a),
    getCachedObjectUrl: () => undefined,
    setCachedObjectUrl: vi.fn(),
  }
})
vi.mock('../lib/fileCrypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/fileCrypto')>()
  return { ...actual, decryptBlob: (...a: unknown[]) => decryptBlob(...a) }
})

import { useBlossomAttachment } from '../hooks/useBlossomAttachment'

const bytes = new TextEncoder().encode('img').buffer

beforeEach(() => {
  downloadBlob.mockReset(); sha256Hex.mockReset(); decryptBlob.mockReset()
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:obj'), revokeObjectURL: vi.fn() })
})
afterEach(() => { vi.restoreAllMocks() })

const plain: AttachmentData = { name: 'a.png', type: 'image/png', size: 3, url: 'https://srv/H', hash: 'H' }
const encrypted: AttachmentData = { ...plain, enc: { algo: 'AES-GCM', key: 'k', iv: 'iv' } }

describe('useBlossomAttachment', () => {
  it('plaintext: downloads, verifies hash, becomes ready', async () => {
    downloadBlob.mockResolvedValue(bytes)
    sha256Hex.mockResolvedValue('H')
    const { result } = renderHook(() => useBlossomAttachment(plain))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.objectUrl).toBe('blob:obj')
    expect(decryptBlob).not.toHaveBeenCalled()
  })

  it('encrypted: decrypts after verifying, becomes ready', async () => {
    downloadBlob.mockResolvedValue(bytes)
    sha256Hex.mockResolvedValue('H')
    decryptBlob.mockResolvedValue(bytes)
    const { result } = renderHook(() => useBlossomAttachment(encrypted))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(decryptBlob).toHaveBeenCalledTimes(1)
  })

  it('hash mismatch -> error, never decrypts', async () => {
    downloadBlob.mockResolvedValue(bytes)
    sha256Hex.mockResolvedValue('DIFFERENT')
    const { result } = renderHook(() => useBlossomAttachment(encrypted))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(decryptBlob).not.toHaveBeenCalled()
  })

  it('download failure -> error; retry re-attempts', async () => {
    downloadBlob.mockRejectedValueOnce(new Error('net'))
    const { result } = renderHook(() => useBlossomAttachment(plain))
    await waitFor(() => expect(result.current.status).toBe('error'))
    downloadBlob.mockResolvedValue(bytes)
    sha256Hex.mockResolvedValue('H')
    act(() => { result.current.retry() })
    await waitFor(() => expect(result.current.status).toBe('ready'))
  })
})
