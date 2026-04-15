# Feature Notes

## Unreleased

### Search Messages
- Search bar in the sidebar filters across all in-memory messages (channels + DMs)
- Starts searching after 2 characters are typed
- Results show chat name, sender, highlighted match snippet, and timestamp
- Sorted by most recent first (up to 50 results)
- Tab switcher hides while a search is active; cleared query restores normal view
- Clicking a result navigates to that chat (closes mobile drawer)

### Sidebar Width Fix
- Fixed desktop sidebar shrinking when switching to Messages or Contacts tabs
- Root cause: `sidebarContent` div lacked `w-full`, so flex child sized to content

_See [ReleaseNotes.md](./ReleaseNotes.md) for the full history._
