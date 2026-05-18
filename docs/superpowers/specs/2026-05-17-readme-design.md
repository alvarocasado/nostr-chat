---
name: readme-design
description: Design spec for the public-facing README.md of the nostr-chat project
metadata:
  type: project
---

# README Design — nostr-chat

## Context

The current README.md contains only the project title. The goal is to write a public-facing README suitable for an open-source GitHub project page.

**Audience:** General public / open-source visitors discovering the project on GitHub.
**Scope:** Feature showcase + local setup. No contributing guide.

## Approach

Feature-first showcase:
1. Header with tagline and screenshot placeholder
2. Categorized feature list
3. Tech stack line
4. Getting Started (prerequisites, install, build, test)

## Structure

### Header

```markdown
# nostr-chat

A privacy-first chat app built on the Nostr protocol — DMs, encrypted groups, channels, and WebRTC calls.

![Screenshot](docs/screenshot.png)
```

### Features

Organized into five categories:

**Messaging**
- End-to-end encrypted DMs (NIP-04)
- Public and private channels
- Encrypted group chats with AES-256-GCM key distribution via NIP-04 DMs
- Reply/quote messages, draft persistence, unread divider
- Message send status (pending / delivered / failed with retry)

**Calls**
- WebRTC audio/video calls directly between users
- TURN server configuration with cross-device sync (NIP-78)
- TURN credentials shared in the encrypted call offer — no extra setup for the callee

**Files & Media**
- File attachments up to 50 MB (chunked transfer over Nostr events)
- Shared media gallery with full-screen lightbox per conversation
- Image, video, voice message, and generic file support

**Cross-device & Sync**
- All data stored in per-user IndexedDB — no account, no server
- Contacts, channels, and settings sync via your own Nostr relays (NIP-02, NIP-51, NIP-78)
- Relay connection health monitor in settings

**UX**
- Progressive Web App — installable on mobile and desktop
- Mobile-first responsive layout (bottom nav + slide-up sheets)
- Scoped search in Messages and Channels panels
- Profile cards, NIP-05 display, avatar lightbox

### Tech Stack

Single line: React 19 · TypeScript · Vite · Tailwind CSS · Zustand · Dexie.js · nostr-tools · Vitest

### Getting Started

Prerequisites:
- Node.js 20+
- A Nostr private key (hex or nsec) — note where to generate one

Commands: clone, npm install, npm run dev, npm run build, npm test

## Decisions

- Screenshot path `docs/screenshot.png` is a placeholder to be filled in later
- GitHub clone URL left as a placeholder (`your-username`)
- NIP references kept in feature descriptions for technical credibility
- No license section — can be added later if project goes public
- No contributing guide per user preference
