import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readLastJsonlEntry, parseShellCommand } from "../utils.js";

describe("readLastJsonlEntry", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  function setup(content: string): string {
    tmpDir = mkdtempSync(join(tmpdir(), "ao-utils-test-"));
    const filePath = join(tmpDir, "test.jsonl");
    writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  it("returns null for empty file", async () => {
    const path = setup("");
    expect(await readLastJsonlEntry(path)).toBeNull();
  });

  it("returns null for nonexistent file", async () => {
    expect(await readLastJsonlEntry("/tmp/nonexistent-ao-test.jsonl")).toBeNull();
  });

  it("reads last entry type from single-line JSONL", async () => {
    const path = setup('{"type":"assistant","message":"hello"}\n');
    const result = await readLastJsonlEntry(path);
    expect(result).not.toBeNull();
    expect(result!.lastType).toBe("assistant");
  });

  it("reads last entry from multi-line JSONL", async () => {
    const path = setup(
      '{"type":"human","text":"hi"}\n{"type":"assistant","text":"hello"}\n{"type":"result","text":"done"}\n',
    );
    const result = await readLastJsonlEntry(path);
    expect(result!.lastType).toBe("result");
  });

  it("handles trailing newlines", async () => {
    const path = setup('{"type":"done"}\n\n\n');
    const result = await readLastJsonlEntry(path);
    expect(result!.lastType).toBe("done");
  });

  it("returns lastType null for entry without type field", async () => {
    const path = setup('{"message":"no type"}\n');
    const result = await readLastJsonlEntry(path);
    expect(result).not.toBeNull();
    expect(result!.lastType).toBeNull();
  });

  it("returns null for invalid JSON", async () => {
    const path = setup("not json at all\n");
    expect(await readLastJsonlEntry(path)).toBeNull();
  });

  it("handles multi-byte UTF-8 characters in JSONL entries", async () => {
    // Create a JSONL entry with multi-byte characters (CJK, emoji)
    const entry = { type: "assistant", text: "日本語テスト 🎉 données résumé" };
    const path = setup(JSON.stringify(entry) + "\n");
    const result = await readLastJsonlEntry(path);
    expect(result!.lastType).toBe("assistant");
  });

  it("handles multi-byte UTF-8 at chunk boundaries", async () => {
    // Create content larger than the 4096 byte chunk size with multi-byte
    // characters that could straddle a boundary. Each 🎉 is 4 bytes.
    const padding = '{"type":"padding","data":"' + "x".repeat(4080) + '"}\n';
    // The emoji-heavy last line will be at a chunk boundary
    const lastLine = { type: "final", text: "🎉".repeat(100) };
    const path = setup(padding + JSON.stringify(lastLine) + "\n");
    const result = await readLastJsonlEntry(path);
    expect(result!.lastType).toBe("final");
  });

  it("returns modifiedAt as a Date", async () => {
    const path = setup('{"type":"test"}\n');
    const result = await readLastJsonlEntry(path);
    expect(result!.modifiedAt).toBeInstanceOf(Date);
  });
});

describe("parseShellCommand", () => {
  it("parses a simple command", () => {
    expect(parseShellCommand("echo hello")).toEqual({ file: "echo", args: ["hello"] });
  });

  it("parses a command with multiple arguments", () => {
    expect(parseShellCommand("claude --model sonnet-4 --flag")).toEqual({
      file: "claude",
      args: ["--model", "sonnet-4", "--flag"],
    });
  });

  it("parses single-quoted arguments", () => {
    expect(parseShellCommand("claude --model 'sonnet-4'")).toEqual({
      file: "claude",
      args: ["--model", "sonnet-4"],
    });
  });

  it("parses double-quoted arguments without shell features", () => {
    expect(parseShellCommand('claude --model "sonnet-4"')).toEqual({
      file: "claude",
      args: ["--model", "sonnet-4"],
    });
  });

  it("handles escaped single quotes in single-quoted strings", () => {
    // 'it'\''s' is the POSIX way to embed a single quote
    expect(parseShellCommand("echo 'it'\\''s'")).toEqual(null);
    // Backslash outside quotes is a shell metacharacter
  });

  it("handles adjacent quoted and unquoted segments", () => {
    expect(parseShellCommand("echo 'hello'world")).toEqual({
      file: "echo",
      args: ["helloworld"],
    });
  });

  it("returns null for empty string", () => {
    expect(parseShellCommand("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseShellCommand("   ")).toBeNull();
  });

  it("returns null for command substitution with $()", () => {
    expect(parseShellCommand('echo "$(cat file)"')).toBeNull();
  });

  it("returns null for backtick command substitution", () => {
    expect(parseShellCommand("echo `cat file`")).toBeNull();
  });

  it("returns null for pipes", () => {
    expect(parseShellCommand("echo hello | cat")).toBeNull();
  });

  it("returns null for redirects", () => {
    expect(parseShellCommand("echo hello > file.txt")).toBeNull();
  });

  it("returns null for semicolons", () => {
    expect(parseShellCommand("echo hello; echo world")).toBeNull();
  });

  it("returns null for background operator", () => {
    expect(parseShellCommand("echo hello &")).toBeNull();
  });

  it("returns null for backslash (escape character)", () => {
    expect(parseShellCommand("echo hello\\ world")).toBeNull();
  });

  it("returns null for unterminated single quote", () => {
    expect(parseShellCommand("echo 'hello")).toBeNull();
  });

  it("returns null for unterminated double quote", () => {
    expect(parseShellCommand('echo "hello')).toBeNull();
  });

  it("returns null for dollar sign in double quotes", () => {
    expect(parseShellCommand('echo "$HOME"')).toBeNull();
  });

  it("parses a command with no arguments", () => {
    expect(parseShellCommand("cat")).toEqual({ file: "cat", args: [] });
  });

  it("handles tabs between arguments", () => {
    expect(parseShellCommand("echo\thello\tworld")).toEqual({
      file: "echo",
      args: ["hello", "world"],
    });
  });

  it("handles leading and trailing whitespace", () => {
    expect(parseShellCommand("  echo hello  ")).toEqual({
      file: "echo",
      args: ["hello"],
    });
  });

  it("parses realistic claude-code launch command without shell features", () => {
    expect(
      parseShellCommand("claude --dangerously-skip-permissions --model 'sonnet-4'"),
    ).toEqual({
      file: "claude",
      args: ["--dangerously-skip-permissions", "--model", "sonnet-4"],
    });
  });

  it("returns null for realistic claude-code command with $(cat ...)", () => {
    expect(
      parseShellCommand(
        "claude --append-system-prompt \"$(cat '/tmp/prompt.txt')\" --model 'sonnet-4'",
      ),
    ).toBeNull();
  });
});
