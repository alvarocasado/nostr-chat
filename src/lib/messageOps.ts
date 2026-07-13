// Edit and delete travel as control messages through the normal per-chat
// transport (like reactions — see lib/reactions.ts), so DM/group edits and
// deletes stay end-to-end encrypted and reuse the existing subscriptions.
// ponytail: app-internal format, not interoperable NIP-09 kind-5 deletion;
// switch channel deletes to real kind-5 if cross-client honouring is needed.
//
// Deletes are advisory on Nostr: relays may keep the original event. The UI
// shows a tombstone rather than pretending the data is gone.

// Matches inbox MAX_CONTENT_LEN; kept local to avoid an import cycle with inbox.
const MAX_EDIT_CONTENT_LEN = 200_000

export interface EditPayload {
  type: 'edit'
  target: string   // event id being edited
  content: string  // new plaintext body
}

export interface DeletePayload {
  type: 'delete'
  target: string   // event id being deleted
}

export function serializeEdit(target: string, content: string): string {
  return JSON.stringify({ type: 'edit', target, content } satisfies EditPayload)
}

export function serializeDelete(target: string): string {
  return JSON.stringify({ type: 'delete', target } satisfies DeletePayload)
}

export function parseEditPayload(content: string): EditPayload | null {
  if (!content.startsWith('{')) return null
  try {
    const obj = JSON.parse(content)
    if (
      obj.type === 'edit' &&
      typeof obj.target === 'string' && obj.target.length > 0 &&
      typeof obj.content === 'string' && obj.content.length <= MAX_EDIT_CONTENT_LEN
    ) return obj as EditPayload
  } catch { /* not JSON */ }
  return null
}

export function parseDeletePayload(content: string): DeletePayload | null {
  if (!content.startsWith('{')) return null
  try {
    const obj = JSON.parse(content)
    if (
      obj.type === 'delete' &&
      typeof obj.target === 'string' && obj.target.length > 0
    ) return obj as DeletePayload
  } catch { /* not JSON */ }
  return null
}
