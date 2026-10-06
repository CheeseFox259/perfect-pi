import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const MAX_HABIT_CHARS = 800;

/**
 * Normalize a model ID to a filesystem-safe habit filename (without extension).
 *
 *   MiniMax-M3.1-Flash-Preview  →  minimax-m3.1-flash-preview
 *   claude-sonnet-4-20250514    →  claude-sonnet-4-20250514
 *   DeepSeek_R1                 →  deepseek-r1
 */
export function normalizeModelId(modelId) {
  return modelId
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9.\-]/g, "");
}

/**
 * Return candidate filenames from most specific to least, by stripping
 * trailing hyphen-segments one at a time.
 *
 *   minimax-m3.1-flash-preview  →  [..., minimax-m3.1-flash, minimax-m3.1, minimax-m3, minimax]
 */
export function fallbackChain(normalized) {
  const candidates = [normalized];
  let current = normalized;
  while (current.includes("-")) {
    current = current.replace(/-[^-]+$/, "");
    candidates.push(current);
  }
  return candidates;
}

/**
 * Resolve the habits file for a model ID. Returns the file path and
 * resolved name, or null when nothing matches.
 */
export function resolveHabitsFile(habitsDir, modelId) {
  const candidates = fallbackChain(normalizeModelId(modelId));
  for (const name of candidates) {
    const path = join(habitsDir, `${name}.md`);
    if (existsSync(path)) return { path, name };
  }
  return null;
}

/**
 * Read a habits file and return the guideline lines (non-empty, trimmed,
 * stripped of leading `- `). Enforces the character budget.
 */
export function readHabits(filePath) {
  let content = readFileSync(filePath, "utf8").trim();
  const truncated = content.length > MAX_HABIT_CHARS;
  if (truncated) content = content.slice(0, MAX_HABIT_CHARS);
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.replace(/^[-*]\s+/, ""));
  return { lines, truncated };
}

/**
 * List all habit files in a directory.
 * Returns an array of { name, path, lineCount }.
 */
export function listHabits(habitsDir) {
  if (!existsSync(habitsDir)) return [];
  return readdirSync(habitsDir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const path = join(habitsDir, f);
      const content = readFileSync(path, "utf8").trim();
      const lineCount = content.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length;
      return { name: f.replace(/\.md$/, ""), path, lineCount };
    });
}
