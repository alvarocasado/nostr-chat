# UI Design Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a "modern messenger" visual upgrade to the sidebar icon rail, message bubbles, and compose input bar — surgical Tailwind class swaps only, no structural changes.

**Architecture:** Four files touched: `Sidebar.tsx` (logo gradient, active icon/row states, avatar ring), `MessageItem.tsx` (own bubble gradient+glow, incoming bubble refinement, avatar rings), `MessageThread.tsx` (floating pill input, circular send button). All changes are cosmetic — no logic, no props, no new components.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v3 (JIT), Vitest, Playwright MCP for visual validation.

---

## File Map

| File | What changes |
|---|---|
| `src/components/Chat/Sidebar.tsx` | Logo mark gradient; `NavRailButton` active state; `ChannelItem` / `ContactItem` / settings active row state; bottom user avatar ring |
| `src/components/Chat/MessageItem.tsx` | Own bubble: gradient + glow + rounding; incoming bubble: darker bg + border + rounding; sender avatar gradient ring |
| `src/components/Chat/MessageThread.tsx` | `MessageInput` outer wrapper: remove border-t, match bg; input row: pill shape + elevation shadow; send button: circle + gradient; recording row: pill shape |

---

## Task 1: Baseline — confirm tests pass

**Files:**
- Run: project root

- [ ] **Step 1: Run the test suite to establish a green baseline**

```bash
npm run test
```

Expected: all tests pass (output shows no failures). If any fail, note them — they are pre-existing failures, not caused by this work.

- [ ] **Step 2: Run the TypeScript build to confirm zero type errors**

```bash
npm run build
```

Expected: build completes with no errors.

---

## Task 2: Sidebar — logo gradient + active icon state + active row states

**Files:**
- Modify: `src/components/Chat/Sidebar.tsx`

### Logo mark

- [ ] **Step 1: Update the logo `div` — add gradient and glow shadow**

In `Sidebar.tsx` around line 556, find:
```tsx
<div className="w-9 h-9 bg-purple-600 rounded-xl flex items-center justify-center mb-3 flex-shrink-0">
```

Replace with:
```tsx
<div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-purple-700 rounded-xl flex items-center justify-center mb-3 flex-shrink-0 shadow-[0_2px_10px_rgba(124,58,237,0.35)]">
```

### NavRailButton active state

- [ ] **Step 2: Update the `NavRailButton` active className**

Find the `NavRailButton` function (around line 256). Find this className expression in its return:
```tsx
active
  ? 'bg-purple-600 text-white'
  : danger
  ? 'text-gray-500 hover:text-red-400 hover:bg-red-500/10'
  : 'text-gray-500 hover:text-white hover:bg-white/10'
```

Replace with:
```tsx
active
  ? 'bg-gradient-to-br from-violet-500/20 to-purple-700/20 text-white border border-violet-500/40 shadow-[0_0_8px_rgba(124,58,237,0.15)]'
  : danger
  ? 'text-gray-500 hover:text-red-400 hover:bg-red-500/10'
  : 'text-gray-500 hover:text-white hover:bg-white/[0.08]'
```

### ChannelItem active row state

- [ ] **Step 3: Update `ChannelItem` active button className**

Find the `ChannelItem` function (around line 144). In the button's className, find:
```tsx
isActive
  ? 'bg-purple-600/20 border border-purple-500/30 text-white'
  : 'hover:bg-white/5 text-gray-300 hover:text-white'
```

Replace with:
```tsx
isActive
  ? 'bg-gradient-to-br from-violet-500/15 to-purple-700/15 border border-violet-500/40 text-white shadow-[0_0_8px_rgba(124,58,237,0.10)]'
  : 'hover:bg-white/5 text-gray-300 hover:text-white'
```

### ContactItem active row state

- [ ] **Step 4: Update `ContactItem` active div className**

Find the `ContactItem` function (around line 197). In the role="button" div's className, find:
```tsx
isActive
  ? 'bg-purple-600/20 border border-purple-500/30 text-white'
  : 'hover:bg-white/5 text-gray-300 hover:text-white'
```

Replace with:
```tsx
isActive
  ? 'bg-gradient-to-br from-violet-500/15 to-purple-700/15 border border-violet-500/40 text-white shadow-[0_0_8px_rgba(124,58,237,0.10)]'
  : 'hover:bg-white/5 text-gray-300 hover:text-white'
```

### Settings tab active row state

- [ ] **Step 5: Update the settings tab active className**

In the settings `sectionBody` (around line 498–519), find the settings tab button className:
```tsx
activeSettingsTab === tab
  ? 'bg-purple-600/20 border border-purple-500/30 text-white'
  : 'text-gray-300 hover:bg-white/5 hover:text-white'
```

Replace with:
```tsx
activeSettingsTab === tab
  ? 'bg-gradient-to-br from-violet-500/15 to-purple-700/15 border border-violet-500/40 text-white shadow-[0_0_8px_rgba(124,58,237,0.10)]'
  : 'text-gray-300 hover:bg-white/5 hover:text-white'
```

- [ ] **Step 6: Run tests — confirm no regressions**

```bash
npm run test
```

Expected: same pass/fail as baseline.

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/Sidebar.tsx
git commit -m "feat: sidebar gradient active states and logo glow"
```

---

## Task 3: Sidebar — bottom user avatar gradient ring

**Files:**
- Modify: `src/components/Chat/Sidebar.tsx`

- [ ] **Step 1: Wrap the bottom-rail avatar in a gradient ring**

In `Sidebar.tsx` around line 574, find:
```tsx
{/* User avatar */}
<div className="my-1">
  <Avatar picture={myProfile?.picture} name={myName} pubkey={publicKey || ''} size="sm" />
</div>
```

Replace with:
```tsx
{/* User avatar */}
<div className="my-1 p-[1.5px] bg-gradient-to-br from-violet-500 to-cyan-400 rounded-full flex-shrink-0">
  <div className="bg-gray-900 rounded-full">
    <Avatar picture={myProfile?.picture} name={myName} pubkey={publicKey || ''} size="sm" />
  </div>
</div>
```

- [ ] **Step 2: Run tests — confirm no regressions**

```bash
npm run test
```

Expected: same pass/fail as baseline.

- [ ] **Step 3: Commit**

```bash
git add src/components/Chat/Sidebar.tsx
git commit -m "feat: gradient ring on sidebar user avatar"
```

---

## Task 4: Own message bubble — gradient, glow, and rounding

**Files:**
- Modify: `src/components/Chat/MessageItem.tsx`

- [ ] **Step 1: Update the own-message bubble div**

In `MessageItem.tsx` around line 280, in the `isOwn` branch, find:
```tsx
className="bg-purple-600 rounded-2xl rounded-br-md px-4 py-2.5 flex flex-col gap-2 min-w-0 overflow-hidden"
```

Replace with:
```tsx
className="bg-gradient-to-br from-violet-500 to-purple-700 rounded-[18px] rounded-br-[4px] px-4 py-2.5 flex flex-col gap-2 min-w-0 overflow-hidden shadow-[0_4px_16px_rgba(124,58,237,0.35)]"
```

- [ ] **Step 2: Run tests — confirm no regressions**

```bash
npm run test
```

Expected: same pass/fail as baseline.

- [ ] **Step 3: Commit**

```bash
git add src/components/Chat/MessageItem.tsx
git commit -m "feat: gradient glow on own message bubbles"
```

---

## Task 5: Incoming bubble refinement + sender avatar ring

**Files:**
- Modify: `src/components/Chat/MessageItem.tsx`

### Incoming bubble

- [ ] **Step 1: Update the incoming message bubble div**

In `MessageItem.tsx` around line 307, in the `!isOwn` branch, find:
```tsx
className="bg-gray-800 rounded-2xl rounded-bl-md px-4 py-2.5 flex flex-col gap-2 min-w-0 overflow-hidden"
```

Replace with:
```tsx
className="bg-[#13131f] border border-[#1e1e30] rounded-[18px] rounded-bl-[4px] px-4 py-2.5 flex flex-col gap-2 min-w-0 overflow-hidden"
```

### Sender avatar ring

- [ ] **Step 2: Wrap the sender avatar in a gradient ring**

In `MessageItem.tsx` around line 294, in the `!isOwn` return, find the `w-8 flex-shrink-0` column div:
```tsx
<div className="w-8 flex-shrink-0">
  {showAvatar && (
    <Avatar picture={profile?.picture} name={name} pubkey={message.pubkey} size="sm" onClick={() => setViewingProfilePubkey(message.pubkey)} />
  )}
</div>
```

Replace with:
```tsx
<div className="w-8 flex-shrink-0">
  {showAvatar && (
    <div className="p-[1.5px] bg-gradient-to-br from-violet-500 to-cyan-400 rounded-full">
      <div className="bg-gray-950 rounded-full">
        <Avatar picture={profile?.picture} name={name} pubkey={message.pubkey} size="sm" onClick={() => setViewingProfilePubkey(message.pubkey)} />
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 3: Run tests — confirm no regressions**

```bash
npm run test
```

Expected: same pass/fail as baseline.

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat/MessageItem.tsx
git commit -m "feat: incoming bubble refinement and sender avatar gradient ring"
```

---

## Task 6: Floating pill input bar + circular gradient send button

**Files:**
- Modify: `src/components/Chat/MessageThread.tsx`

### Outer wrapper — remove border-t, match thread background

- [ ] **Step 1: Update the `MessageInput` outer container div**

In `MessageThread.tsx` around line 272, find the outer `div` of the `MessageInput` return:
```tsx
<div
  className="px-3 py-3 border-t border-gray-800 bg-gray-900"
  style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
>
```

Replace with:
```tsx
<div
  className="px-3 py-3 bg-gray-950"
  style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
>
```

### Normal input row — floating pill

- [ ] **Step 2: Update the normal input row wrapper div**

Find (around line 380):
```tsx
<div className="flex items-end gap-2 bg-gray-800 rounded-2xl px-3 py-2.5">
```

Replace with:
```tsx
<div className="flex items-end gap-2 bg-[#10101c] rounded-[28px] px-4 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.45),0_0_0_1px_rgba(255,255,255,0.05)]">
```

### Send button — circle + gradient

- [ ] **Step 3: Update the send button**

Find (around line 422):
```tsx
className="w-10 h-10 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl flex items-center justify-center transition-colors flex-shrink-0"
```

Replace with:
```tsx
className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-700 hover:from-violet-400 hover:to-purple-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-full flex items-center justify-center transition-all flex-shrink-0 shadow-[0_4px_12px_rgba(124,58,237,0.45)]"
```

### Recording row — pill shape to match

- [ ] **Step 4: Update the recording row wrapper div**

Find (around line 357):
```tsx
<div className="flex items-center gap-3 bg-gray-800 rounded-2xl px-4 py-3">
```

Replace with:
```tsx
<div className="flex items-center gap-3 bg-[#10101c] rounded-[28px] px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.45),0_0_0_1px_rgba(255,255,255,0.05)]">
```

- [ ] **Step 5: Update the stop-recording button to match rounded-full**

Find (around line 362):
```tsx
className="w-9 h-9 bg-red-600 hover:bg-red-500 disabled:opacity-40 rounded-xl flex items-center justify-center transition-colors flex-shrink-0"
```

Replace with:
```tsx
className="w-9 h-9 bg-red-600 hover:bg-red-500 disabled:opacity-40 rounded-full flex items-center justify-center transition-colors flex-shrink-0"
```

- [ ] **Step 6: Run tests — confirm no regressions**

```bash
npm run test
```

Expected: same pass/fail as baseline.

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/MessageThread.tsx
git commit -m "feat: floating pill input bar with circular gradient send button"
```

---

## Task 7: Final verification — build + visual validation

**Files:**
- Run: project root

- [ ] **Step 1: TypeScript build — confirm zero type errors**

```bash
npm run build
```

Expected: exits 0, no TypeScript errors.

- [ ] **Step 2: Start the dev server**

```bash
npm run dev
```

Expected: server starts on `http://localhost:5173` (or nearest free port — check terminal output).

- [ ] **Step 3: Visual validation via Playwright MCP — login screen loads**

Use the Playwright MCP tool to navigate to `http://localhost:5173` and take a screenshot. Confirm the login screen renders without layout breakage.

- [ ] **Step 4: Visual validation — message thread**

Log in (use an existing nsec or generate a new key). Navigate to a DM conversation. Take a screenshot. Confirm:
- Own messages show a violet→purple gradient bubble with visible glow
- Incoming messages show a darker background with a subtle border
- Input bar is pill-shaped with no top border-line separating it from the thread
- Send button is circular with a gradient

- [ ] **Step 5: Visual validation — sidebar**

Open the Messages panel in the sidebar. Click a contact to make it the active item. Take a screenshot. Confirm:
- Active contact row shows gradient tint with a border
- Logo mark in the icon rail shows a gradient with a soft glow
- Active nav rail icon has a gradient tint and border

- [ ] **Step 6: Regression check — attachment preview, reply banner, upload progress**

Attach a file and confirm the attachment preview renders correctly above the pill input. Start a reply (hover a message → click Reply) and confirm the reply banner appears above the pill. Confirm the pill shape holds with these banners visible.

- [ ] **Step 7: Regression check — mobile layout**

Resize browser to 375px wide. Confirm the bottom nav still renders correctly and the floating pill input respects safe-area padding.

- [ ] **Step 8: Stop the dev server and summarise**

Stop the dev server (`Ctrl+C`). All tasks complete. Changes landed in 3 commits across `Sidebar.tsx`, `MessageItem.tsx`, and `MessageThread.tsx`.

---

## Success Criteria (from spec)

- [ ] Own message bubbles show a violet→purple gradient with a visible glow shadow
- [ ] Sidebar active icon uses gradient background tint with a matching border and glow
- [ ] Input bar is a pill shape (`rounded-[28px]`) with elevation shadow and no border-top separator
- [ ] Send button is circular (`rounded-full`) with gradient and glow
- [ ] All existing Vitest tests still pass
- [ ] `npm run build` exits clean
