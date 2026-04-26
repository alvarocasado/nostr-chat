# Feature Notes

## Unreleased

### Always-Visible Timestamps
- Message timestamps are now always shown next to each bubble instead of appearing only on hover — fixes mobile where hover never fires

### Message Send Status
- Own messages show a live status indicator next to the timestamp: spinning clock while sending, checkmark on success, red alert icon on failure
- Tapping the red alert icon retries the failed send — the original signed event is reused so no new event is created
- Optimistic messages use the real event ID (built before publishing), so the relay echo is silently deduplicated with no duplicate bubbles
- Applies to regular text/inline-attachment messages in both channels and DMs; chunked file transfers use a separate flow and are unaffected

