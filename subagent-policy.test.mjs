import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import test from "node:test";

let piEntry;
try { piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")); }
catch { piEntry = join(execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent/dist/index.js"); }
const { loadExtensions } = await import(pathToFileURL(join(new URL(".", pathToFileURL(piEntry)).pathname, "core/extensions/loader.js")));
const root = import.meta.dirname;
const loaded = await loadExtensions([join(root, "global/extensions/subagent-policy.ts")], root);
assert.deepEqual(loaded.errors, []);
const extension = loaded.extensions[0];
const toolCall = extension.handlers.get("tool_call")[0];
const command = extension.commands.get("subagent-model").handler;
const ctx = { cwd: root, ui: { notify: () => {} }, hasUI: false };

function call(toolName, input) { return toolCall({ type: "tool_call", toolCallId: "test", toolName, input }, ctx); }

test("injects the cheap/default policy model and thinking level", () => {
  const input = { agent: "implementer", task: "test" };
  assert.equal(call("subagent", input), undefined);
  assert.equal(input.model, "cpa/gemini-3.8-flash-high");
  assert.equal(input.thinkingLevel, "high");
});

test("blocks a model-requested expensive override", () => {
  const result = call("subagent", { agent: "implementer", task: "test", input: JSON.stringify({ model: "hikari/gpt-6-astra" }) });
  assert.equal(result.block, true);
  assert.match(result.reason, /cannot authorize itself/);
});

test("blocks a research override using the same policy", () => {
  const result = call("research", { task: "test", findingsPath: "findings.md", model: "hikari/gpt-6-astra" });
  assert.equal(result.block, true);
});

test("user command authorizes a model for the current session", async () => {
  const notifications = [];
  const userCtx = { ...ctx, ui: { notify: (message) => notifications.push(message) } };
  await command("allow hikari/gpt-6-astra", userCtx);
  const input = { agent: "implementer", task: "test", model: "hikari/gpt-6-astra" };
  assert.equal(call("subagent", input), undefined);
  assert.equal(input.model, "hikari/gpt-6-astra");
  assert.ok(notifications.some((message) => /Authorized/.test(message)));
});

test("non-child tools are untouched", () => {
  const input = { command: "echo ok" };
  assert.equal(call("bash", input), undefined);
  assert.deepEqual(input, { command: "echo ok" });
});
