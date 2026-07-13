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
