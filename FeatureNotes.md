# Feature Notes

## Unreleased

### Settings → Calls Tab
- New **Calls** tab added to the Settings modal, positioned between Keys and Notifications
- **TURN Server** section with three options:
  - *None* (default) — public STUN only, no configuration required
  - *Metered.ca* — enter subdomain + API key; ephemeral credentials are fetched from the Metered.ca API on save and stored in `localStorage`
  - *Custom* — enter a `turn:`/`turns:` URL with optional username and password
- **Test Connection** button: opens an `RTCPeerConnection` with the saved config, looks for a relay ICE candidate, and shows ✅ Relay reachable or ❌ Could not reach relay
- **Media Devices** section: Microphone and Camera dropdowns populated via `enumerateDevices()`; selections persist to `localStorage` and are applied when calls start; permission unlock button shown when device labels are unavailable
- `getIceServers()` utility replaces the hard-coded ICE server list throughout the app — always includes Google + Cloudflare STUN as a base, appends saved TURN config if present
- **ICE failure banner**: non-blocking dismissible toast shown when a call's ICE negotiation fails; includes a "Settings → Calls" deep-link that opens the modal directly on the Calls tab
- CSP updated: added `turns:` scheme (TLS-wrapped TURN) and `https://*.metered.live` (Metered credential API) to `connect-src`

### Incoming Call Notifications
- Repeating two-tone ringtone (880 / 1100 Hz, 1.5 s cycle, up to 60 s) plays when an incoming call arrives; stops automatically when the call is accepted, declined, or cancelled
- Browser Notification banner shown with the caller's name when the app is backgrounded and permission is granted
- Do Not Disturb suppresses both ringtone and banner
- **Settings → Notifications → Calls** section added below Channels with independent toggles for "Show incoming call notification" and "Play ringtone" (both on by default)
