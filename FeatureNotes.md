# Feature Notes

## Unreleased

### Bug Fixes

#### Test Suite — CI Stability and Node.js 25 Compatibility
- Fixed an uncaught exception that caused CI to fail despite all 177 tests passing: `fetchEvents` was not mocked in the test setup, so `syncFromRelays` made real `SimplePool` WebSocket connections on login; these resolved asynchronously after tests ended, triggering an undici/JSDOM cross-realm `Event` class mismatch
- Fixed `localStorage` failures on Node.js 25+, which ships a native `localStorage` stub that shadows JSDOM's implementation and doesn't function without `--localstorage-file`; replaced with an in-memory mock in the test setup

