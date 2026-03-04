# Bind All Servers to 127.0.0.1 by Default

**Issue:** #2
**Date:** 2026-03-05

## Problem

All three servers (Next.js dashboard, Terminal WebSocket, Direct Terminal WS) bind to `0.0.0.0`, making them accessible from the entire local network. This is a security risk for a development tool that manages terminal sessions and code execution.

## Solution

Default all server bindings to `127.0.0.1` (localhost only). Add a `host` config option and `--host` CLI flag to opt in to network exposure when needed.

## Tasks

### 1. Add `host` to config schema and types

- **`packages/core/src/types.ts`**: Add `host?: string` to `OrchestratorConfig`
- **`packages/core/src/config.ts`**: Add `host` field to Zod schema with default `"127.0.0.1"`

### 2. Pass host through dashboard env

- **`packages/cli/src/lib/web-dir.ts`**: Accept `host` parameter in `buildDashboardEnv()`, set `HOST` and `TERMINAL_HOST` env vars
- **`packages/cli/src/commands/dashboard.ts`**: Add `--host` CLI option, pass `-H <host>` to `next dev`, pass host to `buildDashboardEnv()`
- **`packages/cli/src/commands/start.ts`**: Pass host through to `startDashboard()` and `buildDashboardEnv()`

### 3. Bind terminal servers to host

- **`packages/web/server/terminal-websocket.ts`**: Read `TERMINAL_HOST` env var (default `127.0.0.1`), pass to `server.listen(PORT, HOST)`
- **`packages/web/server/direct-terminal-ws.ts`**: Read `TERMINAL_HOST` env var (default `127.0.0.1`), pass to `server.listen(PORT, HOST)`

### 4. Update example config

- **`agent-orchestrator.yaml.example`**: Add commented `host: 127.0.0.1` option with explanation

### 5. Verify

- Typecheck passes
- Lint passes
