import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import test from "node:test";
let piEntry;
try { piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")); }
catch { piEntry = join(execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent/dist/index.js"); }
const { loadExtensions } = await import(pathToFileURL(join(dirname(piEntry), "core/extensions/loader.js")));
const names = ["read", "bash", "edit", "write", "questionnaire", "subagent", "capabilities", "web_search", "fetch_content", "process", "user_plugin", "obs_recall"];
async function fixture(entries = [], initial = names) {
  const loaded = await loadExtensions([join(import.meta.dirname, "global/extensions/tools.ts")], import.meta.dirname);
  assert.deepEqual(loaded.errors, []);
  let active = [...initial];
  const registered = names.map((name) => ({ name }));
  loaded.runtime.getActiveTools = () => [...active];
  loaded.runtime.getAllTools = () => registered;
  loaded.runtime.setActiveTools = (selected) => { active = [...selected]; };
  loaded.runtime.appendEntry = (customType, data) => entries.push({ type: "custom", customType, data });
  const extension = loaded.extensions[0];
  const ctx = { sessionManager: { getBranch: () => entries } };
  const fire = async (name) => { for (const handler of extension.handlers.get(name) ?? []) await handler({}, ctx); };
  await fire("session_start");
  return { active: () => active, entries, fire, enable: (enable) => extension.tools.get("capabilities").definition.execute("test", { enable }, undefined, undefined, ctx) };
}
test("default hides optional schemas and keeps unrelated tools", async () => {
  const f = await fixture();
  assert.deepEqual(f.active(), names.filter((name) => !["web_search", "fetch_content", "process"].includes(name)));
});
test("loader activates registered group, reports missing tools, persists selection", async () => {
  const f = await fixture();
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
  assert.deepEqual(f.active(), ["read", "process", "obs_recall"]);
});
test("CLI restrictions survive saved state and capability activation", async () => {
  const original = process.argv;
  try {
    process.argv = [...original, "--tools=read,capabilities"];
    const f = await fixture([{ type: "custom", customType: "tools-config", data: { enabledTools: names } }], ["read", "capabilities"]);
    assert.deepEqual(f.active(), ["read", "capabilities"]);
    const result = await f.enable(["web", "process"]);
    assert.deepEqual(f.active(), ["read", "capabilities"]);
    assert.deepEqual(result.details.process.excludedByCli, ["process"]);
    await f.fire("session_tree");
    assert.deepEqual(f.active(), ["read", "capabilities"]);
  } finally { process.argv = original; }
});

test("explicit CLI tool choices are preserved", async () => {
  const original = process.argv;
  try {
    process.argv = [...original, "--tools=read,process"];
    const f = await fixture();
    assert.ok(f.active().includes("process"));
  } finally { process.argv = original; }
});
