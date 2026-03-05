# CORS Hardening Plan — 2026-03-05

Issue: #3 — Add Origin validation and CORS hardening

## Problem

1. **`direct-terminal-ws.ts`**: No Origin checking on WebSocket upgrades. Any website can open `ws://localhost:14801/ws?session=ao-1` and get full PTY access.
2. **`terminal-websocket.ts`**: Returns `Access-Control-Allow-Origin: *` when Origin header is `null` — exploitable from `file://` pages, `data:` URIs, and sandboxed iframes.
3. **API routes**: No CSRF protection for state-changing browser-based requests.

## Solution

### Task 1: Create shared Origin validation utility

Create `packages/web/server/origin-validation.ts` with:

- `isAllowedOrigin(origin: string | undefined, allowedOrigins?: string[]): boolean`
  - Default allowlist: `["http://localhost", "https://localhost", "http://127.0.0.1", "https://127.0.0.1"]` (with any port)
  - Support configurable additional origins via `AO_ALLOWED_ORIGINS` env var (comma-separated)
  - Reject `null` origins (from `file://`, `data:` URIs, sandboxed iframes)
  - Reject undefined/missing origins for WebSocket upgrades (server-to-server OK for HTTP API)

### Task 2: Add `verifyClient` to `direct-terminal-ws.ts`

Add a `verifyClient` callback to the `WebSocketServer` constructor that:
- Extracts Origin from the upgrade request
- Calls `isAllowedOrigin()` to validate
- Rejects with 403 if Origin is not allowed

### Task 3: Fix CORS in `terminal-websocket.ts`

Replace the existing CORS logic:
- Remove the `Access-Control-Allow-Origin: *` fallback for null origins
- Use `isAllowedOrigin()` to validate the Origin header
- Only set `Access-Control-Allow-Origin` to the exact origin if it passes validation
- Add `Vary: Origin` header for correct caching behavior

### Task 4: Add CSRF protection for Next.js API routes

Create `packages/web/src/middleware.ts` (Next.js middleware) that:
- Applies to all `/api/*` routes
- For state-changing methods (POST, PUT, DELETE, PATCH):
  - Check Origin header against the same allowlist
  - If Origin is missing (non-browser clients), allow the request (CLI compatibility)
  - If Origin is present but not in allowlist, return 403
- For GET/HEAD/OPTIONS: allow (read-only, no CSRF risk)

### Task 5: Add tests

- Unit tests for `origin-validation.ts`
- Update `direct-terminal-ws.integration.test.ts` to test Origin validation
- Test the CORS logic changes in `terminal-websocket.ts`
- Test the middleware CSRF protection

## Files to Create/Modify

- **Create:** `packages/web/server/origin-validation.ts`
- **Create:** `packages/web/server/__tests__/origin-validation.test.ts`
- **Create:** `packages/web/src/middleware.ts`
- **Modify:** `packages/web/server/direct-terminal-ws.ts`
- **Modify:** `packages/web/server/terminal-websocket.ts`
- **Modify:** `packages/web/server/__tests__/direct-terminal-ws.integration.test.ts`
