# UI Design Improvement — Modern Messenger Aesthetic

**Date:** 2026-05-11
**Status:** Approved
**Scope:** Sidebar navigation, message bubbles, message input bar

---

## Goal

Upgrade the visual design of the three most-used surfaces — sidebar rail, message thread, and compose bar — to a "modern messenger" aesthetic. The app keeps its current dark purple brand; changes are cosmetic and surgical (Tailwind class swaps, no structural refactoring).

---

## Decisions

| Question | Decision |
|---|---|
| Overall direction | Modern Messenger (Signal/Telegram feel) |
| Sidebar structure | Keep icon rail + slide-in panels (no structural change) |
| Message bubbles | Gradient + glow on own messages |
| Input bar | Floating pill with circular gradient send button |
| Implementation strategy | Approach A — surgical Tailwind class swaps across 4 files |

---

## Design Spec

### 1. Sidebar — Icon Rail (`Sidebar.tsx`)

**Logo mark**
- Keep `bg-purple-600` → replace with `bg-gradient-to-br from-violet-500 to-purple-700`
- Add `shadow-[0_2px_10px_rgba(124,58,237,0.35)]`

**Active nav icon** (currently `bg-purple-600/20 border border-purple-500/30`)
- Background: `bg-gradient-to-br from-violet-500/15 to-purple-700/15`
- Border: `border border-violet-500/40`
- Subtle glow: `shadow-[0_0_8px_rgba(124,58,237,0.15)]`

**Inactive nav icon hover**
- Keep `hover:bg-white/10` → upgrade to `hover:bg-white/[0.08]` (arbitrary opacity, slightly less bright on hover)

**User avatar (bottom of rail)**
- Add a 1.5px gradient ring: wrap in a `div` with `bg-gradient-to-br from-violet-500 to-cyan-400 rounded-full p-[1.5px]`
- Inner `div` with `bg-gray-700 rounded-full` to create the ring gap

**Active contact/channel row** (in slide-in panel, currently `bg-purple-600/20 border border-purple-500/30`)
- Same treatment as active nav icon above

---

### 2. Message Bubbles (`MessageItem.tsx`)

**Own messages** (currently `bg-purple-600 rounded-2xl rounded-br-md`)
- Background: `bg-gradient-to-br from-violet-500 to-purple-700`
- Tail rounding: `rounded-[18px] rounded-br-[4px]` (explicit values for consistency)
- Glow shadow: `shadow-[0_4px_16px_rgba(124,58,237,0.35)]`

**Incoming messages** (currently `bg-gray-800 rounded-2xl rounded-bl-md`)
- Background: `bg-[#13131f]`
- Border: add `border border-[#1e1e30]`
- Tail rounding: `rounded-[18px] rounded-bl-[4px]`

**Sender avatar** (shown when `showAvatar` is true)
- Add gradient ring: same `p-[1.5px]` wrapper technique as sidebar

**Timestamps**
- No structural change — keep current placement, update color from `text-gray-600` to `text-gray-700` for slightly less visual noise

---

### 3. Message Input Bar (`MessageThread.tsx` — `MessageInput` component)

**Wrapper** (currently `flex items-end gap-2 bg-gray-800 rounded-2xl px-3 py-2.5`)
- Shape: `rounded-[28px]` (full pill)
- Background: `bg-[#10101c]`
- Remove the explicit border, replace with a shadow that implies elevation:
  `shadow-[0_8px_24px_rgba(0,0,0,0.45),0_0_0_1px_rgba(255,255,255,0.05)]`
- Padding: `px-4 py-2` (slightly more horizontal padding)

**Send button** (currently `w-10 h-10 bg-purple-600 rounded-xl`)
- Shape: `rounded-full` (circle)
- Background: `bg-gradient-to-br from-violet-500 to-purple-700`
- Glow: `shadow-[0_4px_12px_rgba(124,58,237,0.45)]`

**Recording row** — same pill treatment: `rounded-[28px] bg-[#10101c] shadow-[0_8px_24px_rgba(0,0,0,0.45),...]`

**Outer padding** (currently `px-3 py-3 border-t border-gray-800 bg-gray-900`)
- Remove `border-t border-gray-800` (floating pill implies separation without a line)
- Change `bg-gray-900` → `bg-gray-950` to match the thread background
- Keep existing safe-area padding

---

## Files Changed

| File | Changes |
|---|---|
| `src/components/Chat/Sidebar.tsx` | Logo gradient, active icon state, avatar ring, active row state |
| `src/components/Chat/MessageItem.tsx` | Own bubble gradient+glow, incoming bubble darker+border, avatar ring |
| `src/components/Chat/MessageThread.tsx` | Floating pill input, circular send button, remove border-t on wrapper |
| `src/index.css` | No changes required |

---

## Out of Scope

- Login screen
- Settings screens
- Call overlay / incoming call UI
- Mobile bottom nav (no changes — existing colors carry through)
- Any structural/layout changes
- Animation / transition changes beyond what already exists

---

## Success Criteria

- Own message bubbles show a violet→purple gradient with a visible glow shadow
- Sidebar active icon uses gradient background with a matching glow
- Input bar is a pill shape with a circular gradient send button, no border-top separator
- No regressions in: reply UI, attachment previews, upload progress, recording row, rate-limit indicator, mobile layout
