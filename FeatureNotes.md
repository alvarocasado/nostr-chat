# Feature Notes

## Unreleased

### TURN server sharing via encrypted call-offer
- When using Metered.ca, the caller fetches fresh time-scoped TURN credentials at call-initiation time (instead of reusing the cached ones) and includes them in the encrypted `call-offer` Nostr signal
- The callee merges the caller's ICE servers with their own when creating the `RTCPeerConnection`, so both parties can relay through the caller's TURN server for that call
- Credentials are NIP-04 encrypted in transit and expire automatically (Metered.ca HMAC timestamps); no extra revocation needed
- Custom and "none" modes are unaffected — their ICE config continues to come from the local cache
- `fetchCallIceServers()` and `mergeIceServers()` added to `src/lib/webrtc.ts`; `CallSignal` extended with optional `iceServers?: RTCIceServer[]` field (capped at 20 entries, validated on receipt)

### Profile card on avatar tap
- Tapping any avatar (message list, DM header, contact list) opens a modal profile card
- Card shows: avatar, display name, NIP-05 identifier, about text, copyable public key (npub)
- "Send Message" button adds contact and navigates to DM; hidden when viewing your own profile
- Backdrop click or X button closes the card
- `viewingProfilePubkey: string | null` added to store; `setViewingProfilePubkey` action controls the card
- `<ProfileCard />` rendered globally in App.tsx inside CallProvider (so it sits above all other UI)

### Settings as a first-class screen
- Settings is no longer a modal; it opens in the main area as a full-width page
- The Settings section in the sidebar shows a vertical menu: Profile · Relays · Keys · Calls · Notifications
- Clicking a menu item opens that settings screen in the main area (replaces the chat view)
- Closing the settings section panel (X or clicking the Settings rail icon again) returns the main area to chat
- `IceFailureBanner` "Settings → Calls" link navigates directly to the Calls settings screen
- Added `activeSettingsTab: SettingsTab | null` to the store; removed the modal-based `showSettings` flow from App.tsx

### Sidebar redesign — icon rail + collapsible sections
- Replaced the single full-width sidebar with a narrow icon rail (56 px) whose icons open collapsible section panels
- Icon rail order: Search · Messages · Channels · Contacts — spacer — Settings · Avatar · Logout
- Clicking an active icon collapses its panel; selecting a chat auto-collapses the panel
- Settings fires the modal directly without opening a panel
- Contacts section is "Add Contact" only; Messages section handles DM list and new-message flow
- Section panel slides in next to the rail on desktop, pushing the message thread to the right (300 ms ease-in-out)
- Mobile: fixed bottom nav bar (Search / Messages / Channels / Contacts / Settings) replaces the hamburger drawer; tapping an icon slides up a sheet from above the nav bar; profile + logout live in the sheet footer
- Removed the mobile "Open Menu" top bar and the hamburger button from the empty-chat state

