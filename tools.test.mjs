import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import test from "node:test";
let piEntry;
try { piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")); }
catch { piEntry = join(execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent/dist/index.js"); }
const { loadExtensions } = await import(pathToFileURL(join(dirname(piEntry), "core/extensions/loader.js")));
const names = ["read", "bash", "edit", "write", "questionnaire", "subagent", "capabilities", "codemode", "tool_search", "web_search", "fetch_content", "process", "user_plugin", "obs_recall"];
async function fixture(entries = [], initial = names) {
  const loaded = await loadExtensions([join(import.meta.dirname, "global/extensions/tools.ts")], import.meta.dirname);
  assert.deepEqual(loaded.errors, []);
  let active = [...initial];
  const registered = [...names.map((name) => ({ name })),
    { name: "hidden_tool", exposure: "hidden" },
    { name: "mcp__fixture__danger", exposure: "hidden" },
    { name: "mcp__fixture__query", exposure: "codemode" },
    { name: "deferred_plugin", exposure: "deferred" },
  ];
  loaded.runtime.getActiveTools = () => [...active];
  loaded.runtime.getAllTools = () => registered;
  loaded.runtime.setActiveTools = (selected) => { active = [...selected]; };
  loaded.runtime.appendEntry = (customType, data) => entries.push({ type: "custom", customType, data });
  const extension = loaded.extensions[0];
  const ctx = { sessionManager: { getBranch: () => entries } };
  const fire = async (name) => { for (const handler of extension.handlers.get(name) ?? []) await handler({}, ctx); };
  await fire("session_start");
  return { active: () => active, entries, fire, extension, ctx,
    command: args => extension.commands.get("tools").handler(args, { ...ctx, ui: { notify() {} } }),
    enable: (enable) => extension.tools.get("capabilities").definition.execute("test", { enable }, undefined, undefined, ctx) };
}
test("TUI manual disable persists and hidden tools have no toggle", async () => {
  const { initTheme } = await import(pathToFileURL(piEntry));
  initTheme("dark");
  const f = await fixture();
  let rendered = [];
  const ctx = { ...f.ctx, mode: "tui", ui: {
    notify() {},
    custom: async factory => {
      const theme = { fg: (_name, text) => text, bold: text => text };
      let done = false;
      const component = factory({ requestRender() {} }, theme, {}, () => { done = true; });
      rendered = component.render(80);
      component.handleInput("\r");
      component.handleInput("\x1b");
      assert.equal(done, true);
    },
  } };
  await f.extension.commands.get("tools").handler("", ctx);
  assert.ok(!rendered.join("\n").includes("hidden_tool"));
  assert.ok(!f.active().includes("read"));
  await f.fire("session_tree");
  assert.ok(!f.active().includes("read"));
  const resumed = await fixture(f.entries);
  assert.ok(!resumed.active().includes("read"));
});

test("fresh sessions retain every runtime default without capability activation", async () => {
  const f = await fixture();
  assert.deepEqual(f.active(), names);
  assert.equal(f.entries.length, 0);
});
test("deliberately inactive package tools and MCP exposure are not eagerly promoted", async () => {
  const initial = names.filter(name => !["web_search", "fetch_content"].includes(name));
  const f = await fixture([], initial);
  assert.deepEqual(f.active(), initial);
  assert.ok(!f.active().includes("deferred_plugin"));
  assert.ok(!f.active().includes("mcp__fixture__query"));
});
test("loader activates registered group, reports missing tools, persists selection", async () => {
  const f = await fixture([], names.filter(name => !["web_search", "fetch_content", "process"].includes(name)));
  const result = await f.enable(["web"]);
  assert.ok(f.active().includes("fetch_content"));
  assert.ok(!f.active().includes("process"));
  assert.deepEqual(result.details.web.missing, ["source_check", "get_search_content"]);
  await f.fire("session_tree");
  assert.ok(f.active().includes("web_search"));
  assert.equal(f.entries.length, 1);
});
test("status-only capability query does not change tools or session", async () => {
  const f = await fixture();
  const before = [...f.active()];
  await f.enable(undefined);
  assert.deepEqual(f.active(), before);
  assert.equal(f.entries.length, 0);
});
test("saved manual selection survives startup, removed tools are filtered", async () => {
  const f = await fixture([{ type: "custom", customType: "tools-config", data: { enabledTools: ["read", "process", "removed_plugin"] } }]);
  assert.deepEqual(f.active(), ["read", "process"]);
});
test("CLI restrictions survive saved state and capability activation", async () => {
  const original = process.argv;
  try {
    process.argv = [...original, "-t=read,capabilities"];
    const f = await fixture([{ type: "custom", customType: "tools-config", data: { enabledTools: names } }], ["read", "capabilities"]);
    assert.deepEqual(f.active(), ["read", "capabilities"]);
    const result = await f.enable(["web", "process"]);
    assert.deepEqual(f.active(), ["read", "capabilities"]);
    assert.deepEqual(result.details.process.excludedByCli, ["process"]);
    await f.fire("session_tree");
    assert.deepEqual(f.active(), ["read", "capabilities"]);
  } finally { process.argv = original; }
});

test("native MCP activation works, reports schemas and persists on the branch", async () => {
  const f = await fixture([], names.filter(name => !["codemode", "tool_search"].includes(name)));
  const result = await f.enable(["mcp"]);
  assert.ok(f.active().includes("codemode")); assert.ok(f.active().includes("tool_search"));
  assert.deepEqual(result.structuredContent, result.details);
  await f.fire("session_tree"); assert.ok(f.active().includes("codemode"));
});
test("new native defaults are added only when historical default metadata is known", async () => {
  const f = await fixture([{ type: "custom", customType: "tools-config", data: { enabledTools: ["read"], defaultNativeTools: [] } }]);
  assert.ok(f.active().includes("codemode")); assert.ok(f.active().includes("tool_search"));
});

test("explicit native tool disable is respected after branch restore", async () => {
  const f = await fixture([{ type: "custom", customType: "tools-config", data: { enabledTools: ["read"], defaultNativeTools: ["codemode", "tool_search"] } }]);
  assert.deepEqual(f.active(), ["read"]);
});

test("explicit CLI tool choices are preserved", async () => {
  const original = process.argv;
  try {
    process.argv = [...original, "--tools=read,process"];
    const f = await fixture([], ["read", "process"]);
    assert.deepEqual(f.active(), ["read", "process"]);
    await f.command("reset");
    assert.deepEqual(f.active(), ["read", "process"]);
  } finally { process.argv = original; }
});

test("legacy choices stay unchanged until the user explicitly resets", async () => {
  const entries = [{ type: "custom", customType: "tools-config", data: { enabledTools: ["read"] } }];
  const f = await fixture(entries);
  assert.deepEqual(f.active(), ["read"]);
  await f.command("reset");
  assert.deepEqual(f.active(), names);
  assert.equal(entries.length, 2);
  await f.fire("session_tree");
  assert.deepEqual(f.active(), names);
  const resumed = await fixture(entries);
  assert.deepEqual(resumed.active(), names);
});

test("reset recovers known groups without promoting hidden, MCP or deferred tools", async () => {
  const f = await fixture([], ["read", "codemode"]);
  await f.command("reset");
  assert.ok(f.active().includes("process"));
  assert.ok(f.active().includes("web_search"));
  assert.ok(!f.active().includes("user_plugin"));
  assert.ok(!f.active().includes("hidden_tool"));
  assert.ok(!f.active().includes("mcp__fixture__danger"));
  assert.ok(!f.active().includes("mcp__fixture__query"));
  assert.ok(!f.active().includes("deferred_plugin"));
});

test("hidden tools in stale branch records cannot be restored", async () => {
  const f = await fixture([{ type: "custom", customType: "tools-config", data: { enabledTools: ["read", "hidden_tool", "mcp__fixture__danger"] } }]);
  assert.deepEqual(f.active(), ["read"]);
});
