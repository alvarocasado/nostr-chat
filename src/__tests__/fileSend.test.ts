import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AttachmentData } from '../lib/fileUtils'

const uploadBlob = vi.fn()
vi.mock('../lib/blossom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/blossom')>()
  return { ...actual, uploadBlob: (...a: unknown[]) => uploadBlob(...a), setCachedObjectUrl: vi.fn() }
})

import { uploadAttachment } from '../lib/fileSend'

// data URL for the 3 bytes "abc"
const DATA_URL = 'data:text/plain;base64,YWJj'

function attachment(): AttachmentData {
  return { name: 'a.txt', type: 'text/plain', size: 3, data: DATA_URL }
}

beforeEach(() => {
  uploadBlob.mockReset()
  uploadBlob.mockResolvedValue({ url: 'https://srv/HASH', sha256: 'HASH', size: 3, type: 'text/plain' })
  // jsdom lacks createObjectURL
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:local') })
})
afterEach(() => { vi.restoreAllMocks() })

describe('uploadAttachment', () => {
  it('channel: uploads plaintext and returns a remote ref with no enc', async () => {
    const out = await uploadAttachment(attachment(), 'channel', 'https://srv')
    expect(out.url).toBe('https://srv/HASH')
    expect(out.hash).toBe('HASH')
    expect(out.enc).toBeUndefined()
    expect(out.data).toBeUndefined()
    // the bytes uploaded are the plaintext "abc"
    const uploadedBytes = new Uint8Array(uploadBlob.mock.calls[0][1] as ArrayBuffer)
    expect(new TextDecoder().decode(uploadedBytes)).toBe('abc')
  })

  it('dm: encrypts before upload and returns an enc block; uploaded bytes are not the plaintext', async () => {
    const out = await uploadAttachment(attachment(), 'dm', 'https://srv')
    expect(out.url).toBe('https://srv/HASH')
    expect(out.enc?.algo).toBe('AES-GCM')
    expect(typeof out.enc?.key).toBe('string')
    expect(typeof out.enc?.iv).toBe('string')
    const uploadedBytes = new Uint8Array(uploadBlob.mock.calls[0][1] as ArrayBuffer)
    expect(new TextDecoder().decode(uploadedBytes)).not.toBe('abc') // ciphertext
  })

  it('group: also produces an enc block (encrypted upload)', async () => {
    const out = await uploadAttachment(attachment(), 'group', 'https://srv')
    expect(out.enc?.algo).toBe('AES-GCM')
  })
})
