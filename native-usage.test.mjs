import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeUsage } from "./scripts/session-usage.mjs";
import { buildMeasurement } from "./measure.mjs";
import { buildReport } from "./observe.mjs";

const usage = n => ({ input: n, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: n + 1, cost: { input: n / 1000, total: n / 1000 } });
test("all native usage kinds count while persisted/event copies do not double count", async () => {
  const assistant = { role: "assistant", timestamp: 1, content: [], provider: "fixture", model: "one", usage: usage(1) };
  const tool = { role: "toolResult", toolCallId: "call", toolName: "codemode", content: [], usage: usage(40) };
  const records = [
    { type: "message", message: assistant }, { type: "message_end", message: assistant },
    { type: "compaction", id: "compaction", usage: usage(10) },
    { type: "compaction", id: "compaction", usage: usage(10) },
    { type: "branch_summary", id: "branch", usage: usage(20) },
    { type: "usage", kind: "cache_warm", id: "warm", provider: "fixture", model: "one", usage: usage(30) },
    { type: "message", message: tool }, { type: "message_end", message: tool },
  ];
  const summary = summarizeUsage(records);
  assert.equal(summary.totals.input, 101);
  assert.equal(summary.operations, 5);
  assert.equal(summary.byKind["usage:cache_warm"].input, 30);
  assert.equal(summary.byModel["fixture/one"].input, 31);
  assert.equal(summary.byKind.tool.input, 40);
  const report = await buildReport(records, { estimateTokens: () => 0 });
  assert.equal(report.totals.input, 101); assert.equal(report.requests, 1);
});
test("equal repeated operations remain counted and missing fields stay finite", () => {
  const message = { role: "assistant", usage: { input: 2 } };
  const result = summarizeUsage([{ type: "message", message }, { type: "message", message },
    { type: "message_end", message }, { type: "message_end", message }, { type: "usage", kind: "future", usage: { output: 3 } }]);
  assert.equal(result.operations, 3); assert.equal(result.totals.input, 4); assert.equal(result.totals.output, 3);
});
test("message/event dedup ignores JSON property ordering", () => {
  const persisted = { role: "assistant", timestamp: 1, usage: { input: 2, output: 3 }, content: [] };
  const event = { content: [], usage: { output: 3, input: 2 }, timestamp: 1, role: "assistant" };
  const result = summarizeUsage([{ type: "message", message: persisted }, { type: "message_end", message: event }]);
  assert.equal(result.operations, 1); assert.equal(result.totals.input, 2);
});

test("JSON compaction_end usage counts once alongside an equivalent persisted checkpoint", () => {
  const result = { summary: "checkpoint", firstKeptEntryId: "kept", tokensBefore: 1000, usage: usage(10) };
  const event = { type: "compaction_end", reason: "manual", aborted: false, result };
  assert.equal(summarizeUsage([event]).totals.input, 10);
  assert.equal(summarizeUsage([{ type: "compaction", id: "one", ...result }, event]).totals.input, 10);
  assert.equal(summarizeUsage([event, { ...event, result: { ...result, summary: "later checkpoint" } }]).totals.input, 20);
});

test("measurement uses actual prepared CLI schemas, including native codemode", () => {
  const system = { role: "system", sections: { tools: "native tools" }, toolsAdded: [
    { name: "codemode", description: "actual prepared native description", parameters: { type: "object" } },
    { name: "mcp__MiniMax__web_search", description: "native MCP", parameters: { type: "object" } },
  ] };
  const report = buildMeasurement([{ type: "message_end", message: system }], { estimateTokens: value => value.content.length, env: {} });
  assert.equal(report.tools.activeCount, 2); assert.deepEqual(report.tools.activeNames, system.toolsAdded.map(tool => tool.name));
  assert.equal(report.tools.definitionChars, JSON.stringify(system.toolsAdded).length);
});
