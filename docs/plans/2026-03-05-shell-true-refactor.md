# Plan: Refactor runtime-process to avoid shell: true

## Problem

`runtime-process/src/index.ts` uses `spawn(cmd, { shell: true })` which is a latent
command injection risk. While currently safe (inputs come from trusted YAML config
and `shellEscape()`), `shell: true` means any future code path that routes untrusted
data into the launch command could introduce a command injection vulnerability.

## Analysis

### Why shell: true exists today

The `launchCommand` field is a **single string** (not an array). It's produced by
`Agent.getLaunchCommand()` which concatenates command + flags + shell-escaped arguments
into a single string like:

```
claude --model 'sonnet-4' --append-system-prompt "$(cat '/tmp/prompt.txt')"
```

Key observations:
1. **tmux runtime** sends this string via `tmux send-keys`, which runs it in a shell
   inherently -- `shell: true` is not its concern.
2. **process runtime** uses `spawn(cmd, { shell: true })` to execute this string. The
   shell interprets the quoting, `$(...)` expansion, etc.
3. Some agent plugins (claude-code, aider) use `$(cat ...)` for system prompt injection,
   which requires shell expansion.

### The interface boundary

`RuntimeCreateConfig.launchCommand` is typed as `string`. Changing it to `string[]`
would be a breaking interface change affecting all runtimes and all agent plugins.

### Approach: Parse shell string into argv, fall back to shell for complex commands

The safest incremental approach:
1. **Try to parse** the launch command as a simple command (no shell metacharacters).
2. If the command is simple (no pipes, redirects, `$(...)`, backticks, etc.), use
   `spawn(file, args)` without `shell: true`.
3. If the command contains shell features, fall back to `spawn(cmd, { shell: true })`
   with a logged warning.

This eliminates `shell: true` for the common case (most agent commands are just
`binary --flag1 val1 --flag2 val2`) while preserving compatibility for commands that
genuinely need shell features.

## Tasks

### Task 1: Add shell command parser utility

Add a `parseShellCommand(cmd: string): { file: string; args: string[] } | null`
function to `packages/core/src/utils.ts` that:
- Handles single-quoted strings (`'...'`)
- Handles double-quoted strings (`"..."`)
- Handles unquoted words
- Returns `null` if the command contains shell metacharacters: `|`, `&`, `;`, `$(`,
  `` ` ``, `>`, `<`, `{`, `}`, `(`, `)`, `\n`
- Properly unquotes arguments (removes surrounding quotes, handles `'\''` escape)

### Task 2: Refactor runtime-process to use parsed commands

Modify `runtime-process/src/index.ts`:
- Import `parseShellCommand` from `@composio/ao-core`
- Before spawning, attempt to parse the launch command
- If parsing succeeds: `spawn(file, args, { shell: false, ... })`
- If parsing returns null (shell features detected): fall back to
  `spawn(cmd, { shell: true, ... })` (existing behavior)

### Task 3: Update tests

Update `runtime-process/src/__tests__/index.test.ts`:
- Update existing tests that assert `shell: true` to reflect new behavior
- Add test for simple commands (no shell) -> `shell: false` with parsed args
- Add test for commands with `$(...)` -> falls back to `shell: true`
- Add test for commands with pipes -> falls back to `shell: true`

### Task 4: Add unit tests for parseShellCommand

Add tests for the parser utility covering:
- Simple command: `echo hello` -> `{ file: "echo", args: ["hello"] }`
- Single-quoted args: `claude --model 'sonnet-4'` -> proper unquoting
- Double-quoted args: `claude --model "sonnet-4"` -> proper unquoting
- Shell metacharacters return null: `echo $(cat file)`, `cmd1 | cmd2`, etc.
- Empty string edge case
- Embedded escaped quotes in single quotes: `'it'\''s'`

### Task 5: Export parseShellCommand from @composio/ao-core

Add the export to `packages/core/src/index.ts` so runtime-process can import it.

### Task 6: Build, lint, typecheck, test

Run `pnpm build && pnpm lint && pnpm typecheck && pnpm test` to verify everything works.
