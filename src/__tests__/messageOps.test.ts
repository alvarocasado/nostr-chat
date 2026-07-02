import { describe, it, expect } from 'vitest'
import {
  serializeEdit,
  serializeDelete,
  parseEditPayload,
  parseDeletePayload,
} from '../lib/messageOps'

describe('edit payloads', () => {
  it('round-trips an edit', () => {
    expect(parseEditPayload(serializeEdit('evt1', 'new text'))).toEqual({
      type: 'edit', target: 'evt1', content: 'new text',
    })
  })

  it('allows empty edit content', () => {
    expect(parseEditPayload(serializeEdit('evt1', ''))?.content).toBe('')
  })

  it('rejects a non-edit payload', () => {
    expect(parseEditPayload(serializeDelete('evt1'))).toBeNull()
    expect(parseEditPayload('{"type":"reaction","target":"e","emoji":"x","op":"add"}')).toBeNull()
  })

  it('rejects plain text', () => {
    expect(parseEditPayload('hello')).toBeNull()
  })
})

describe('delete payloads', () => {
  it('round-trips a delete', () => {
    expect(parseDeletePayload(serializeDelete('evt1'))).toEqual({ type: 'delete', target: 'evt1' })
  })

  it('rejects a non-delete payload', () => {
    expect(parseDeletePayload(serializeEdit('evt1', 'x'))).toBeNull()
  })

  it('rejects a delete with no target', () => {
    expect(parseDeletePayload('{"type":"delete"}')).toBeNull()
  })
})
