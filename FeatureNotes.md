# Feature Notes

## Unreleased

### File Attachment Limit Raised to 50 MB
- Maximum attachment size increased from 10 MB to 50 MB — covers typical iPhone videos
- Chunk size doubled (53 KB → 100 KB base64) to keep event count comparable to before (~500 events for a 50 MB file vs ~1 250 with the old chunk size)
- Receive-side GC timeout extended from 5 min to 15 min so large transfers are not pruned mid-flight
