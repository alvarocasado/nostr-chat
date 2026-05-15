# Sidebar: Scoped Search + Icon Action Buttons

**Date:** 2026-05-14  
**Status:** Approved

## Overview

Add scoped, real-time name filtering inside the Messages and Channels panels of the sidebar, and replace the full-width action buttons in those panels with compact icon buttons in the panel header. The global Search section (message content search) is unchanged.

## Scope

All changes are confined to `src/components/Chat/Sidebar.tsx`.

## Changes

### 1. Messages panel

**Header** — layout changes from `[Messages] [X]` to `[Messages] [MessageCirclePlus icon] [X]`  
- `MessageCirclePlus` (lucide 0.513) — 16 px, styled with the existing `NavRailButton`-like appearance: `text-gray-500 hover:text-white hover:bg-white/[0.08] w-8 h-8 rounded-lg`  
- Clicking it calls `setShowAddContact(true)` and `closePanel()` — same behavior as the removed button

**Body** — search bar replaces the full-width button  
- Compact pill input: same visual as the global search bar (`bg-gray-800 rounded-xl px-3 py-2 border border-gray-700 focus-within:border-purple-500/50`) with a `Search` icon and an `X` clear button  
- Local state `dmSearchQuery: string` (separate from `searchQuery` used by global search)  
- Filters `contacts` array by `name.toLowerCase().includes(dmSearchQuery.trim().toLowerCase())`; name derived the same way as `ContactItem` uses (`getDisplayName`)  
- Empty state when filtered list is empty: `"No conversations matching «query»"` in `text-gray-500 text-xs text-center`  
- Full-width "New Message" button removed

### 2. Channels panel

**Header** — layout changes from `[Channels] [X]` to `[Channels] [SquarePlus icon] [X]`  
- `SquarePlus` (lucide 0.513) — 16 px, same icon button style as above  
- Clicking it calls `setShowAddChannel(true)` and `closePanel()` — same behavior as the removed button

**Body** — search bar replaces the full-width button  
- Same pill input style; local state `channelSearchQuery: string`  
- Filters `joinedChannels` by `channel.name.toLowerCase().includes(channelSearchQuery.trim().toLowerCase())`  
- Empty state: `"No channels matching «query»"`  
- Full-width "Add / Discover Channels" button removed

### 3. Unchanged

- Global Search section and its `searchQuery` state  
- Contacts section, Settings section  
- Nav rail, mobile bottom nav  
- All modal components (`AddContactModal`, `AddChannelModal`)

## State

Two new `useState` hooks added to the `Sidebar` component:

```ts
const [dmSearchQuery, setDmSearchQuery] = useState('')
const [channelSearchQuery, setChannelSearchQuery] = useState('')
```

Both reset to `''` when their respective panel closes (via the existing `closePanel` / `closePanelOnly` logic extended with a setter call).

## Panel header pattern (shared)

The panel header `div` gets a third button slotted between the title and the X:

```
<div className="flex items-center justify-between px-4 py-4 border-b border-gray-800 flex-shrink-0">
  <h2>…title…</h2>
  <div className="flex items-center gap-1">
    <button /* action icon */ />
    <button /* X close */ />
  </div>
</div>
```

## Out of scope

- Searching contacts section (no message list, just a pubkey lookup)  
- Searching within the global Search results  
- Persisting search queries across panel open/close cycles
