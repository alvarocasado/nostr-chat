# Feature Notes

## Unreleased

### Sidebar redesign — icon rail + collapsible sections
- Replaced the single full-width sidebar with a narrow icon rail (56 px) whose icons open collapsible section panels
- Icon rail order: Search · Messages · Channels · Contacts — spacer — Settings · Avatar · Logout
- Clicking an active icon collapses its panel; selecting a chat auto-collapses the panel
- Settings fires the modal directly without opening a panel
- Contacts section is "Add Contact" only; Messages section handles DM list and new-message flow
- Section panel slides in next to the rail on desktop, pushing the message thread to the right (300 ms ease-in-out)
- Mobile: fixed bottom nav bar (Search / Messages / Channels / Contacts / Settings) replaces the hamburger drawer; tapping an icon slides up a sheet from above the nav bar; profile + logout live in the sheet footer
- Removed the mobile "Open Menu" top bar and the hamburger button from the empty-chat state

