import { describe, it, expect } from 'vitest'
import {
  parseMessageContent,
  serializeMessage,
  formatBytes,
  MAX_ATTACHMENT_BYTES,
  MAX_RAW_FILE_BYTES,
  type AttachmentData,
} from '../lib/fileUtils'

const sampleAttachment: AttachmentData = {
  name: 'photo.jpg',
  type: 'image/jpeg',
  size: 12345,
  data: 'data:image/jpeg;base64,/9j/abc123',
}

describe('parseMessageContent', () => {
  it('returns plain text for a normal message', () => {
    const result = parseMessageContent('hello world')
    expect(result.text).toBe('hello world')
    expect(result.attachment).toBeNull()
  })

  it('returns plain text for invalid JSON', () => {
    const result = parseMessageContent('{not valid json}')
    expect(result.text).toBe('{not valid json}')
    expect(result.attachment).toBeNull()
  })

  it('returns plain text when JSON has no attachment field', () => {
    const result = parseMessageContent(JSON.stringify({ foo: 'bar' }))
    expect(result.text).toBe(JSON.stringify({ foo: 'bar' }))
    expect(result.attachment).toBeNull()
  })

  it('parses a message with an attachment', () => {
    const content = JSON.stringify({ text: 'check this out', attachment: sampleAttachment })
    const result = parseMessageContent(content)
    expect(result.text).toBe('check this out')
    expect(result.attachment).toEqual(sampleAttachment)
  })

  it('parses a message with attachment and empty text', () => {
    const content = JSON.stringify({ text: '', attachment: sampleAttachment })
    const result = parseMessageContent(content)
    expect(result.text).toBe('')
    expect(result.attachment).toEqual(sampleAttachment)
  })

  it('ignores JSON objects without a data field on attachment', () => {
    const content = JSON.stringify({ attachment: { name: 'x' } })
    const result = parseMessageContent(content)
    expect(result.attachment).toBeNull()
  })
})

describe('serializeMessage', () => {
  it('returns plain text when no attachment', () => {
    expect(serializeMessage('hello')).toBe('hello')
  })

  it('returns plain text when attachment is null', () => {
    expect(serializeMessage('hello', null)).toBe('hello')
  })

  it('returns JSON when attachment is provided', () => {
    const result = serializeMessage('caption', sampleAttachment)
    const parsed = JSON.parse(result)
    expect(parsed.text).toBe('caption')
    expect(parsed.attachment).toEqual(sampleAttachment)
  })

  it('round-trips through parseMessageContent', () => {
    const serialized = serializeMessage('look!', sampleAttachment)
    const parsed = parseMessageContent(serialized)
    expect(parsed.text).toBe('look!')
    expect(parsed.attachment).toEqual(sampleAttachment)
  })

  it('trims text when serializing with attachment', () => {
    const result = serializeMessage('  hi  ', sampleAttachment)
    expect(JSON.parse(result).text).toBe('hi')
  })
})

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(2560)).toBe('2.5 KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
  })
})

describe('size constants', () => {
  it('MAX_ATTACHMENT_BYTES is 150 KB', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(150 * 1024)
  })

  it('MAX_RAW_FILE_BYTES is 100 KB', () => {
    expect(MAX_RAW_FILE_BYTES).toBe(100 * 1024)
  })
})
