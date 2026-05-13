# Feature Notes

## Unreleased

- TURN server configuration (Settings → Calls) now syncs across devices via kind 30078 NIP-78 Nostr events. Save your TURN config on one device and it will be available when you log in with the same key on another. Media device preferences (microphone/camera) remain local-only.
- Log out moved from the navigation rail (desktop) and sheet footer (mobile) into Settings, as the last item below a divider.
- Mobile bottom nav is now always visible and accessible, even when a section sheet is open. Modals and overlays (calls, lightboxes, etc.) correctly layer above the nav.
