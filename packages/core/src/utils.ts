/**
 * Shared utility functions for agent-orchestrator plugins.
 */

import { open, stat } from "node:fs/promises";

/**
 * POSIX-safe shell escaping: wraps value in single quotes,
 * escaping any embedded single quotes as '\\'' .
 *
 * Safe for use in both `sh -c` and `execFile` contexts.
 */
export function shellEscape(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/**
 * Escape a string for safe interpolation inside AppleScript double-quoted strings.
 * Handles backslashes and double quotes which would otherwise break or inject.
 */
export function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Shell metacharacters that require shell interpretation.
 * If any of these appear unquoted in a command string, the command
 * cannot be safely split into argv without a shell.
 */
const SHELL_META = /[|&;<>`${}()\n\\]/;

/**
 * Parse a shell command string into a file and argument array.
 *
 * Handles single-quoted and double-quoted strings. Returns `null` if
 * the command contains unquoted shell metacharacters (pipes, redirects,
 * command substitution, etc.) that require a real shell to interpret.
 *
 * This enables `spawn(file, args)` (no shell) for simple commands while
 * falling back to `spawn(cmd, { shell: true })` for complex ones.
 */
export function parseShellCommand(cmd: string): { file: string; args: string[] } | null {
  const trimmed = cmd.trim();
  if (!trimmed) return null;

  const tokens: string[] = [];
  let i = 0;

  while (i < trimmed.length) {
    // Skip whitespace between tokens
    if (trimmed[i] === " " || trimmed[i] === "\t") {
      i++;
      continue;
    }

    let token = "";

    while (i < trimmed.length && trimmed[i] !== " " && trimmed[i] !== "\t") {
      const ch = trimmed[i];

      if (ch === "'") {
        // Single-quoted string: everything until the next unescaped '
        i++; // skip opening quote
        while (i < trimmed.length && trimmed[i] !== "'") {
          token += trimmed[i];
          i++;
        }
        if (i >= trimmed.length) return null; // unterminated quote
        i++; // skip closing quote
      } else if (ch === '"') {
        // Double-quoted string: check for shell metacharacters inside
        i++; // skip opening quote
        while (i < trimmed.length && trimmed[i] !== '"') {
          if (trimmed[i] === "\\") {
            // Backslash inside double quotes — shell metacharacter
            return null;
          }
          if (trimmed[i] === "$" || trimmed[i] === "`") {
            // Variable expansion or command substitution — needs shell
            return null;
          }
          token += trimmed[i];
          i++;
        }
        if (i >= trimmed.length) return null; // unterminated quote
        i++; // skip closing quote
      } else {
        // Unquoted character — check for shell metacharacters
        if (SHELL_META.test(ch)) return null;
        token += ch;
        i++;
      }
    }

    tokens.push(token);
  }

  if (tokens.length === 0) return null;

  return { file: tokens[0], args: tokens.slice(1) };
}

/**
 * Validate that a URL starts with http:// or https://.
 * Throws with a descriptive error including the plugin label if invalid.
 */
export function validateUrl(url: string, label: string): void {
  if (!url.startsWith("https://") && !url.startsWith("http://")) {
    throw new Error(`[${label}] Invalid url: must be http(s), got "${url}"`);
  }
}

/**
 * Read the last line from a file by reading backwards from the end.
 * Pure Node.js — no external binaries. Handles any file size.
 */
async function readLastLine(filePath: string): Promise<string | null> {
  const CHUNK = 4096;
  const fh = await open(filePath, "r");
  try {
    const { size } = await fh.stat();
    if (size === 0) return null;

    // Read backwards in chunks, accumulating raw buffers to avoid
    // corrupting multi-byte UTF-8 characters at chunk boundaries.
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let pos = size;

    while (pos > 0) {
      const readSize = Math.min(CHUNK, pos);
      pos -= readSize;
      const chunk = Buffer.alloc(readSize);
      await fh.read(chunk, 0, readSize, pos);
      chunks.unshift(chunk);
      totalBytes += readSize;

      // Convert all accumulated bytes to string at once (safe for multi-byte)
      const tail = Buffer.concat(chunks, totalBytes).toString("utf-8");

      // Find the last non-empty line
      const lines = tail.split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line) {
          // If i > 0, we have a complete line (there's a newline before it)
          // If i === 0 and pos === 0, we've read the whole file — line is complete
          // If i === 0 and pos > 0, the line may be truncated — keep reading
          if (i > 0 || pos === 0) return line;
        }
      }
    }

    const tail = Buffer.concat(chunks, totalBytes).toString("utf-8");
    return tail.trim() || null;
  } finally {
    await fh.close();
  }
}

/**
 * Read the last entry from a JSONL file.
 * Reads backwards from end of file — pure Node.js, no external binaries.
 *
 * @param filePath - Path to the JSONL file
 * @returns Object containing the last entry's type and file mtime, or null if empty/invalid
 */
export async function readLastJsonlEntry(
  filePath: string,
): Promise<{ lastType: string | null; modifiedAt: Date } | null> {
  try {
    const [line, fileStat] = await Promise.all([readLastLine(filePath), stat(filePath)]);


    if (!line) return null;

    const parsed: unknown = JSON.parse(line);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const lastType = typeof obj.type === "string" ? obj.type : null;
      return { lastType, modifiedAt: fileStat.mtime };
    }

    return { lastType: null, modifiedAt: fileStat.mtime };
  } catch {
    return null;
  }
}
