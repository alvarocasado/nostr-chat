# Feature Notes

## feature/mobile-responsive-layout

**Mobile rendering compatibility**

- **Viewport height**: replaced `100vh` with `100dvh` so the app container shrinks correctly when the virtual keyboard opens on iOS/Android
- **iOS safe areas**: message input bar and sidebar footer respect `env(safe-area-inset-bottom)` for notch/home-indicator devices
- **Sidebar drawer**: on mobile (`< md`) the sidebar is hidden by default and slides in from the left as a full-height overlay with a dark backdrop; tap outside or the ✕ button to dismiss
- **Desktop unchanged**: sidebar remains a fixed `w-72` column at `md` and above
- **Back navigation**: chat headers gain an `←` back button on mobile that clears the active chat and shows the empty state with an "Open Menu" button
- **Mobile top bar**: when no chat is selected on mobile, a minimal top bar with a hamburger menu button is shown
- **Bottom-sheet modals**: Add Channel, Add Contact, and Settings modals slide up from the bottom on mobile (rounded top corners, full width) and remain centered cards on desktop; content areas scroll independently
- **Touch targets**: increased tap area on list items (py-3 vs py-2.5) and all icon buttons (p-2 minimum)
- **Hint text hidden on mobile**: "Enter to send · Shift+Enter for new line" hint hidden on small screens
- All 40 existing tests continue to pass

---

## feature/testing-setup

**Automated testing with Vitest + React Testing Library**

- Vitest configured in `vite.config.ts` with `jsdom` environment and global test APIs
- `@testing-library/react` and `@testing-library/user-event` for component tests
- `@vitest/coverage-v8` for code coverage reports (`npm run test:coverage`)
- Global mocks in `src/test/setup.ts` for clipboard, camera, Web Share API, and Nostr relay pool
- **40 tests** across 4 suites:
  - `nostr.test.ts` — key generation, bech32 encoding, `parseProfile`, `shortPubkey`
  - `store.test.ts` — login/logout, relay management, contacts, channels, message deduplication and sorting
  - `extractPubkey.test.ts` — QR payload parsing for all Nostr URI formats
  - `LoginScreen.test.tsx` — welcome screen rendering, account creation flow, nsec import, error handling
- CI workflow updated: tests run on every push to `main`, `develop`, and `feature/**` branches; build and deploy only proceed if tests pass
- `npm test` — single run | `npm run test:watch` — interactive | `npm run test:coverage` — with coverage

---

## feature/settings-share-pubkey-qr

**Share public key via QR code (Settings → Keys)**

- Added collapsible "Share Public Key via QR Code" section in Settings → Keys tab
- QR code is rendered on a canvas using the `qrcode` library with a white-on-dark theme
- QR value uses the `nostr:npub1...` URI format for compatibility with Nostr client scanners
- **Download** button saves the QR as a PNG image
- **Share** button uses the Web Share API to hand off the image to native apps (works on mobile when installed as a PWA)
- Section is collapsed by default to keep the Keys tab clean

---

## feature/qr-code-contact-scan

**Scan QR code to add a contact (Add Contact modal)**

- Added "Scan QR" tab alongside the existing "Enter Key" tab in the Add Contact modal
- New `useQRScanner` hook opens the rear-facing camera, decodes frames with `jsQR` via `requestAnimationFrame`, and stops the stream on a successful match
- `extractPubkey()` parses all common Nostr QR payload formats: `npub1...`, `nostr:npub1...`, `nprofile1...`, and raw 64-char hex
- Scanning overlay with animated scan line and corner bracket guides
- On a successful scan, switches back to the manual tab, pre-fills the npub, and immediately triggers a profile lookup
- Added `scan-line` keyframe animation to Tailwind config

---

## Initial release

**Nostr React Chat PWA**

- Login / signup with keypair generation (nsec/npub) or import of existing key
- Public channels (NIP-28 kind-40/42) — discover, join, and create channels
- Encrypted direct messages (NIP-04 kind-4)
- User profiles (NIP-01 kind-0) with avatar, display name, and NIP-05
- Contact list with last-message preview and unread badge
- Relay management — add/remove relays, live connection via SimplePool
- Zustand store with localStorage persistence
- PWA manifest + Workbox service worker for installability
- Tailwind CSS dark UI with purple accent (inspired by 0xchat.com)
- GitHub Actions workflow for automatic deployment to GitHub Pages
