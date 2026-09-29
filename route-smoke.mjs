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
  ["snapshot-review", "code-review", "Audit the current complete perfect-pi configuration and workflow logic; this is not a commit diff."],
  ["working-tree-review", "code-review", "Review my current staged, unstaged and untracked work before I commit it."],
  ["immediate-implementation", "implement", "Implement the agreed CSV export now. The direction and acceptance criteria are settled and the work fits this session."],
  ["verification", "verify-product", "The implementation is finished. Verify the user-facing checkout flow and report evidence."],
  ["cross-session-feature", "to-spec", "The direction is agreed: add a per-tenant rate limiter to the public API. I am not going to implement it in this session, so I need a written spec that implementation can follow in a fresh session later."],
  ["small-deferred-task", "to-spec", "Fix this one-line CLI option typo next week in a fresh session. The change is tiny and the desired behavior is settled; please capture the decision and test expectation for later, not implement it now."],
  ["slice-a-plan", "to-tickets", "There is a spec at .scratch/team-invites/spec.md. Break it into vertical-slice tickets with blocking edges. It is more than one session of work."],
  ["implement-a-ticket-graph", "implement-spec", "The spec at .scratch/team-invites/spec.md already has a ticket graph. Implement the frontier tickets using subagents and worktrees."],
];
const cwd = process.env.ROUTE_TEST_CWD || process.cwd();
const modelArgs = process.env.PI_EVAL_MODEL ? ["--model", process.env.PI_EVAL_MODEL] : [];
const root = mkdtempSync(join(tmpdir(), "perfect-pi-route-"));
const results = [];
try {
  for (const [name, expectedRoute, request] of cases) {
    const result = spawnSync("pi", [...modelArgs, "--no-session", "--mode", "json", "--print", `/skill:route ${request}`], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
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
    // The route name may arrive wrapped in markdown emphasis or quotes.
    const pass = result.status === 0
      && new RegExp(`Route:\\s*[\`'"*_]*${expectedRoute}`, "i").test(finalText)
      && /Why:/i.test(finalText)
      && /Next:/i.test(finalText)
      && toolCalls.length === 0;
    console.log(`${pass ? "PASS" : "FAIL"} ${name}: ${expectedRoute}`);
    results.push({ name, expectedRoute, request, status: result.status, signal: result.signal, pass, finalText, toolCalls, usage, stderr: result.stderr.trim() });
  }
  const outputPath = process.argv[2] ?? join(root, "route-results.json");
  writeFileSync(outputPath, `${JSON.stringify({ cwd, results }, null, 2)}\n`);
  console.log(JSON.stringify({ outputPath, passed: results.filter((result) => result.pass).length, total: results.length }, null, 2));
  if (results.some((result) => !result.pass)) process.exitCode = 1;
} finally {
  if (!process.argv[2]) rmSync(root, { recursive: true, force: true });
}
