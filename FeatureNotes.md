# Feature Notes

## Unreleased

### Settings as a first-class screen
- Settings is no longer a modal; it opens in the main area as a full-width page
- The Settings section in the sidebar shows a vertical menu: Profile · Relays · Keys · Calls · Notifications
- Clicking a menu item opens that settings screen in the main area (replaces the chat view)
- Closing the settings section panel (X or clicking the Settings rail icon again) returns the main area to chat
- `IceFailureBanner` "Settings → Calls" link navigates directly to the Calls settings screen
- Added `activeSettingsTab: SettingsTab | null` to the store; removed the modal-based `showSettings` flow from App.tsx

### Sidebar redesign — icon rail + collapsible sections
- Replaced the single full-width sidebar with a narrow icon rail (56 px) whose icons open collapsible section panels
- Icon rail order: Search · Messages · Channels · Contacts — spacer — Settings · Avatar · Logout
- Clicking an active icon collapses its panel; selecting a chat auto-collapses the panel
- Settings fires the modal directly without opening a panel
- Contacts section is "Add Contact" only; Messages section handles DM list and new-message flow
- Section panel slides in next to the rail on desktop, pushing the message thread to the right (300 ms ease-in-out)
- Mobile: fixed bottom nav bar (Search / Messages / Channels / Contacts / Settings) replaces the hamburger drawer; tapping an icon slides up a sheet from above the nav bar; profile + logout live in the sheet footer
- Removed the mobile "Open Menu" top bar and the hamburger button from the empty-chat state

