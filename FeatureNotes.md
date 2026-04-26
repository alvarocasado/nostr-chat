# Feature Notes

## Unreleased

### Attachment Preview in Sidebar Fixed
- Messages containing file attachments are now shown as readable text in the sidebar preview and search results ("Image: IMG_001.jpg", "Voice message", "File: doc.pdf") instead of raw JSON
- Desktop notifications for DMs and channel messages with attachments also show the readable preview instead of JSON
- Root cause: `updateContactLastMessage` / `updateChannelLastMessage` and `fireNotification` were called with the raw serialised content string; new `getPreviewText()` utility in `fileUtils.ts` parses the attachment envelope and returns a human-readable label

### File Attachment Limit Raised to 50 MB
- Maximum attachment size increased from 10 MB to 50 MB — covers typical iPhone videos
- Chunk size doubled (53 KB → 100 KB base64) to keep event count comparable to before (~500 events for a 50 MB file vs ~1 250 with the old chunk size)
- Receive-side GC timeout extended from 5 min to 15 min so large transfers are not pruned mid-flight
