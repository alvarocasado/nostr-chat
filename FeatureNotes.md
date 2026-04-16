# Feature Notes

## Unreleased

### File Attachments
- Paperclip button in the message input to attach files, photos, documents, audio, and video
- Images are compressed client-side (canvas → JPEG, max 1280px, progressive quality reduction) to stay within the 150 KB relay-safe limit; an error is shown if the image cannot be compressed enough
- Non-image files (PDF, audio, video, text, etc.) accepted up to 100 KB; oversized files are rejected with a clear error message
- Attachment preview before sending: image thumbnail or filename + size with a remove button
- Images render inline in the chat (max 300px tall); other files render as a downloadable card with a type icon, name, and size
- Backwards-compatible: plain text messages are unaffected; the JSON envelope is only used when an attachment is present
- 16 new unit tests covering parse/serialize round-trips, size constants, and byte formatting (`src/__tests__/fileUtils.test.ts`)

### Search Messages
- Search bar in the sidebar filters across all in-memory messages (channels + DMs)
- Starts searching after 2 characters are typed
- Results show chat name, sender, highlighted match snippet, and timestamp
- Sorted by most recent first (up to 50 results)
- Tab switcher hides while a search is active; cleared query restores normal view
- Clicking a result navigates to that chat (closes mobile drawer)

### Sidebar Width Fix
- Fixed desktop sidebar shrinking when switching to Messages or Contacts tabs
- Root cause: `sidebarContent` div lacked `w-full`, so flex child sized to content

_See [ReleaseNotes.md](./ReleaseNotes.md) for the full history._
