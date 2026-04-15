# Feature Notes

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
