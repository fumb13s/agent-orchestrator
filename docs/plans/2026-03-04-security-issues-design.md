# Security Issues Design — 2026-03-04

Based on the full repository security review (commit 690bd9e), this document defines 5 GitHub issues to address the findings.

## Context

The security review identified 2 HIGH-confidence vulnerabilities (unauthenticated API routes and unauthenticated WebSocket terminal) and several lower-confidence hardening opportunities. Issues are split by fix type rather than by finding.

## Issues

### Issue 1: Add authentication to API routes and WebSocket endpoints

**Priority:** HIGH | **Labels:** `security`

Add token-based authentication across all privileged endpoints:

- **Next.js API routes:** `/api/spawn`, `/api/sessions/:id/send`, `/api/sessions/:id/kill`, `/api/prs/:id/merge`
- **WebSocket server:** `direct-terminal-ws.ts` — add `verifyClient` callback
- **Terminal server:** `terminal-websocket.ts` — validate tokens on HTTP requests
- **Health endpoint:** authenticate or remove session ID listing from `/health`

**Approach:** Generate a shared secret at startup, require it via `Authorization` header (HTTP) and query param or first-message handshake (WebSocket).

**Files:**
- `packages/web/src/app/api/spawn/route.ts`
- `packages/web/src/app/api/sessions/[id]/send/route.ts`
- `packages/web/src/app/api/sessions/[id]/kill/route.ts`
- `packages/web/src/app/api/prs/[id]/merge/route.ts`
- `packages/web/server/direct-terminal-ws.ts`
- `packages/web/server/terminal-websocket.ts`

---

### Issue 2: Bind all servers to 127.0.0.1 by default

**Priority:** HIGH | **Labels:** `security`

All three servers currently bind to `0.0.0.0`:

- Next.js dashboard (port 3000) — no `--hostname` flag in spawn call
- Terminal WebSocket (port 14800) — no host arg in `server.listen()`
- Direct terminal WS (port 14801) — no host arg in `server.listen()`

**Fix:** Change defaults to `127.0.0.1`. Add a `--host` CLI flag / config option to opt in to network exposure.

**Files:**
- `packages/cli/src/commands/dashboard.ts` (Next.js spawn)
- `packages/web/server/terminal-websocket.ts`
- `packages/web/server/direct-terminal-ws.ts`

---

### Issue 3: Add Origin validation and CORS hardening

**Priority:** HIGH | **Labels:** `security`

- `direct-terminal-ws.ts`: No Origin checking on WebSocket upgrades — malicious websites can connect cross-origin
- `terminal-websocket.ts`: Returns `Access-Control-Allow-Origin: *` when Origin is `null` (exploitable from `file://`, `data:` URIs, sandboxed iframes)
- API routes: No CSRF protection

**Fix:** Add Origin allowlist to WebSocket servers and CSRF tokens for browser-based API access.

**Files:**
- `packages/web/server/direct-terminal-ws.ts`
- `packages/web/server/terminal-websocket.ts`
- `packages/web/src/app/api/` (all routes)

---

### Issue 4: Use unpredictable session identifiers

**Priority:** LOW | **Labels:** `security`, `hardening`

Session IDs are sequential (`ao-1`, `ao-2`, ...) and leaked via the unauthenticated `/health` endpoint. Replace with random/UUID-based IDs as defense-in-depth against auth bypass.

**Files:**
- `packages/core/src/session-manager.ts`

---

### Issue 5: Refactor runtime-process to avoid `shell: true`

**Priority:** LOW | **Labels:** `security`, `hardening`

`runtime-process/src/index.ts` uses `spawn(cmd, { shell: true })`. Currently safe because all inputs come from trusted YAML config with correct `shellEscape()`. But `shell: true` is a latent injection risk if future features route untrusted data into the launch command. Refactor to use argument arrays or add lint/safety guardrails.

**Files:**
- `packages/plugins/runtime-process/src/index.ts`
- `packages/plugins/agent-claude-code/src/index.ts` (launch command construction)
- `packages/core/src/utils.ts` (`shellEscape`)
