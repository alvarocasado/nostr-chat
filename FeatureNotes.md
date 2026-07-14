# Feature Notes

## Unreleased

- **Group member management + key rotation** (2026-07-13). Spec:
  `docs/superpowers/specs/2026-07-13-group-rekey-design.md`. Creator-only
  add/remove via the new Members panel (group header). Removal mints a new
  AES-GCM epoch key, distributed to remaining members as NIP-04 `group_rekey`
  DMs; the removed member gets a courtesy `group_remove` notice and a
  disabled thread. Old epochs stay in `groupKeyHistory` so history remains
  readable; decryption falls back newest→oldest. Kind-30041 backups now carry
  the full epoch list as JSON (legacy bare-hex backups still parse). New
  members receive only the current epoch key. Membership propagates via an
  in-group `members` control (creator-signed only), which also fixes invitee
  member counts. Accepted limits: no admin transfer, no forward secrecy
  within an epoch (MLS later), removed members keep pre-removal history,
  old-epoch key holders can still inject messages into the group (writes are
  UI-gated, not crypto-enforced), authorization is client-side
  creator-signature checking.
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
