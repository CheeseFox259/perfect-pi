#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cases = [
  ["trivial", "direct", "Fix the typo in README.md"],
  ["bug", "diagnosing-bugs", "The save button intermittently throws an unexplained error. Diagnose the bug."],
  ["unclear-feature", "grill-with-docs", "Add team invitations. The product behavior and requirements are not decided yet."],
  ["huge", "wayfinder", "Replace authorization across a large multi-service application. The approach is unclear and spans multiple sessions."],
  ["review", "code-review", "Review the current branch changes for regressions."],
  ["verification", "verify-product", "The implementation is finished. Verify the user-facing checkout flow and report evidence."],
];
const cwd = process.env.ROUTE_TEST_CWD || "/Users/superhacker";
const root = mkdtempSync(join(tmpdir(), "perfect-pi-route-"));
const results = [];
try {
  for (const [name, expectedRoute, request] of cases) {
    const result = spawnSync("pi", ["--no-session", "--mode", "json", "--print", `/skill:route ${request}`], {
      cwd,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    const events = result.stdout.split("\n").filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    const assistantMessages = events
      .filter((event) => event.type === "message_end" && event.message?.role === "assistant")
      .map((event) => event.message);
    const finalText = assistantMessages.at(-1)?.content
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n") ?? "";
    const toolCalls = events
      .filter((event) => event.type === "tool_execution_start")
      .map((event) => event.toolName);
    const usage = assistantMessages.map((message) => message.usage).filter(Boolean);
    const pass = result.status === 0
      && new RegExp(`Route:\\s*${expectedRoute}`, "i").test(finalText)
      && /Why:/i.test(finalText)
      && /Next:/i.test(finalText)
      && toolCalls.length === 0;
    results.push({ name, expectedRoute, request, status: result.status, signal: result.signal, pass, finalText, toolCalls, usage, stderr: result.stderr.trim() });
  }
  const outputPath = process.argv[2] ?? join(root, "route-results.json");
  writeFileSync(outputPath, `${JSON.stringify({ cwd, results }, null, 2)}\n`);
  console.log(JSON.stringify({ outputPath, results }, null, 2));
  if (results.some((result) => !result.pass)) process.exitCode = 1;
} finally {
  if (!process.argv[2]) rmSync(root, { recursive: true, force: true });
}
