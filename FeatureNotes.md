# Feature Notes

## Unreleased

- **useChatThread extraction + MessageThread tests** (2026-07-13). Priority 4
  code-quality item from the functional analysis. The three thread variants
  (channel / DM / group) shared ~200 duplicated lines of state, optimistic
  publish, retry, and react/edit/delete logic; that now lives in
  `src/hooks/useChatThread.ts` behind per-chat-type closures (guard,
  targetRelays, sendContent, sendReaction). MessageThread.tsx drops from 951
  to 723 lines. New tests: `useChatThread.test.tsx` (publish/retry/reply/guard
  flow) and `MessageThread.test.tsx` (render paths for empty state, channel,
  pending-DM banner, group with/without key). No behavior change intended; the
  only intentional cleanup is dropping GroupThread's redundant
  `setReplyTo(null)` on send (MessageInput already cancels the reply).
  Remaining in Priority 4: Sidebar.tsx has grown to 975 lines (over the
  800-line standard) and deserves the same treatment.
- **Sidebar split** (2026-07-13). Same Priority 4 treatment: the
  self-contained list-item components (SearchResultItem, MuteButton,
  ChannelItem, ContactItem, GroupItem, plus the private formatTime/Highlight
  helpers and the SearchResult type) moved verbatim to
  `src/components/Chat/SidebarItems.tsx`. Sidebar.tsx drops from 975 to 689
  lines. Pure move — no logic or markup changes; existing Sidebar tests
  cover the moved items through the panel flows. This closes the Priority 4
  file-size items from the functional analysis.
