# Sidebar Scoped Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WhatsApp-style scoped name-filter search bars inside the Messages and Channels sidebar panels, and replace their full-width action buttons with compact icon buttons in the panel header.

**Architecture:** All changes are confined to `src/components/Chat/Sidebar.tsx`. Two new local state variables (`dmSearchQuery`, `channelSearchQuery`) drive real-time filtering of the contacts/channels lists. The panel header layout is extended to slot an action icon between the title and the close button.

**Tech Stack:** React, TypeScript, Tailwind CSS, lucide-react 0.513, Vitest + React Testing Library

---

## File Map

| File | Action |
|------|--------|
| `src/components/Chat/Sidebar.tsx` | Modify — add imports, state, search bars, icon buttons, filtered lists |
| `src/__tests__/Sidebar.test.tsx` | Create — tests for scoped search filtering and icon button actions |

---

### Task 1: Write failing tests for Messages panel scoped search

**Files:**
- Create: `src/__tests__/Sidebar.test.tsx`

- [ ] **Step 1: Create the test file**

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from '../components/Chat/Sidebar'
import { useNostrStore } from '../store/nostrStore'

// lucide-react renders SVGs — just verify buttons exist by aria-label / role
vi.mock('../hooks/useRelayHealth', () => ({
  useRelayHealth: () => ({}),
  aggregateRelayHealth: () => ({ connected: 1, resolved: 1, total: 1 }),
}))

function openPanel(label: string) {
  const btn = screen.getByRole('button', { name: label })
  btn.click()
}

beforeEach(() => {
  useNostrStore.setState({
    publicKey: 'testpubkey',
    profile: null,
    channels: [],
    joinedChannelIds: [],
    contacts: [
      { pubkey: 'aaa', lastMessage: 'hi', lastMessageAt: 1000, unread: 0 },
      { pubkey: 'bbb', lastMessage: 'hey', lastMessageAt: 900, unread: 0 },
    ],
    activeChatId: null,
    activeChatType: null,
    messages: {},
    profiles: {
      aaa: { name: 'Alice', picture: undefined, about: undefined, nip05: undefined },
      bbb: { name: 'Bob',   picture: undefined, about: undefined, nip05: undefined },
    },
    relays: [],
    mutedChats: {},
    activeSettingsTab: null,
    setShowAddContact: vi.fn(),
    setShowAddChannel: vi.fn(),
    setActiveChat: vi.fn(),
    setActiveSettingsTab: vi.fn(),
    logout: vi.fn(),
    joinChannel: vi.fn(),
    muteChatUntil: vi.fn(),
    unmuteChat: vi.fn(),
    setViewingProfilePubkey: vi.fn(),
  })
})

describe('Sidebar — Messages panel scoped search', () => {
  it('shows a search input when the Messages panel is open', async () => {
    render(<Sidebar />)
    openPanel('Messages')
    expect(screen.getByPlaceholderText('Search conversations…')).toBeInTheDocument()
  })

  it('filters contacts by name as the user types', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)
    openPanel('Messages')
    await user.type(screen.getByPlaceholderText('Search conversations…'), 'Ali')
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()
  })

  it('shows empty state when no contacts match', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)
    openPanel('Messages')
    await user.type(screen.getByPlaceholderText('Search conversations…'), 'xyz')
    expect(screen.getByText(/No conversations matching/)).toBeInTheDocument()
  })

  it('clears the filter when the X button is clicked', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)
    openPanel('Messages')
    const input = screen.getByPlaceholderText('Search conversations…')
    await user.type(input, 'Ali')
    await user.click(screen.getByRole('button', { name: /clear/i }))
    expect(input).toHaveValue('')
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('calls setShowAddContact when the new-message icon is clicked', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)
    openPanel('Messages')
    await user.click(screen.getByRole('button', { name: 'New Message' }))
    expect(useNostrStore.getState().setShowAddContact).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests — verify they all fail**

```bash
cd /Users/alvaro/Workspace/nostr-chat && npx vitest run src/__tests__/Sidebar.test.tsx 2>&1 | tail -20
```

Expected: failures like `Unable to find an element with the placeholder text: Search conversations…`

---

### Task 2: Write failing tests for Channels panel scoped search

**Files:**
- Modify: `src/__tests__/Sidebar.test.tsx`

- [ ] **Step 1: Add channels-panel tests below the existing describe block**

Append to `src/__tests__/Sidebar.test.tsx`:

```tsx
describe('Sidebar — Channels panel scoped search', () => {
  beforeEach(() => {
    useNostrStore.setState({
      channels: [
        { id: 'ch1', name: 'General', lastMessage: '', lastMessageAt: 1000, unread: 0, mentions: 0 },
        { id: 'ch2', name: 'Random',  lastMessage: '', lastMessageAt: 900,  unread: 0, mentions: 0 },
      ],
      joinedChannelIds: ['ch1', 'ch2'],
    })
  })

  it('shows a search input when the Channels panel is open', () => {
    render(<Sidebar />)
    openPanel('Channels')
    expect(screen.getByPlaceholderText('Search channels…')).toBeInTheDocument()
  })

  it('filters channels by name as the user types', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)
    openPanel('Channels')
    await user.type(screen.getByPlaceholderText('Search channels…'), 'Gen')
    expect(screen.getByText('General')).toBeInTheDocument()
    expect(screen.queryByText('Random')).not.toBeInTheDocument()
  })

  it('shows empty state when no channels match', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)
    openPanel('Channels')
    await user.type(screen.getByPlaceholderText('Search channels…'), 'xyz')
    expect(screen.getByText(/No channels matching/)).toBeInTheDocument()
  })

  it('calls setShowAddChannel when the add-channel icon is clicked', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)
    openPanel('Channels')
    await user.click(screen.getByRole('button', { name: 'Add / Discover Channels' }))
    expect(useNostrStore.getState().setShowAddChannel).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests — verify they all fail**

```bash
cd /Users/alvaro/Workspace/nostr-chat && npx vitest run src/__tests__/Sidebar.test.tsx 2>&1 | tail -20
```

Expected: all new tests fail

---

### Task 3: Add imports and state to Sidebar.tsx

**Files:**
- Modify: `src/components/Chat/Sidebar.tsx`

- [ ] **Step 1: Add `MessageCirclePlus` and `SquarePlus` to the lucide import**

In [Sidebar.tsx:2](src/components/Chat/Sidebar.tsx#L2), replace:

```ts
import { Hash, MessageCircle, Users, Settings, Plus, LogOut, Zap, X, Search, BellOff, Bell, User, Wifi, Key, Phone } from 'lucide-react'
```

with:

```ts
import { Hash, MessageCircle, MessageCirclePlus, SquarePlus, Users, Settings, Plus, LogOut, Zap, X, Search, BellOff, Bell, User, Wifi, Key, Phone } from 'lucide-react'
```

- [ ] **Step 2: Add the two new state variables inside the `Sidebar` component**

In [Sidebar.tsx:307](src/components/Chat/Sidebar.tsx#L307), after the existing state declarations:

```ts
const [activeSection, setActiveSection] = useState<SidebarSection | null>(null)
const [searchQuery, setSearchQuery] = useState('')
```

add:

```ts
const [dmSearchQuery, setDmSearchQuery] = useState('')
const [channelSearchQuery, setChannelSearchQuery] = useState('')
```

- [ ] **Step 3: Reset both queries in `closePanelOnly` and `closePanel`**

In [Sidebar.tsx:334](src/components/Chat/Sidebar.tsx#L334), replace:

```ts
const closePanelOnly = () => {
  setActiveSection(null)
  setSearchQuery('')
}
```

with:

```ts
const closePanelOnly = () => {
  setActiveSection(null)
  setSearchQuery('')
  setDmSearchQuery('')
  setChannelSearchQuery('')
}
```

(`closePanel` calls `closePanelOnly` so it inherits the reset automatically.)

- [ ] **Step 4: Run tests — same failures as before (no regressions)**

```bash
cd /Users/alvaro/Workspace/nostr-chat && npx vitest run src/__tests__/Sidebar.test.tsx 2>&1 | tail -20
```

---

### Task 4: Implement Messages panel changes

**Files:**
- Modify: `src/components/Chat/Sidebar.tsx`

- [ ] **Step 1: Extract filtered contacts list**

In [Sidebar.tsx:437](src/components/Chat/Sidebar.tsx#L437), replace the `messagesSection` variable with:

```tsx
const filteredContacts = dmSearchQuery.trim()
  ? contacts.filter(c => {
      const p = c.profile || profiles[c.pubkey]
      return getDisplayName(p, c.pubkey, 10).toLowerCase().includes(dmSearchQuery.trim().toLowerCase())
    })
  : contacts

const messagesSection = (
  <div className="flex flex-col h-full">
    {/* Search bar */}
    <div className="px-3 pt-3 pb-2 flex-shrink-0">
      <div className="flex items-center gap-2 bg-gray-800 rounded-xl px-3 py-2 border border-gray-700 focus-within:border-purple-500/50 transition-colors">
        <Search size={14} className="text-gray-500 flex-shrink-0" />
        <input
          type="text"
          value={dmSearchQuery}
          onChange={e => setDmSearchQuery(e.target.value)}
          placeholder="Search conversations…"
          className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none min-w-0"
        />
        {dmSearchQuery && (
          <button
            aria-label="clear"
            onClick={() => setDmSearchQuery('')}
            className="text-gray-500 hover:text-gray-300 flex-shrink-0"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
    <div className="flex-1 overflow-y-auto scrollbar-thin py-1 px-2 space-y-0.5">
      {filteredContacts.length === 0 && dmSearchQuery.trim() ? (
        <p className="text-gray-500 text-xs text-center px-4 py-6">No conversations matching "{dmSearchQuery.trim()}"</p>
      ) : filteredContacts.length === 0 ? (
        <p className="text-gray-500 text-xs text-center px-4 py-6">No conversations yet.</p>
      ) : (
        filteredContacts.map(c => (
          <ContactItem
            key={c.pubkey}
            contact={c}
            isActive={activeChatId === c.pubkey && activeChatType === 'dm'}
            onSelect={closePanel}
          />
        ))
      )}
    </div>
  </div>
)
```

- [ ] **Step 2: Update the Messages panel header to include the `MessageCirclePlus` icon button**

The panel header is shared between desktop and mobile — it lives in the `sectionBody` object's panel rendering, but the header itself is rendered outside `sectionBody` in the layout. Find the desktop panel header at [Sidebar.tsx:581](src/components/Chat/Sidebar.tsx#L581):

```tsx
<div className="flex items-center justify-between px-4 py-4 border-b border-gray-800 flex-shrink-0">
  <h2 className="font-bold text-white text-base">
    {activeSection ? SECTION_LABELS[activeSection] : ''}
  </h2>
  <button
    onClick={closePanel}
    className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
    aria-label="Close"
  >
    <X size={16} />
  </button>
</div>
```

Replace with:

```tsx
<div className="flex items-center justify-between px-4 py-4 border-b border-gray-800 flex-shrink-0">
  <h2 className="font-bold text-white text-base">
    {activeSection ? SECTION_LABELS[activeSection] : ''}
  </h2>
  <div className="flex items-center gap-1">
    {activeSection === 'messages' && (
      <button
        onClick={() => { setShowAddContact(true); closePanel() }}
        aria-label="New Message"
        title="New Message"
        className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-white/[0.08] transition-colors"
      >
        <MessageCirclePlus size={16} />
      </button>
    )}
    {activeSection === 'channels' && (
      <button
        onClick={() => { setShowAddChannel(true); closePanel() }}
        aria-label="Add / Discover Channels"
        title="Add / Discover Channels"
        className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-white/[0.08] transition-colors"
      >
        <SquarePlus size={16} />
      </button>
    )}
    <button
      onClick={closePanel}
      className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
      aria-label="Close"
    >
      <X size={16} />
    </button>
  </div>
</div>
```

- [ ] **Step 3: Apply the same header change to the mobile sheet header at [Sidebar.tsx:625](src/components/Chat/Sidebar.tsx#L625)**

Replace the mobile sheet header:

```tsx
<div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
  <h2 className="font-bold text-white text-base">
    {activeSection ? SECTION_LABELS[activeSection] : ''}
  </h2>
  <button
    onClick={closePanel}
    className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
    aria-label="Close"
  >
    <X size={16} />
  </button>
</div>
```

with:

```tsx
<div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
  <h2 className="font-bold text-white text-base">
    {activeSection ? SECTION_LABELS[activeSection] : ''}
  </h2>
  <div className="flex items-center gap-1">
    {activeSection === 'messages' && (
      <button
        onClick={() => { setShowAddContact(true); closePanel() }}
        aria-label="New Message"
        title="New Message"
        className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-white/[0.08] transition-colors"
      >
        <MessageCirclePlus size={16} />
      </button>
    )}
    {activeSection === 'channels' && (
      <button
        onClick={() => { setShowAddChannel(true); closePanel() }}
        aria-label="Add / Discover Channels"
        title="Add / Discover Channels"
        className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-white/[0.08] transition-colors"
      >
        <SquarePlus size={16} />
      </button>
    )}
    <button
      onClick={closePanel}
      className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
      aria-label="Close"
    >
      <X size={16} />
    </button>
  </div>
</div>
```

- [ ] **Step 4: Run the Messages-panel tests — verify they pass**

```bash
cd /Users/alvaro/Workspace/nostr-chat && npx vitest run src/__tests__/Sidebar.test.tsx --reporter=verbose 2>&1 | grep -E "✓|✗|PASS|FAIL|Error"
```

Expected: Messages panel describe block passes; Channels describe block still fails.

---

### Task 5: Implement Channels panel changes

**Files:**
- Modify: `src/components/Chat/Sidebar.tsx`

- [ ] **Step 1: Replace `channelsSection` with filtered version**

In [Sidebar.tsx:456](src/components/Chat/Sidebar.tsx#L456), replace the `channelsSection` variable with:

```tsx
const filteredChannels = channelSearchQuery.trim()
  ? joinedChannels.filter(ch =>
      ch.name.toLowerCase().includes(channelSearchQuery.trim().toLowerCase())
    )
  : joinedChannels

const channelsSection = (
  <div className="flex flex-col h-full">
    {/* Search bar */}
    <div className="px-3 pt-3 pb-2 flex-shrink-0">
      <div className="flex items-center gap-2 bg-gray-800 rounded-xl px-3 py-2 border border-gray-700 focus-within:border-purple-500/50 transition-colors">
        <Search size={14} className="text-gray-500 flex-shrink-0" />
        <input
          type="text"
          value={channelSearchQuery}
          onChange={e => setChannelSearchQuery(e.target.value)}
          placeholder="Search channels…"
          className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none min-w-0"
        />
        {channelSearchQuery && (
          <button
            aria-label="clear"
            onClick={() => setChannelSearchQuery('')}
            className="text-gray-500 hover:text-gray-300 flex-shrink-0"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
    <div className="flex-1 overflow-y-auto scrollbar-thin py-1 px-2 space-y-0.5">
      {filteredChannels.length === 0 && channelSearchQuery.trim() ? (
        <p className="text-gray-500 text-xs text-center px-4 py-6">No channels matching "{channelSearchQuery.trim()}"</p>
      ) : filteredChannels.length === 0 ? (
        <p className="text-gray-500 text-xs text-center px-4 py-6">No channels yet. Discover or create one above.</p>
      ) : (
        filteredChannels.map(ch => (
          <ChannelItem
            key={ch.id}
            channel={ch}
            isActive={activeChatId === ch.id && activeChatType === 'channel'}
            onSelect={closePanel}
          />
        ))
      )}
    </div>
  </div>
)
```

- [ ] **Step 2: Run all Sidebar tests — verify they all pass**

```bash
cd /Users/alvaro/Workspace/nostr-chat && npx vitest run src/__tests__/Sidebar.test.tsx --reporter=verbose 2>&1 | tail -30
```

Expected: all 9 tests pass

- [ ] **Step 3: Run the full test suite to check for regressions**

```bash
cd /Users/alvaro/Workspace/nostr-chat && npx vitest run 2>&1 | tail -20
```

Expected: all tests pass, no regressions

---

### Task 6: Clean up unused helpers and commit

**Files:**
- Modify: `src/components/Chat/Sidebar.tsx`

- [ ] **Step 1: Delete the `actionButton` helper — it's no longer called**

Both `messagesSection` (Task 4) and `channelsSection` (Task 5) now build their own search bars. Delete the `actionButton` function from [Sidebar.tsx:425](src/components/Chat/Sidebar.tsx#L425):

```ts
const actionButton = (label: string, onClick: () => void) => (
  <div className="px-3 pt-3 pb-2 flex-shrink-0">
    <button
      onClick={onClick}
      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold transition-colors"
    >
      <Plus size={16} />
      {label}
    </button>
  </div>
)
```

- [ ] **Step 2: Check whether `Plus` is still used**

```bash
grep -n "\bPlus\b" /Users/alvaro/Workspace/nostr-chat/src/components/Chat/Sidebar.tsx
```

If the only remaining hit is the import line, remove `Plus` from the lucide import. If it appears elsewhere, leave it.

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/alvaro/Workspace/nostr-chat && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
cd /Users/alvaro/Workspace/nostr-chat && git add src/components/Chat/Sidebar.tsx src/__tests__/Sidebar.test.tsx docs/superpowers/specs/2026-05-14-sidebar-scoped-search-design.md docs/superpowers/plans/2026-05-14-sidebar-scoped-search.md && git commit -m "feat: add scoped search and icon action buttons to Messages and Channels panels"
```
