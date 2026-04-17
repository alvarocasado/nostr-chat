# Feature Notes

## Unreleased

### Desktop Notifications
- Browser `Notification` API with urgency hierarchy: DMs (critical) → @mentions (high) → group messages (low/FYI)
- **DMs**: amber badge + desktop banner + sound by default
- **@mentions**: amber badge + desktop banner + sound by default; detected by matching the user's npub/hex pubkey in channel message content
- **Group channels**: gray badge indicator only — no banner, no sound by default (configurable)
- **Contextual suppression** — no popup when the app is focused and the user is already in that chat
- **Per-chat mute** via bell icon in the sidebar (revealed on hover): 8 h, 24 h, 1 week, or always; amber bell icon when muted
- **Settings → Notifications tab**: permission request UI, per-type show/sound toggles, Do Not Disturb with presets (1 h / 8 h / 24 h / until I turn off) and live countdown
- Notification sounds generated via Web Audio API oscillator — no audio file required
- All settings persisted to `localStorage` via Zustand

See [ReleaseNotes.md](./ReleaseNotes.md) for the full history.
