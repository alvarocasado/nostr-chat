import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sha256Hex, buildBlossomAuth, uploadBlob, downloadBlob } from '../lib/blossom'
import { installTestSigner } from '../test/signer'
import { clearSigner } from '../lib/signer'
import { generateSecretKey } from 'nostr-tools'

afterEach(() => { clearSigner(); vi.restoreAllMocks() })

describe('sha256Hex', () => {
  it('hashes the empty input to the known SHA-256 vector', async () => {
    expect(await sha256Hex(new ArrayBuffer(0)))
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

describe('buildBlossomAuth', () => {
  it('produces a base64 kind-24242 event with t/x/expiration tags', async () => {
    installTestSigner(generateSecretKey())
    const b64 = await buildBlossomAuth('abc123', 'upload')
    const ev = JSON.parse(atob(b64))
    expect(ev.kind).toBe(24242)
    expect(ev.tags).toEqual(expect.arrayContaining([
      ['t', 'upload'],
      ['x', 'abc123'],
    ]))
    expect(ev.tags.find((t: string[]) => t[0] === 'expiration')).toBeDefined()
    expect(typeof ev.sig).toBe('string')
  })
})

describe('uploadBlob', () => {
  it('PUTs to {server}/upload with the Nostr auth header and parses the descriptor', async () => {
    installTestSigner(generateSecretKey())
    const calls: { url?: string; method?: string; headers: Record<string, string>; body?: unknown } = { headers: {} }
    const expected = await sha256Hex(new TextEncoder().encode('abc').buffer)
    class FakeXHR {
      upload = { onprogress: null as null | ((e: ProgressEvent) => void) }
      onload: null | (() => void) = null
      onerror: null | (() => void) = null
      status = 200
      responseText = JSON.stringify({ url: 'https://srv/' + expected, sha256: expected, size: 3, type: 'text/plain' })
      open(method: string, url: string) { calls.method = method; calls.url = url }
      setRequestHeader(k: string, v: string) { calls.headers[k] = v }
      send(body: unknown) { calls.body = body; this.onload?.() }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest)

    const desc = await uploadBlob('https://srv/', new TextEncoder().encode('abc').buffer, 'text/plain')
    expect(calls.method).toBe('PUT')
    expect(calls.url).toBe('https://srv/upload')
    expect(calls.headers['Authorization']).toMatch(/^Nostr /)
    expect(desc.sha256).toBe(expected)
    expect(desc.url).toBe('https://srv/' + expected)
  })

  it('rejects when the server returns a different sha256 than the local hash', async () => {
    installTestSigner(generateSecretKey())
    class FakeXHR {
      upload = { onprogress: null as null | ((e: ProgressEvent) => void) }
      onload: null | (() => void) = null
      onerror: null | (() => void) = null
      status = 200
      responseText = JSON.stringify({ url: 'https://srv/deadbeef', sha256: 'deadbeef', size: 3, type: 'text/plain' })
      open(_method: string, _url: string) { /* noop */ }
      setRequestHeader(_k: string, _v: string) { /* noop */ }
      send(_body: unknown) { this.onload?.() }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest)

    await expect(
      uploadBlob('https://srv/', new TextEncoder().encode('abc').buffer, 'text/plain')
    ).rejects.toThrow('Server hash mismatch')
  })
})

describe('downloadBlob', () => {
  it('fetches the url and returns an ArrayBuffer', async () => {
    const buf = new TextEncoder().encode('xyz').buffer
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(buf) }))
    const out = await downloadBlob('https://srv/xyz')
    expect(new TextDecoder().decode(out)).toBe('xyz')
  })

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(downloadBlob('https://srv/missing')).rejects.toBeDefined()
  })
})
