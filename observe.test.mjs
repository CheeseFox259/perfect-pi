import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildReport, renderSolSummary, formatBytes } from "./observe.mjs";

test("buildReport pure helper can be imported without executing CLI", () => {
  assert.equal(typeof buildReport, "function");
  assert.equal(typeof renderSolSummary, "function");
  assert.equal(typeof formatBytes, "function");
});

test("formatBytes produces standard human-readable units", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(500), "500 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1024 * 1024), "1.00 MB");
  assert.equal(formatBytes(2.5 * 1024 * 1024), "2.50 MB");
});

test("observation pack reads ledger.jsonl from session-dir/sol-pi/session-id, dedupes IDs, and does not regex text", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "observe-ledger-test-"));
  try {
    const sessionId = "test-session-obs-1";
    const sessionFile = join(tempDir, `${sessionId}.jsonl`);
    const ledgerDir = join(tempDir, "sol-pi", sessionId, "observation-pack");
    await mkdir(ledgerDir, { recursive: true });

    // Ledger has duplicate entries for obs_1 (full then placeholder) and one for obs_2
    const ledgerLines = [
      JSON.stringify({ timestamp: "2026-10-04T00:00:00Z", event: "full", id: "obs_000000000000000000000001", originalBytes: 5000, originalLines: 100 }),
      JSON.stringify({ timestamp: "2026-10-04T00:01:00Z", event: "placeholder", id: "obs_000000000000000000000001", originalBytes: 5000, originalLines: 100, removedTokens: 1200 }),
      JSON.stringify({ timestamp: "2026-10-04T00:02:00Z", event: "full", id: "obs_000000000000000000000002", originalBytes: 3000, originalLines: 60 }),
    ].join("\n");
    await writeFile(join(ledgerDir, "ledger.jsonl"), `${ledgerLines}\n`);

    // Session records contain a random text mention of obs_999999999999999999999999 with original_bytes: 99999
    // This must NOT be counted as an archived observation because we do not regex arbitrary text!
    const sessionRecords = [
      { type: "session", id: sessionId },
      { type: "message", message: { role: "user", content: "Check obs_999999999999999999999999 original_bytes: 99999 in chat" } },
      { type: "message", message: { role: "assistant", content: "I see it", usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } } },
    ];
    await writeFile(sessionFile, sessionRecords.map((r) => JSON.stringify(r)).join("\n") + "\n");

    const report = await buildReport(sessionFile);
    assert.equal(report.sessionId, sessionId);
    assert.equal(report.sol.observation_pack.archived, 2, "Must dedup IDs and find exactly 2 archived observations");
    assert.equal(report.sol.observation_pack.bytes_archived, 8000, "Must sum 5000 + 3000 bytes");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("observation recall uses authoritative custom events and never sums with tool calls", async () => {
  // Scenario 1: Both custom entries and tool calls are present -> must NOT sum (e.g. 2, not 4)
  const recordsWithBoth = [
    { type: "session", id: "s1" },
    { type: "tool_execution_start", toolName: "obs_recall" },
    { type: "tool_execution_start", toolName: "obs_recall" },
    { type: "custom", customType: "perfect-pi-sol-observation-recall", data: { id: "obs_1", offset: 0 } },
    { type: "custom", customType: "perfect-pi-sol-observation-recall", data: { id: "obs_1", offset: 16000 } },
  ];
  const repBoth = await buildReport(recordsWithBoth);
  assert.equal(repBoth.sol.observation_pack.recall_count, 2, "Must never sum custom events and tool calls");

  // Scenario 2: Only tool calls present -> fallback to tool call count
  const recordsWithToolOnly = [
    { type: "session", id: "s2" },
    { type: "tool_execution_start", toolName: "obs_recall" },
    { type: "tool_execution_start", toolName: "obs_recall" },
    { type: "tool_execution_start", toolName: "obs_recall" },
  ];
  const repTool = await buildReport(recordsWithToolOnly);
  assert.equal(repTool.sol.observation_pack.recall_count, 3, "Must fall back to tool-call count when no custom entries exist");

  // Scenario 3: Neither present -> 0
  const recordsEmpty = [
    { type: "session", id: "s3" },
  ];
  const repEmpty = await buildReport(recordsEmpty);
  assert.equal(repEmpty.sol.observation_pack.recall_count, 0);
});

test("reducer reports requests from attempts including network failures and rejected responses", async () => {
  const records = [
    { type: "session", id: "s-reducer-1" },
    // Attempt 1: Succeeded and accepted
    { type: "custom", customType: "perfect-pi-sol-reducer-attempt", data: { attemptId: "s-reducer-1:1" } },
    { type: "custom", customType: "perfect-pi-sol-reducer-call", data: { attemptId: "s-reducer-1:1", inputTokens: 100, outputTokens: 20 } },
    { type: "custom", customType: "sol-pi-evidence-preserving-reducer-v1", data: { kind: "applied", usage: { input: 100, output: 20 } } },
    { type: "custom", customType: "perfect-pi-sol-reducer-receipt", data: { accepted: true, inputTokens: 100, outputTokens: 20 } },

    // Attempt 2: Network failure / throw
    { type: "custom", customType: "perfect-pi-sol-reducer-attempt", data: { attemptId: "s-reducer-1:2" } },
    { type: "custom", customType: "perfect-pi-sol-reducer-call-failed", data: { attemptId: "s-reducer-1:2", reason: "Network timeout" } },
    { type: "custom", customType: "sol-pi-evidence-preserving-reducer-v1", data: { kind: "fallback", reason: "model-call-timeout" } },

    // Attempt 3: Response received but rejected by reducer (e.g. schema validation failed)
    { type: "custom", customType: "perfect-pi-sol-reducer-attempt", data: { attemptId: "s-reducer-1:3" } },
    { type: "custom", customType: "perfect-pi-sol-reducer-call", data: { attemptId: "s-reducer-1:3", inputTokens: 80, outputTokens: 15 } },
    { type: "custom", customType: "sol-pi-evidence-preserving-reducer-v1", data: { kind: "fallback", reason: "schema-validation-failed", usage: { input: 80, output: 15 } } },
  ];

  const report = await buildReport(records);
  assert.equal(report.sol.reducer.requests, 3, "Requests must be 3 (counted from attempts, including failed and rejected)");
  assert.equal(report.sol.reducer.accepted, 1, "Accepted must be 1");
  assert.equal(report.sol.reducer.rejected, 1, "Rejected must be 1");
  assert.equal(report.sol.reducer.fallback, 2, "Fallbacks must be 2 (network failure + schema failure)");
  assert.equal(report.sol.reducer.input_tokens, 180, "Tokens must include rejected response (100 + 80 = 180)");
  assert.equal(report.sol.reducer.output_tokens, 35, "Tokens must include rejected response (20 + 15 = 35)");
});

test("mixed legacy and reserved reducer requests remain fully counted", async () => {
  const report = await buildReport([
    { type: "session", id: "mixed" },
    { type: "custom", customType: "perfect-pi-sol-reducer-call", data: { inputTokens: 10, outputTokens: 2 } },
    { type: "custom", customType: "perfect-pi-sol-reducer-attempt", data: { attemptId: "mixed:2" } },
    { type: "custom", customType: "perfect-pi-sol-reducer-call", data: { attemptId: "mixed:2", inputTokens: 20, outputTokens: 3 } },
  ]);
  assert.equal(report.sol.reducer.requests, 2);
  assert.equal(report.sol.reducer.input_tokens, 30);
});
test("reducer falls back to legacy calls when no attempts are present", async () => {
  const records = [
    { type: "session", id: "s-legacy" },
    { type: "custom", customType: "perfect-pi-sol-reducer-call", data: { inputTokens: 50, outputTokens: 10 } },
    { type: "custom", customType: "perfect-pi-sol-reducer-call", data: { inputTokens: 60, outputTokens: 12 } },
    { type: "custom", customType: "perfect-pi-sol-reducer-receipt", data: { accepted: true } },
    { type: "custom", customType: "perfect-pi-sol-reducer-fallback", data: { reason: "fallback-reason" } },
  ];

  const report = await buildReport(records);
  assert.equal(report.sol.reducer.requests, 2, "Must count legacy calls when attempts are absent");
  assert.equal(report.sol.reducer.accepted, 1);
  assert.equal(report.sol.reducer.rejected, 1, "Unaccepted call is counted as rejected");
  assert.equal(report.sol.reducer.fallback, 1);
  assert.equal(report.sol.reducer.input_tokens, 110);
  assert.equal(report.sol.reducer.output_tokens, 22);
});

test("reducer counts upstream journal outcomes without duplicate aggregate", async () => {
  const records = [
    { type: "session", id: "s-upstream" },
    { type: "custom", customType: "sol-pi-evidence-preserving-reducer-v1", data: { kind: "candidate" } },
    { type: "custom", customType: "sol-pi-evidence-preserving-reducer-v1", data: { kind: "provider_response", usage: { input: 120, output: 25 } } },
    { type: "custom", customType: "sol-pi-evidence-preserving-reducer-v1", data: { kind: "applied", usage: { input: 120, output: 25 } } },
  ];

  const report = await buildReport(records);
  assert.equal(report.sol.reducer.requests, 1);
  assert.equal(report.sol.reducer.accepted, 1);
  assert.equal(report.sol.reducer.fallback, 0);
  assert.equal(report.sol.reducer.rejected, 0);
  assert.equal(report.sol.reducer.input_tokens, 120);
  assert.equal(report.sol.reducer.output_tokens, 25);
});

test("avoid summing native compaction with upstream state snapshots", async () => {
  const records = [
    { type: "session", id: "s-compact" },
    { type: "compaction" }, // 1 native compaction
    { type: "custom", customType: "perfect-pi-sol-compaction", data: { triggered: true } }, // companion parent entry
    // 5 upstream state snapshots appended during session lifecycle
    { type: "custom", customType: "sol-pi-online-context-state-v1", data: { nativeCompactionCount: 1, requestCount: 1 } },
    { type: "custom", customType: "sol-pi-online-context-state-v1", data: { nativeCompactionCount: 1, requestCount: 2 } },
    { type: "custom", customType: "sol-pi-online-context-state-v1", data: { nativeCompactionCount: 1, requestCount: 3 } },
    { type: "custom", customType: "sol-pi-online-context-state-v1", data: { nativeCompactionCount: 1, requestCount: 4 } },
    { type: "custom", customType: "sol-pi-online-context-state-v1", data: { nativeCompactionCount: 1, requestCount: 5 } },
    { type: "custom", customType: "sol-pi-online-context-compact-skipped", data: { reason: "test skip" } },
  ];

  const report = await buildReport(records);
  assert.equal(report.compactions, 1, "Report compactions must be exactly 1");
  assert.equal(report.sol.compaction.triggered, 1, "Triggered compactions must be exactly 1 (not 6 or 7)");
  assert.equal(report.sol.compaction.skipped, 1, "Skipped compactions must be 1");
});

test("action fusion counts fused validations and saved turns", async () => {
  const records = [
    { type: "session", id: "s-fusion" },
    { type: "custom", customType: "perfect-pi-sol-action-fusion", data: { command: "npm test", succeeded: true, turnsSaved: 1 } },
    { type: "custom", customType: "perfect-pi-sol-action-fusion", data: { command: "exit 1", succeeded: false, turnsSaved: 0 } },
  ];

  const report = await buildReport(records);
  assert.equal(report.sol.action_fusion.count, 2);
  assert.equal(report.sol.action_fusion.saved_turns, 1);
});

test("renderSolSummary renders matching report layout", () => {
  const mockReport = {
    requests: 5,
    sol: {
      action_fusion: { count: 3, saved_turns: 3 },
      observation_pack: { archived: 2, bytes_archived: 8192, recall_count: 1 },
      reducer: { requests: 2, accepted: 1, fallback: 1, input_tokens: 1000, output_tokens: 200 },
      compaction: { triggered: 1, skipped: 0 },
    },
  };

  const summary = renderSolSummary(mockReport);
  assert.match(summary, /Perfect-Pi SoL Efficiency Report/);
  assert.match(summary, /Model requests\s+5/);
  assert.match(summary, /Fused validations\s+3/);
  assert.match(summary, /Estimated turns avoided\s+3/);
  assert.match(summary, /Observations archived\s+2/);
  assert.match(summary, /Original bytes\s+8\.0 KB/);
  assert.match(summary, /Recall requests\s+1/);
  assert.match(summary, /Reducer requests\s+2/);
  assert.match(summary, /Accepted receipts\s+1/);
  assert.match(summary, /Fallbacks\s+1/);
  assert.match(summary, /Reducer tokens\s+1,200/);
  assert.match(summary, /Online compactions\s+1/);
});

test("CLI execution outputs JSON and summary properly", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "observe-cli-test-"));
  try {
    const sessionFile = join(tempDir, "session.jsonl");
    const records = [
      { type: "session", id: "cli-session" },
      { type: "message", message: { role: "assistant", usage: { input: 50, output: 20, cacheRead: 0, cacheWrite: 0 } } },
    ];
    await writeFile(sessionFile, records.map((r) => JSON.stringify(r)).join("\n") + "\n");

    const jsonOut = execFileSync(process.execPath, ["observe.mjs", sessionFile], { encoding: "utf8" });
    const parsed = JSON.parse(jsonOut);
    assert.equal(parsed.sessionId, "cli-session");
    assert.equal(parsed.requests, 1);

    const summaryOut = execFileSync(process.execPath, ["observe.mjs", sessionFile, "--summary"], { encoding: "utf8" });
    assert.match(summaryOut, /Perfect-Pi SoL Efficiency Report/);
    assert.match(summaryOut, /Model requests\s+1/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
