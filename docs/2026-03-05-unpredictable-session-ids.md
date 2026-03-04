# Unpredictable Session Identifiers

## Problem

Session IDs are sequential (`ao-1`, `ao-2`, ...) making them trivially enumerable.
This is a defense-in-depth issue: if an attacker bypasses authentication (see issue #1),
sequential IDs let them enumerate all sessions by simply incrementing a counter.

## Design

Replace the sequential number suffix with a random hex string while keeping the
human-readable prefix. Example: `ao-a7f3b2` instead of `ao-1`.

### Format

- **Session ID:** `{prefix}-{6-hex}` (e.g., `ao-a7f3b2`, `int-c4e9d1`)
- **Tmux name:** `{config-hash}-{prefix}-{6-hex}` (e.g., `a3b4c5d6e7f8-ao-a7f3b2`)

6 hex characters = 24 bits = ~16.7 million possible values per prefix.
Birthday paradox gives 50% collision at ~4096 sessions, which is well beyond any
practical usage. The existing `reserveSessionId()` atomic reservation loop handles
collisions gracefully by retrying.

### Changes

1. **`packages/core/src/paths.ts`**
   - Add `generateRandomSuffix()` that returns 6 random hex characters using `node:crypto`
   - Update `generateSessionName()` to use random suffix instead of sequential number
   - Update `generateTmuxName()` to use random suffix instead of sequential number
   - Update `parseTmuxName()` regex to accept hex suffixes instead of digits-only

2. **`packages/core/src/session-manager.ts`**
   - Remove `getNextSessionNumber()` function (no longer needed)
   - Update `spawn()` to generate random session IDs via the new functions
   - The `reserveSessionId()` loop already handles collisions; just need to generate
     new random suffixes on retry instead of incrementing
   - Update tmux name generation to match

3. **`packages/core/src/metadata.ts`**
   - The `VALID_SESSION_ID` regex (`/^[a-zA-Z0-9_-]+$/`) already accepts hex characters.
     No changes needed.

4. **Tests**
   - Update `packages/core/src/__tests__/paths.test.ts` to expect hex suffixes
   - Update `packages/core/src/__tests__/session-manager.test.ts` for new ID format
   - Verify collision retry behavior still works

### Backwards Compatibility

- Existing sessions with numeric IDs (e.g., `ao-1`) remain valid per the
  `VALID_SESSION_ID` regex. They continue to work for list/get/kill/restore.
- New sessions get random hex suffixes. No migration needed.
- The `parseTmuxName()` function needs to accept both old numeric and new hex formats
  during the transition period.

### Not in Scope

- The `/health` endpoint leaking session IDs (addressed by issue #1's auth work)
- Any changes to the metadata file format
