import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync, statSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { managedMcpConfigs, planManagedMcp, syncManagedMcp, inspectManagedMcp } from "./scripts/managed-mcp.mjs";
import { detectPiRuntime } from "./scripts/pi-runtime.mjs";
const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url)));
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-managed-mcp-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test("managed MCP pins versions and uses Pi's native exact allowlist/default-deny exposure", async t => {
  const dir = fixture(t);
  const configs = managedMcpConfigs(manifest, dir);
  const runtime = await detectPiRuntime();
  const { getMcpToolExposure, loadMcpConfig } = await import(pathToFileURL(join(runtime.root, "dist/extensions/mcp/config.js")));
  syncManagedMcp(manifest, dir, {});
  const loaded = loadMcpConfig({ agentDir: dir, cwd: dir, projectTrusted: false });
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.servers.length, 2);
  for (const [name, config] of Object.entries(configs)) {
    assert.match(config.args.at(-1), /@\d+\.\d+\.\d+$/);
    assert.equal(getMcpToolExposure(config, "new_unreviewed_tool"), "hidden");
    for (const tool of manifest.mcpServers[name].tools) assert.equal(getMcpToolExposure(config, tool), "codemode");
  }
  for (const tool of ["ctx_execute", "ctx_execute_file", "ctx_batch_execute", "ctx_fetch_and_index", "ctx_upgrade", "ctx_purge", "ctx_insight"]) assert.equal(getMcpToolExposure(configs["context-mode"], tool), "hidden");
  for (const tool of ["manage_adr", "delete_project", "ingest_traces"]) assert.equal(getMcpToolExposure(configs["codebase-memory"], tool), "hidden");
});
test("configuration sync is idempotent and retains unrelated personal entries", t => {
  const dir = fixture(t), path = join(dir, "mcp.json");
  const personal = { command: "private", env: { API_KEY: "synthetic-test-only" } };
  writeFileSync(path, JSON.stringify({ autoEnableCodemode: false, mcpServers: { personal } }));
  const first = syncManagedMcp(manifest, dir, {});
  const before = readFileSync(path, "utf8");
  syncManagedMcp(manifest, dir, first.owned);
  assert.equal(readFileSync(path, "utf8"), before);
  assert.deepEqual(JSON.parse(before).mcpServers.personal, personal);
  assert.equal(inspectManagedMcp(manifest, dir, first.owned).status, "SYNCED");
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
});
test("adoption is explicit and narrow; custom executables and tool policies are not overwritten", t => {
  const dir = fixture(t), path = join(dir, "mcp.json");
  const legacy = { command: "npx", args: ["-y", "context-mode"], exposure: "codemode", description: "Old" };
  writeFileSync(path, JSON.stringify({ mcpServers: { "context-mode": legacy } }));
  assert.throws(() => planManagedMcp(manifest, dir, {}), /Refusing/);
  const plan = syncManagedMcp(manifest, dir, {}, { adopt: true });
  assert.deepEqual(plan.adopted, ["context-mode"]);
  for (const edited of [{ ...legacy, env: { KEY: "user" } }, { ...legacy, command: "custom" }, { ...legacy, toolExposure: { ctx_execute: "direct" } }]) {
    writeFileSync(path, JSON.stringify({ mcpServers: { "context-mode": edited } }));
    assert.throws(() => planManagedMcp(manifest, dir, {}, { adopt: true }), /Refusing/);
  }
});
test("version upgrades and removal honor ownership while preserving disabled state", t => {
  const dir = fixture(t), path = join(dir, "mcp.json");
  const first = syncManagedMcp(manifest, dir, {});
  const config = JSON.parse(readFileSync(path));
  config.mcpServers["context-mode"].enabled = false;
  writeFileSync(path, JSON.stringify(config));
  const changed = structuredClone(manifest);
  changed.mcpServers["context-mode"].package = "context-mode@1.0.170";
  const next = syncManagedMcp(changed, dir, first.owned);
  assert.equal(JSON.parse(readFileSync(path)).mcpServers["context-mode"].enabled, false);
  assert.equal(inspectManagedMcp(changed, dir, next.owned).status, "SYNCED");
  delete changed.mcpServers["context-mode"];
  syncManagedMcp(changed, dir, next.owned);
  assert.equal(JSON.parse(readFileSync(path)).mcpServers["context-mode"], undefined);
});
test("invalid JSON, symlinks, alias collisions and floating pins fail closed", t => {
  const dir = fixture(t), path = join(dir, "mcp.json");
  writeFileSync(path, "[]"); assert.throws(() => planManagedMcp(manifest, dir), /Invalid/);
  assert.equal(inspectManagedMcp(manifest, dir).status, "DRIFTED");
  writeFileSync(path, JSON.stringify({ mcpServers: { context_mode: { command: "personal" } } }));
  assert.throws(() => planManagedMcp(manifest, dir), /collision/);
  rmSync(path); symlinkSync(join(dir, "outside"), path);
  assert.throws(() => syncManagedMcp(manifest, dir, {}));
  const floating = structuredClone(manifest); floating.mcpServers["context-mode"].package = "context-mode@latest";
  assert.throws(() => managedMcpConfigs(floating, dir), /pinned/);
});
test("public launcher starts through a symlinked directory and shuts down its process group", async t => {
  const { spawn } = await import("node:child_process");
  const dir = fixture(t);
  symlinkSync(join(import.meta.dirname, "scripts"), join(dir, "aliased-scripts"));
  const child = spawn(process.execPath, [join(dir, "aliased-scripts/mcp-launch.mjs"), "--public", dir, "fixture", process.execPath, "-e",
    'console.log("ready");process.stdin.on("data",data=>process.stdout.write(data));setInterval(()=>{},1000);'], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill("SIGTERM"));
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("public launcher readiness timeout")); }, 5000);
    child.stdout.on("data", chunk => { output += chunk; if (output.includes("ready")) { clearTimeout(timer); resolve(); } });
    child.once("error", reject);
  });
  const stopped = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("public launcher shutdown timeout")), 5000);
    child.once("close", () => { clearTimeout(timer); resolve(); });
  });
  child.kill("SIGTERM"); await stopped;
});
test("public launcher bounds shutdown when its client closes stdin", async t => {
  const { spawn } = await import("node:child_process");
  const dir = fixture(t);
  const child = spawn(process.execPath, [join(import.meta.dirname, "scripts/mcp-launch.mjs"), "--public", dir, "fixture", process.execPath, "-e",
    'console.log("ready");process.stdin.resume();process.on("SIGTERM",()=>{});setInterval(()=>{},1000);'], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill("SIGTERM"));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("EOF test readiness timeout")), 5000);
    child.stdout.on("data", chunk => { if (chunk.toString().includes("ready")) { clearTimeout(timer); resolve(); } });
    child.once("error", reject);
  });
  const stopped = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("EOF did not bound shutdown")), 6000);
    child.once("close", () => { clearTimeout(timer); resolve(); });
  });
  child.stdin.end(); await stopped;
});
test("managed MCP data paths are private and symlinked storage is refused", t => {
  const dir = fixture(t);
  syncManagedMcp(manifest, dir, {});
  if (process.platform !== "win32") {
    const owned = managedMcpConfigs(manifest, dir);
    chmodSync(join(dir, "mcp-data/context-mode"), 0o755);
    assert.equal(inspectManagedMcp(manifest, dir, owned).status, "DRIFTED");
    syncManagedMcp(manifest, dir, owned);
    assert.equal(statSync(join(dir, "mcp-data/context-mode")).mode & 0o777, 0o700);
    assert.equal(inspectManagedMcp(manifest, dir, owned).status, "SYNCED");
  }
  rmSync(join(dir, "mcp-data/context-mode"), { recursive: true });
  mkdirSync(join(dir, "outside")); symlinkSync(join(dir, "outside"), join(dir, "mcp-data/context-mode"));
  assert.throws(() => syncManagedMcp(manifest, dir, managedMcpConfigs(manifest, dir)), /Unsafe MCP storage/);
});
test("public MCP launcher filters ambient API keys and preserves protocol output", t => {
  const dir = fixture(t);
  writeFileSync(join(dir, "mcp.json"), JSON.stringify({ mcpServers: { fixture: { env: { FIXTURE_DATA_DIR: "unused" } } } }));
  const result = spawnSync(process.execPath, ["scripts/mcp-launch.mjs", "--public", dir, "fixture", process.execPath, "-e", 'console.log(JSON.stringify({leak:!!process.env.UNRELATED_PROVIDER_API_KEY,data:process.env.FIXTURE_DATA_DIR,invalid:Object.hasOwn(process.env,"undefined")}))'], {
    env: { ...process.env, UNRELATED_PROVIDER_API_KEY: "synthetic-private", FIXTURE_DATA_DIR: "resolved-data" }, encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { leak: false, data: "resolved-data", invalid: false });
});
