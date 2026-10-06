import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  normalizeModelId,
  fallbackChain,
  resolveHabitsFile,
  readHabits,
  listHabits,
  MAX_HABIT_CHARS,
} from "./scripts/model-habits.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "habits-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ── normalizeModelId ──

test("normalizes casing, spaces, and underscores", () => {
  assert.equal(normalizeModelId("MiniMax-M3.1-Flash-Preview"), "minimax-m3.1-flash-preview");
  assert.equal(normalizeModelId("DeepSeek_R1"), "deepseek-r1");
  assert.equal(normalizeModelId("Claude Sonnet 4"), "claude-sonnet-4");
  assert.equal(normalizeModelId("gpt-4o-2024-08-06"), "gpt-4o-2024-08-06");
});

test("strips non-alphanumeric characters except hyphens and dots", () => {
  assert.equal(normalizeModelId("model/v2@preview"), "modelv2preview");
  assert.equal(normalizeModelId("gemini-2.5-pro"), "gemini-2.5-pro");
});

// ── fallbackChain ──

test("generates a progressively shorter fallback chain", () => {
  assert.deepEqual(fallbackChain("minimax-m3.1-flash-preview"), [
    "minimax-m3.1-flash-preview",
    "minimax-m3.1-flash",
    "minimax-m3.1",
    "minimax",
  ]);
});

test("single-segment model has no fallback", () => {
  assert.deepEqual(fallbackChain("llama"), ["llama"]);
});

// ── resolveHabitsFile ──

test("resolves exact match first", (t) => {
  const dir = fixture(t);
  writeFileSync(join(dir, "minimax-m3.1-flash-preview.md"), "- exact");
  writeFileSync(join(dir, "minimax-m3.1.md"), "- family");
  const result = resolveHabitsFile(dir, "MiniMax-M3.1-Flash-Preview");
  assert.equal(result?.name, "minimax-m3.1-flash-preview");
});

test("falls back to family-level file", (t) => {
  const dir = fixture(t);
  writeFileSync(join(dir, "minimax.md"), "- vendor-level");
  const result = resolveHabitsFile(dir, "MiniMax-M3.1-Flash-Preview");
  assert.equal(result?.name, "minimax");
});

test("returns null when nothing matches", (t) => {
  const dir = fixture(t);
  assert.equal(resolveHabitsFile(dir, "unknown-model"), null);
});

test("different providers for the same model resolve the same file", (t) => {
  const dir = fixture(t);
  writeFileSync(join(dir, "deepseek-r1.md"), "- shared habit");
  const a = resolveHabitsFile(dir, "deepseek-r1");
  const b = resolveHabitsFile(dir, "deepseek-r1");
  assert.equal(a?.name, b?.name);
  assert.equal(a?.name, "deepseek-r1");
});

// ── readHabits ──

test("reads lines, strips markers and comments", (t) => {
  const dir = fixture(t);
  const file = join(dir, "test.md");
  writeFileSync(file, "# Header\n- Rule one.\n* Rule two.\n\n  - Rule three.\n");
  const { lines, truncated } = readHabits(file);
  assert.deepEqual(lines, ["Rule one.", "Rule two.", "Rule three."]);
  assert.equal(truncated, false);
});

test("truncates content exceeding the character limit", (t) => {
  const dir = fixture(t);
  const file = join(dir, "long.md");
  writeFileSync(file, "- " + "x".repeat(MAX_HABIT_CHARS + 100) + "\n");
  const { lines, truncated } = readHabits(file);
  assert.equal(truncated, true);
  assert.ok(lines[0].length < MAX_HABIT_CHARS + 100);
});

test("empty file returns no lines", (t) => {
  const dir = fixture(t);
  const file = join(dir, "empty.md");
  writeFileSync(file, "\n\n");
  const { lines } = readHabits(file);
  assert.equal(lines.length, 0);
});

// ── listHabits ──

test("lists habits with line counts", (t) => {
  const dir = fixture(t);
  writeFileSync(join(dir, "model-a.md"), "- one\n- two\n");
  writeFileSync(join(dir, "model-b.md"), "- single\n");
  writeFileSync(join(dir, "not-a-habit.txt"), "ignored");
  const list = listHabits(dir);
  assert.equal(list.length, 2);
  assert.equal(list[0].name, "model-a");
  assert.equal(list[0].lineCount, 2);
  assert.equal(list[1].name, "model-b");
  assert.equal(list[1].lineCount, 1);
});

test("returns empty array for nonexistent directory", () => {
  assert.deepEqual(listHabits("/nonexistent/path"), []);
});

// ── Integration: before_agent_start injection simulation ──

test("extension logic injects habits into promptGuidelines for matching model", (t) => {
  const dir = fixture(t);
  mkdirSync(join(dir, "habits"));
  writeFileSync(join(dir, "habits", "test-model.md"), "- Always set timeout.\n- Never use sleep.\n");

  const guidelines = [];
  const resolved = resolveHabitsFile(join(dir, "habits"), "test-model");
  assert.ok(resolved);
  const { lines } = readHabits(resolved.path);
  for (const line of lines) guidelines.push(line);

  assert.deepEqual(guidelines, ["Always set timeout.", "Never use sleep."]);
});

test("no injection when model has no habits file", (t) => {
  const dir = fixture(t);
  mkdirSync(join(dir, "habits"));
  assert.equal(resolveHabitsFile(join(dir, "habits"), "nonexistent-model"), null);
});

// ── setup.mjs and doctor.mjs integration ──

test("setup dry-run succeeds with habits directory", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, [
    "setup.mjs", "--dry-run", "--skip-package-install", "--skip-skill-install",
  ], { encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
});

test("doctor reports model habits sync status", async () => {
  const { spawnSync } = await import("node:child_process");
  // Sync first so habits are present
  spawnSync(process.execPath, [
    "setup.mjs", "--skip-package-install", "--skip-skill-install",
  ], { encoding: "utf8", timeout: 30000 });
  const result = spawnSync(process.execPath, ["doctor.mjs"], {
    encoding: "utf8", timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /model habits/);
  assert.match(result.stdout, /SYNCED/);
});
