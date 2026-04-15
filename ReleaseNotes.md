# Release Notes

## 1.0.0-alpha.1 — 2026-04-15

### Mobile Rendering Compatibility
- `100dvh` container + `env(safe-area-inset-bottom)` for virtual keyboard and iOS notch/home-indicator support
- Sidebar becomes a slide-over drawer on mobile with backdrop dismiss and ✕ close button; static column on `md+`
- Chat headers show `←` back button on mobile to return to the sidebar
- All modals (Add Channel, Add Contact, Settings) use a bottom-sheet pattern on mobile; centered cards on desktop
- Touch targets increased across list items and icon buttons
- "Enter to send" hint hidden on mobile

### Automated Testing
- Vitest + React Testing Library with `jsdom` environment
- 40 tests across 4 suites: Nostr utilities, store actions, QR pubkey extraction, and LoginScreen component flows
- `@vitest/coverage-v8` coverage reporting
- CI pipeline gates build and deploy behind the test job on all branches

### Share Public Key via QR Code (Settings → Keys)
- Collapsible QR code panel in Settings → Keys tab
- QR rendered with `qrcode` library using `nostr:npub1...` URI format
- Download button saves QR as PNG; Share button uses Web Share API on mobile

### QR Code Contact Scanner (Add Contact)
- "Scan QR" tab in the Add Contact modal
- `useQRScanner` hook opens the rear camera, decodes frames via `jsQR`, stops on match
- Supports `npub1`, `nostr:npub1`, `nprofile1`, and raw hex pubkey QR payloads
- Animated scan-line overlay with corner bracket guides

### Core Application
- Login / signup with keypair generation (nsec/npub) or import of existing key
- Public channels (NIP-28 kind-40/42) — discover, join, and create channels
- Encrypted direct messages (NIP-04 kind-4)
- User profiles (NIP-01 kind-0) with avatar, display name, and NIP-05
- Contact list with last-message preview and unread badge
- Relay management — add/remove relays with live connection via SimplePool
- Zustand store with localStorage persistence
- PWA manifest + Workbox service worker — installable on Android and iOS
- GitHub Actions workflow — tests → build → deploy to GitHub Pages on every push to `main`
