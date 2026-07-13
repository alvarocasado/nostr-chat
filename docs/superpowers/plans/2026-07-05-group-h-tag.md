# Group h-Tag Addressing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make private-group events publishable on strict public relays by moving the UUID group id from `e` tags (rejected as non-hex) to NIP-29-style `h` tags.

**Architecture:** Tag-letter swap with zero id migration: 2 publish builders emit `['h', groupId]`, 4 read filters switch to `'#h'`, and group routing reads the `h` tag via a new pure `extractGroupId`. Group ids, Dexie, store, invites, and key backups are untouched. Spec: `docs/superpowers/specs/2026-07-05-group-h-tag-design.md`.

**Tech Stack:** TypeScript, React, nostr-tools, Vitest.

## Global Constraints

- TDD: failing test first, then implementation.
- Conventional commits: `feat:` / `fix:` / `test:` / `docs:`.
- No emojis in code or comments.
- `npm test` does not typecheck; run `npx tsc -b --noEmit` (NOT plain `tsc --noEmit`, which checks nothing in this repo) before final commit. Repo uses `erasableSyntaxOnly` — no TS parameter properties in test stubs.
- Reply tags stay `['e', replyEventId, '', 'reply']` — reply targets are real 64-hex event ids.
- Channels keep `e` tags and `'#e'` filters everywhere (their ids are 64-hex event ids).
- No dual-read of old `#e` group events (spec: zero such events exist on any relay).

## Discovery correction folded into this plan

The spec lists group typing indicators as a change surface. Verified during planning: `useTypingIndicator` is only mounted for channels (`MessageThread.tsx:556`) and DMs (`MessageThread.tsx:648`) — **groups have no typing indicator**, so there is nothing to change. Task 1 amends the spec instead of building an unused code path.

---

### Task 1: Spec amendment + `extractGroupId` helper

**Files:**
- Modify: `docs/superpowers/specs/2026-07-05-group-h-tag-design.md` (typing bullet)
- Modify: `src/lib/inbox.ts` (next to `extractRootChatId`, ~line 205)
- Test: `src/__tests__/inbox.test.ts`

**Interfaces:**
- Produces: `extractGroupId(tags: string[][]): string | null` — first `h` tag value, null when absent/malformed. Task 3's routing depends on this exact name and signature.

- [ ] **Step 1: Amend the spec**

In `docs/superpowers/specs/2026-07-05-group-h-tag-design.md`, replace the
`buildTypingEvent` bullet under "Publish surfaces (3)" with:

```markdown
- Typing indicators: verified during planning that `useTypingIndicator` is
  mounted only for channels and DMs (`MessageThread.tsx`) — groups have no
  typing indicator, so no typing change is needed. If group typing is added
  later it must use `['h', groupId]` / `'#h'`.
```

and change the heading "Publish surfaces (3)" to "Publish surfaces (2)".
Also remove the group-typing filter line from "Read surfaces (5 filters +
routing)" and retitle it "Read surfaces (4 filters + routing)", and drop
"group typing indicator" from the live-verification list in Testing.

- [ ] **Step 2: Write the failing test**

Append to `src/__tests__/inbox.test.ts` (add `extractGroupId` to the existing
`../lib/inbox` import):

```ts
describe('extractGroupId', () => {
  it('returns the h tag value, ignoring e tags', () => {
    expect(extractGroupId([['e', 'reply-id', '', 'reply'], ['h', 'group-uuid']])).toBe('group-uuid')
  })

  it('returns null when there is no h tag', () => {
    expect(extractGroupId([['e', 'x'], ['p', 'y']])).toBeNull()
    expect(extractGroupId([])).toBeNull()
  })

  it('returns null for a malformed h tag with no value', () => {
    expect(extractGroupId([['h']])).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/inbox.test.ts`
Expected: FAIL — `extractGroupId` is not exported.

- [ ] **Step 4: Implement**

In `src/lib/inbox.ts`, directly below `extractRootChatId`:

```ts
/**
 * Resolve the private group an event belongs to from its h tag. Group ids
 * are UUIDs, not event ids, so they ride h tags — strict relays reject
 * non-hex values in e tags ("unexpected size for fixed-size tag").
 */
export function extractGroupId(tags: string[][]): string | null {
  return tags.find(t => t[0] === 'h')?.[1] ?? null
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/inbox.test.ts`
Expected: PASS (all tests, including pre-existing).

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-07-05-group-h-tag-design.md src/lib/inbox.ts src/__tests__/inbox.test.ts
git commit -m "feat: extractGroupId h-tag routing helper; spec typing correction"
```

---

### Task 2: Publish side — group messages and call presence emit h tags

**Files:**
- Modify: `src/lib/nostr.ts` (`buildGroupMessageEvent`, ~line 171)
- Modify: `src/lib/groupCall.ts` (`buildPresenceEvent`, ~line 35)
- Test: `src/__tests__/nostr.test.ts`, `src/__tests__/groupCall.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: kind-1042 events tagged `['h', groupId, relayUrl]` (+ optional `['e', replyEventId, '', 'reply']`); kind-24103 events tagged `['h', groupId]`. Task 3's filters must match these tags.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/nostr.test.ts`, add `buildChannelMessageEvent` to the
`../lib/nostr` import list, and append inside the existing
`describe('event kinds', ...)` block:

```ts
  it('tags group messages with h - group ids are UUIDs, strict relays reject non-hex e tags', async () => {
    const event = await buildGroupMessageEvent('ciphertext', 'group-uuid', 'wss://relay.example', 'a'.repeat(64))
    expect(event.tags).toEqual([
      ['h', 'group-uuid', 'wss://relay.example'],
      ['e', 'a'.repeat(64), '', 'reply'],
    ])
  })

  it('keeps channel messages on e tags - channel ids are real event ids', async () => {
    const event = await buildChannelMessageEvent('hi', 'c'.repeat(64), 'wss://relay.example')
    expect(event.tags[0]).toEqual(['e', 'c'.repeat(64), 'wss://relay.example', 'root'])
  })
```

In `src/__tests__/groupCall.test.ts`, change line 26 from:

```ts
    expect(event.tags).toEqual([['e', GROUP_ID]])
```

to:

```ts
    expect(event.tags).toEqual([['h', GROUP_ID]])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/nostr.test.ts src/__tests__/groupCall.test.ts`
Expected: FAIL — group message tags start with `['e', 'group-uuid', ...]`; presence tags are `[['e', ...]]`. The channel regression test passes already.

- [ ] **Step 3: Implement**

In `src/lib/nostr.ts`, `buildGroupMessageEvent`, replace:

```ts
  const tags: string[][] = [['e', groupId, relayUrl, 'root']]
  if (replyEventId) tags.push(['e', replyEventId, '', 'reply'])
```

with:

```ts
  // Group ids are UUIDs, not event ids: strict relays reject them in e tags,
  // so groups are addressed NIP-29-style via h. Replies still e-tag the
  // real target event id.
  const tags: string[][] = [['h', groupId, relayUrl]]
  if (replyEventId) tags.push(['e', replyEventId, '', 'reply'])
```

In `src/lib/groupCall.ts`, `buildPresenceEvent`, replace:

```ts
    tags: [['e', groupId]],
```

with:

```ts
    tags: [['h', groupId]],
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/nostr.test.ts src/__tests__/groupCall.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/nostr.ts src/lib/groupCall.ts src/__tests__/nostr.test.ts src/__tests__/groupCall.test.ts
git commit -m "feat: publish group messages and call presence with h tags"
```

---

### Task 3: Read side — filters and routing switch to #h

**Files:**
- Modify: `src/hooks/useNostrSubscriptions.ts` (`useGroupMessages` ~line 153; global groups sub ~lines 214-217)
- Modify: `src/lib/history.ts` (group branch, ~line 30)
- Modify: `src/contexts/GroupCallContext.tsx` (~line 331)
- Test: `src/__tests__/history.test.ts`, `src/__tests__/GroupCallContext.test.tsx`, `src/__tests__/useGlobalInbox.test.tsx`, `src/__tests__/inbox.test.ts` (fixture only)

**Interfaces:**
- Consumes: `extractGroupId` from `src/lib/inbox.ts` (Task 1); h-tag event shapes from Task 2.
- Produces: all group subscriptions/backfill filter on `'#h'`; the global groups handler routes by `extractGroupId`.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/history.test.ts`, the group-filter assertion (~line 67) changes from:

```ts
      { kinds: [GROUP_MESSAGE_KIND, LEGACY_GROUP_MESSAGE_KIND], '#e': ['grp'], until: 1000, limit: 50 },
```

to:

```ts
      { kinds: [GROUP_MESSAGE_KIND, LEGACY_GROUP_MESSAGE_KIND], '#h': ['grp'], until: 1000, limit: 50 },
```

In `src/__tests__/GroupCallContext.test.tsx` (~line 88), change the expected
presence filter from `{ kinds: [GROUP_CALL_PRESENCE_KIND], '#e': [GROUP_ID] }`
to `{ kinds: [GROUP_CALL_PRESENCE_KIND], '#h': [GROUP_ID] }`. In the same
file, update the `presenceEvent` helper (~line 60) fixture tag from
`tags: [['e', GROUP_ID]]` to `tags: [['h', GROUP_ID]]`.

In `src/__tests__/useGlobalInbox.test.tsx`, append:

```tsx
it('subscribes to groups with an #h filter and routes by the h tag', () => {
  installTestSigner()
  useNostrStore.setState({
    publicKey: PK,
    groups: [{ id: 'uuid-1', name: 'g', creatorPubkey: 'x', memberPubkeys: [], relayUrl: 'wss://test.example', unread: 0 }],
  })
  render(<Probe />)
  const filters = subscribeEvents.mock.calls.map(c => JSON.stringify(c[1]))
  expect(filters.some(f => f.includes('"#h":["uuid-1"]'))).toBe(true)
  expect(filters.some(f => f.includes('"#e":["uuid-1"]'))).toBe(false)
})
```

In `src/__tests__/inbox.test.ts`, update the `makeGroupEvent` fixture
(~line 276) from `tags: [['e', GROUP_ID, RELAYS[0], 'root']]` to
`tags: [['h', GROUP_ID, RELAYS[0]]]` so fixtures match the new wire shape
(`processGroupEvent` receives the groupId as a parameter, so this is
fidelity, not behavior).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/history.test.ts src/__tests__/GroupCallContext.test.tsx src/__tests__/useGlobalInbox.test.tsx src/__tests__/inbox.test.ts`
Expected: history and GroupCallContext filter assertions FAIL (still `#e`); the new useGlobalInbox test FAILS; inbox fixture change alone stays green.

- [ ] **Step 3: Implement**

In `src/lib/history.ts` (~line 30), change the group branch filter:

```ts
    return [{ kinds: [GROUP_MESSAGE_KIND, LEGACY_GROUP_MESSAGE_KIND], '#h': [chatId], until, limit }]
```

In `src/hooks/useNostrSubscriptions.ts`:

1. Add `extractGroupId` to the existing `../lib/inbox` import.
2. `useGroupMessages` (~line 153): filter becomes

```ts
      { kinds: [GROUP_MESSAGE_KIND, LEGACY_GROUP_MESSAGE_KIND], '#h': [groupId], limit: INITIAL_PAGE },
```

3. Global groups subscription (~lines 214-217): filter and routing become

```ts
      { kinds: [GROUP_MESSAGE_KIND, LEGACY_GROUP_MESSAGE_KIND], '#h': groupIds, limit: 50 },
      (event) => {
        const chatId = extractGroupId(event.tags)
        if (!chatId || !ids.has(chatId)) return
```

(the remainder of the handler is unchanged).

In `src/contexts/GroupCallContext.tsx` (~line 331), the presence filter becomes:

```ts
        { kinds: [GROUP_CALL_PRESENCE_KIND], '#h': [gid] },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/history.test.ts src/__tests__/GroupCallContext.test.tsx src/__tests__/useGlobalInbox.test.tsx src/__tests__/inbox.test.ts src/__tests__/GroupCallMesh.test.tsx src/__tests__/GroupCallBanner.test.tsx`
Expected: PASS (the two extra mesh/banner suites guard against presence-shape regressions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/history.ts src/hooks/useNostrSubscriptions.ts src/contexts/GroupCallContext.tsx src/__tests__/history.test.ts src/__tests__/GroupCallContext.test.tsx src/__tests__/useGlobalInbox.test.tsx src/__tests__/inbox.test.ts
git commit -m "feat: group subscriptions, backfill, and presence filter on #h"
```

---

### Task 4: Verification, FeatureNotes, close-out

**Files:**
- Modify: `FeatureNotes.md`

**Interfaces:**
- Consumes: everything above.
- Produces: green build, updated known-issues, pushed `develop`.

- [ ] **Step 1: Full verification**

```bash
npm test
npm run build
npx eslint src/lib/nostr.ts src/lib/groupCall.ts src/lib/history.ts src/lib/inbox.ts src/hooks/useNostrSubscriptions.ts src/contexts/GroupCallContext.tsx
```

Expected: all tests pass; `tsc -b` (inside `npm run build`) clean; lint clean.

- [ ] **Step 2: Update FeatureNotes.md**

In the "Known issues discovered during live verification (2026-07-05)"
section, replace the "Private groups cannot publish to strict public relays
(critical)" bullet with:

```markdown
- **Private groups on strict public relays — FIXED.** Group events now ride
  NIP-29-style `['h', groupId]` tags instead of non-hex `e` tags (which
  damus, nos.lol, and snort rejected). Group ids, storage, invites, and key
  backups are unchanged; no migration. Spec:
  `docs/superpowers/specs/2026-07-05-group-h-tag-design.md`. Live
  cross-account verification pending (group message both ways, group call
  banner + "started a call" row).
```

- [ ] **Step 3: Commit and push**

```bash
git add FeatureNotes.md
git commit -m "docs: mark group relay-compatibility issue fixed via h tags"
git push origin develop
```

- [ ] **Step 4: Live cross-account verification (manual, with the user)**

Same two-account setup as the 2026-07-05 session (Playwright client as
account B on localhost, user via devtunnel):

1. Send a message in "Call Test Group" from B → arrives on the user's side
   (impossible before this fix); reply back → arrives at B.
2. Start a group call from B → user sees the banner and notification;
   both threads show the "started a call" row (closes the deferred
   call-history checklist item).
3. Reload B mid-call → banner rederives from `#h` presence heartbeats.

Record results in FeatureNotes (append to the fixed bullet) and update the
manual-verification memory.
